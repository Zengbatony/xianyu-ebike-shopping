#!/usr/bin/env node
/**
 * xianyu.js - 闲鱼商品监控工具
 * 
 * 用法:
 *   node xianyu.js add --keyword "关键词" [--max-price 3000] [--min-price 500] [--region "广东/深圳"] [--filter "排除词1,排除词2"] [--only "必含词1,必含词2"]
 *   node xianyu.js remove --id <task_id>
 *   node xianyu.js list
 *   node xianyu.js scan [--id <task_id>] [--limit 30]
 *   node xianyu.js history [--id <task_id>] [--limit 20]
 * 
 * 环境变量:
 *   XIANYU_CDP_PORT  - Chrome CDP 端口 (默认 18803)
 *   XIANYU_DB_PATH   - SQLite 数据库路径 (默认 data/xianyu-monitor.db)
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { isNinebot } = require('./lib-brand');   // 品牌白名单过滤（config/brand.json）

// ============ Config ============
const CDP_PORT = process.env.XIANYU_CDP_PORT || 18803;
const DB_PATH = process.env.XIANYU_DB_PATH || path.join(__dirname, '..', 'data', 'xianyu-monitor.db');
const PID_PATH = path.join(__dirname, '..', 'data', 'chrome_xianyu.pid');
const SEARCH_API_PATTERN = 'h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// ============ DB Setup ============
// Windows 零编译方案：优先用 Node >= 22.5 内置的 node:sqlite（无需 VS C++ 构建工具）
// 内置不可用时才回退 better-sqlite3。对外接口与 better-sqlite3 保持一致。
let Database;
// 先装 warning 过滤器，再加载 node:sqlite（ExperimentalWarning 在 require 时即触发）
const _emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const msg = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return _emitWarning.call(process, warning, ...rest);
};
try {
  const { DatabaseSync } = require('node:sqlite');
  class BuiltinDatabase {
    constructor(file) { this._db = new DatabaseSync(file); }
    pragma(stmt) { this._db.exec('PRAGMA ' + stmt); }
    exec(sql) { return this._db.exec(sql); }
    prepare(sql) { return this._db.prepare(sql); }
    close() { try { this._db.close(); } catch (_) {} }
  }
  Database = BuiltinDatabase;
} catch {
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error('Error: 需要 Node >= 22.5（内置 sqlite）或 npm install better-sqlite3');
    process.exit(1);
  }
}

function getDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      min_price REAL,
      max_price REAL,
      region TEXT,
      filter_out TEXT,
      must_include TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      last_scan TEXT,
      consecutive_empty INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      task_id INTEGER,
      title TEXT,
      price REAL,
      area TEXT,
      seller TEXT,
      link TEXT,
      publish_time TEXT,
      want_count INTEGER,
      tags TEXT,
      original_price TEXT,
      image_url TEXT,
      discovered_at TEXT DEFAULT (datetime('now', 'localtime')),
      notified INTEGER DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_items_task ON items(task_id);
    CREATE INDEX IF NOT EXISTS idx_items_discovered ON items(discovered_at);
  `);

  // 迁移：zone 列（闲鱼官方区域筛选，如「珠三角」「广东」「深圳」）
  try { db.exec('ALTER TABLE tasks ADD COLUMN zone TEXT'); } catch (_) { /* 已存在 */ }
  
  return db;
}

// ============ Task Management ============
function cmdAdd(args) {
  if (!args.keyword) {
    console.error('Error: --keyword is required');
    process.exit(1);
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO tasks (keyword, min_price, max_price, region, filter_out, must_include, zone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    args.keyword,
    args.minPrice || null,
    args.maxPrice || null,
    args.region || null,
    args.filter || null,
    args.only || null,
    args.zone || null
  );
  console.log(`✅ 监控任务已创建 (ID: ${result.lastInsertRowid})`);
  console.log(`   关键词: ${args.keyword}`);
  if (args.maxPrice) console.log(`   最高价: ¥${args.maxPrice}`);
  if (args.minPrice) console.log(`   最低价: ¥${args.minPrice}`);
  if (args.zone) console.log(`   闲鱼区域筛选: ${args.zone}`);
  if (args.region) console.log(`   地区关键词: ${args.region}`);
  if (args.filter) console.log(`   排除: ${args.filter}`);
  if (args.only) console.log(`   必含: ${args.only}`);
  db.close();
}

function cmdRemove(args) {
  if (!args.id) { console.error('Error: --id is required'); process.exit(1); }
  const db = getDb();
  const result = db.prepare('UPDATE tasks SET active = 0 WHERE id = ?').run(args.id);
  if (result.changes) console.log(`✅ 任务 #${args.id} 已停用`);
  else console.log(`❌ 未找到任务 #${args.id}`);
  db.close();
}

function cmdList() {
  const db = getDb();
  const tasks = db.prepare('SELECT * FROM tasks WHERE active = 1').all();
  if (!tasks.length) {
    console.log('暂无活跃监控任务');
    db.close();
    return;
  }
  console.log(`📋 活跃监控任务 (${tasks.length} 个):\n`);
  for (const t of tasks) {
    const itemCount = db.prepare('SELECT COUNT(*) as cnt FROM items WHERE task_id = ?').get(t.id).cnt;
    console.log(`  #${t.id} | ${t.keyword}`);
    if (t.max_price) console.log(`     价格: ${t.min_price ? '¥' + t.min_price + '~' : '≤'}¥${t.max_price}`);
    if (t.zone) console.log(`     闲鱼区域: ${t.zone}`);
    if (t.region) console.log(`     地区关键词: ${t.region}`);
    if (t.filter_out) console.log(`     排除: ${t.filter_out}`);
    if (t.must_include) console.log(`     必含: ${t.must_include}`);
    console.log(`     已发现: ${itemCount} 件 | 上次扫描: ${t.last_scan || '从未'}`);
    console.log();
  }
  db.close();
}

function cmdHistory(args) {
  const db = getDb();
  const limit = args.limit || 20;
  let query = 'SELECT i.*, t.keyword FROM items i JOIN tasks t ON i.task_id = t.id';
  const params = [];
  if (args.id) {
    query += ' WHERE i.task_id = ?';
    params.push(args.id);
  }
  query += ' ORDER BY i.discovered_at DESC LIMIT ?';
  params.push(limit);
  
  const items = db.prepare(query).all(...params);
  if (!items.length) {
    console.log('暂无发现记录');
    db.close();
    return;
  }
  console.log(`📦 最近发现 (${items.length} 件):\n`);
  for (const item of items) {
    console.log(`  [${item.keyword}] ${item.title}`);
    console.log(`    💰 ¥${item.price} | 📍 ${item.area} | 👤 ${item.seller}`);
    console.log(`    🔗 ${item.link}`);
    console.log(`    ⏰ ${item.publish_time} | 发现于 ${item.discovered_at}`);
    console.log();
  }
  db.close();
}

function cmdSeed() {
  const seedPath = path.join(__dirname, '..', 'seed_tasks.json');
  if (!fs.existsSync(seedPath)) { console.error('Error: 未找到 seed_tasks.json'); process.exit(1); }
  let tasks;
  try { tasks = JSON.parse(fs.readFileSync(seedPath, 'utf-8')); }
  catch (e) { console.error('Error: seed_tasks.json 解析失败:', e.message); process.exit(1); }
  const db = getDb();
  const stmt = db.prepare(`INSERT INTO tasks (keyword, min_price, max_price, region, filter_out, must_include, zone) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  for (const t of tasks) {
    stmt.run(t.keyword, t.minPrice ?? null, t.maxPrice ?? null, t.region ?? null, t.filter ?? null, t.only ?? null, t.zone ?? null);
    n++;
  }
  console.log(`✅ 已预置 ${n} 个监控任务`);
  db.close();
}

/**
 * 应用闲鱼官方「区域」筛选（珠三角 / 广东 / 深圳 …）。
 * 比依赖登录后的 area 字段可靠得多：服务端直接返回该区域的货。
 */
async function applyZoneFilter(page, zone) {
  // 1. 点开「区域」浮层
  const opened = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div,span,a,li,button'));
    const t = els.find(e => e.textContent && e.textContent.trim() === '区域' && e.offsetParent !== null);
    if (!t) return false;
    t.setAttribute('data-xianyu-zone-open', '1');
    return true;
  });
  if (!opened) { console.log('   未找到"区域"按钮，跳过区域筛选'); return false; }
  await page.click('[data-xianyu-zone-open="1"]');
  await sleep(2000);

  // 2. 在浮层内点目标区域
  const picked = await page.evaluate((z) => {
    const scopes = document.querySelectorAll('.ant-popover, [class*="popover"], [class*="dropdown"]');
    const pool = scopes.length
      ? Array.from(scopes).flatMap(s => Array.from(s.querySelectorAll('div,span,a,li')))
      : Array.from(document.querySelectorAll('div,span,a,li'));
    const t = pool.find(e => e.textContent && e.textContent.trim() === z && e.offsetParent !== null);
    if (!t) return false;
    t.setAttribute('data-xianyu-zone-pick', '1');
    return true;
  }, zone);
  if (!picked) { console.log(`   区域列表里没找到「${zone}」`); return false; }
  await page.click('[data-xianyu-zone-pick="1"]');
  await sleep(4500 + Math.random() * 1500);

  // 3. 关掉可能弹出的登录提示
  await page.evaluate(() => {
    document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"]').forEach(b => b.click());
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(500);
  console.log(`   已应用区域筛选: ${zone}`);
  return true;
}

// ============ Chrome 自愈 ============
/** 检测 CDP 端口是否就绪 */
async function cdpAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

/** 定位 chrome.exe */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cands = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  return cands.find(p => p && fs.existsSync(p)) || null;
}

/**
 * 确保 Chrome 在跑：CDP 不通就自己拉起来（detached + unref，node 退出后它继续活）。
 * 这样即使外部把 Chrome 进程回收掉，每次 scan 也能自愈，不需要人工干预。
 */
async function ensureChrome() {
  if (await cdpAlive()) return true;

  const chrome = findChrome();
  if (!chrome) {
    console.error('❌ 找不到 chrome.exe，请设置环境变量 CHROME_PATH');
    return false;
  }
  const profileDir = path.join(path.dirname(DB_PATH), 'chrome-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  console.log(`   Chrome 未运行，自动启动 (端口 ${CDP_PORT})...`);

  const { spawn } = require('child_process');
  const child = spawn(chrome, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  // 等 CDP 就绪（最多 20 秒）
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    if (await cdpAlive()) {
      console.log('   Chrome 已就绪');
      return true;
    }
  }
  console.error('❌ Chrome 启动超时');
  return false;
}

// ============ Core Scanner ============
async function cmdScan(args) {
  const db = getDb();
  let tasks;
  if (args.id) {
    tasks = db.prepare('SELECT * FROM tasks WHERE id = ? AND active = 1').all(args.id);
  } else {
    tasks = db.prepare('SELECT * FROM tasks WHERE active = 1').all();
  }
  
  if (!tasks.length) {
    console.log('没有需要扫描的任务');
    db.close();
    return;
  }
  
  if (!(await ensureChrome())) {
    console.error('❌ Chrome 不可用，无法扫描');
    db.close();
    process.exit(1);
  }

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}` });
  } catch (e) {
    console.error(`❌ 无法连接 Chrome (端口 ${CDP_PORT}): ${e.message}`);
    console.error('请确保 Chrome 已启动: chrome --remote-debugging-port=' + CDP_PORT);
    db.close();
    process.exit(1);
  }
  
  const allNewItems = [];
  let cookieExpired = false;
  
  for (const task of tasks) {
    console.log(`\n🔍 扫描任务 #${task.id}: "${task.keyword}" ...`);
    try {
      const newItems = await scanTask(browser, db, task, args.limit || 30, args);
      allNewItems.push(...newItems);
      db.prepare("UPDATE tasks SET last_scan = datetime('now', 'localtime'), consecutive_empty = 0 WHERE id = ?").run(task.id);
      console.log(`   ✅ 发现 ${newItems.length} 件新商品`);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('RGV587') || msg.includes('Cookie') || msg.includes('登录') || msg.includes('COOKIE_EXPIRED')) {
        cookieExpired = true;
        console.error(`   ⚠️ Cookie 可能过期: ${msg}`);
      } else {
        // Track consecutive empty/error scans
        db.prepare("UPDATE tasks SET last_scan = datetime('now', 'localtime'), consecutive_empty = consecutive_empty + 1 WHERE id = ?").run(task.id);
        const count = db.prepare("SELECT consecutive_empty FROM tasks WHERE id = ?").get(task.id)?.consecutive_empty || 0;
        if (count >= 2) {
          cookieExpired = true;
          console.error(`   ⚠️ 连续 ${count} 次扫描失败，Cookie 可能已过期`);
        }
        console.error(`   ❌ 扫描失败: ${msg}`);
      }
    }
  }
  
  browser.disconnect();
  db.close();
  
  // Output summary as JSON for cron consumption
  if (allNewItems.length > 0) {
    console.log('\n--- NEW_ITEMS_JSON ---');
    console.log(JSON.stringify(allNewItems, null, 2));
    console.log('--- END_NEW_ITEMS_JSON ---');
  } else {
    console.log('\n本次扫描无新商品');
  }

  if (allNewItems.length > 0) writeDigest(allNewItems);

  if (cookieExpired) {
    console.log('\n--- COOKIE_EXPIRED ---');
  }
  
  return allNewItems;
}

async function scanTask(browser, db, task, limit, args = {}) {
  const newItems = [];
  
  try {
    // Get or create a goofish tab
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('goofish.com'));
    if (!page) {
      // 2026-11 实测：page.goto('https://www.goofish.com') 首页可正常打开（未被 baxia 拦截），
      // 只有「带搜索参数的搜索结果 URL」才可能触发登录墙。因此直接用 goto，失败再降级到地址栏输入。
      page = pages.find(p => !p.url().startsWith('chrome://')) || pages[0];
      if (!page) page = await browser.newPage();
      console.log('   首次访问闲鱼，正在打开首页...');
      let opened = false;
      try {
        await page.goto('https://www.goofish.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        opened = page.url().includes('goofish.com');
      } catch (e) {
        console.log('   goto 失败，降级地址栏导航:', e.message.split('\n')[0]);
      }
      if (!opened) {
        await navigateViaOmnibox(page, 'https://www.goofish.com');
        const newPages = await browser.pages();
        page = newPages.find(p => p.url().includes('goofish.com'));
      }
      if (!page || !page.url().includes('goofish.com')) {
        console.log('   ❌ 无法打开闲鱼');
        return newItems;
      }
      // Close login popup and wait for search input to be ready
      await page.evaluate(() => {
        document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"], [class*="dialog"] [class*="close"]')
          .forEach(btn => btn.click());
      }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(1000);
    }
    
    // Close login popups via DOM click + Escape
    await page.evaluate(() => {
      document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"], [class*="dialog"] [class*="close"]')
        .forEach(btn => btn.click());
    }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
    
    // KEY INSIGHT: page.goto() gets blocked by baxia, but typing in the search box works!
    // Use CDP Input events (page.click/type/press) to search via the on-page search box
    // Wait for search input to appear (may take time on first load)
    try {
      await page.waitForSelector('input[class*="search-input"]', { timeout: 10000 });
    } catch {
      console.log('   等待搜索框超时，尝试关闭弹窗...');
      await page.evaluate(() => {
        document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"], [class*="dialog"] [class*="close"]')
          .forEach(btn => btn.click());
      }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(2000);
    }
    await page.click('input[class*="search-input"]');
    await page.click('input[class*="search-input"]', { clickCount: 3 }); // select all existing text
    await sleep(200);
    await page.keyboard.type(task.keyword, { delay: 50 + Math.random() * 80 });
    await sleep(300 + Math.random() * 300);
    await page.keyboard.press('Enter');
    console.log('   使用搜索框输入关键词');
    
    // Wait for results to load
    await sleep(5000 + Math.random() * 2000);
    
    // Close popup again (goofish shows login popup on every page change)
    await page.evaluate(() => {
      document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"], [class*="dialog"] [class*="close"]')
        .forEach(btn => btn.click());
    }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
    
    // 区域筛选（服务端过滤，比文本匹配可靠）
    if (task.zone) {
      await applyZoneFilter(page, task.zone);
      await sleep(1500);
    }

    // Click "新发布" to sort by newest — use page.click (CDP Input event) not JS el.click()
    try {
      // Find the "新发布" button
      const foundNew = await page.evaluate(() => {
        const els = document.querySelectorAll('div, span, a');
        for (const el of els) {
          if (el.textContent?.trim() === '新发布' && el.offsetParent !== null) {
            el.setAttribute('data-xianyu-sort', 'new');
            return true;
          }
        }
        return false;
      });
      if (foundNew) {
        await page.click('[data-xianyu-sort="new"]');
        await sleep(1000);
        
        // Now click "最新" from the dropdown menu
        const foundLatest = await page.evaluate(() => {
          const els = document.querySelectorAll('div, span, a, li');
          for (const el of els) {
            if (el.textContent?.trim() === '最新' && el.offsetParent !== null) {
              el.setAttribute('data-xianyu-sort', 'latest');
              return true;
            }
          }
          return false;
        });
        
        if (foundLatest) {
          await page.click('[data-xianyu-sort="latest"]');
          console.log('   已切换为"新发布 -> 最新"排序');
          await sleep(3000 + Math.random() * 1000);
        } else {
          console.log('   点击了"新发布"，但未找到"最新"选项');
        }
      } else {
        console.log('   未找到"新发布"按钮');
      }
    } catch (e) {
      console.log('   切换排序失败:', e.message);
    }
    
    // Wait for items to appear
    let retries = 3;
    let domItems = [];
    while (retries-- > 0) {
      domItems = await page.evaluate(() => {
        const results = [];
        const cards = document.querySelectorAll('a[class*="feeds-item-wrap"]');
        for (const card of cards) {
          const href = card.href || '';
          const idMatch = href.match(/id=(\d+)/);
          if (!idMatch) continue;
          const id = idMatch[1];
          const text = card.innerText || '';
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          
          // Title: longest meaningful line
          let title = '';
          for (const line of lines) {
            if (line.length > 10 && !line.match(/^[¥￥\d]/) && !line.match(/^\d+[小时天分钟]+/)) {
              title = line; break;
            }
          }
          if (!title) title = lines[0] || '';
          
          const priceMatch = text.match(/[¥￥]\s*([\d,.]+)/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
          
          const timeMatch = text.match(/(\d+[小时天分钟]+前发布)/);
          const publishTime = timeMatch ? timeMatch[0] : '';
          
          const areaPatterns = text.match(/([\u4e00-\u9fa5]{2,}[市省区县])/g);
          const area = areaPatterns ? areaPatterns[0] : '';
          
          const wantMatch = text.match(/(\d+)人想要/);
          const wantCount = wantMatch ? parseInt(wantMatch[1]) : 0;
          
          const img = card.querySelector('img[src*="alicdn"], img[src*="goofish"]');
          const imageUrl = img ? img.src : '';
          
          results.push({ id, title, price, area, publishTime, wantCount, imageUrl });
        }
        return results;
      });
      
      if (domItems.length > 0) break;
      console.log('   等待页面加载...');
      await sleep(3000);
    }
    
    if (domItems.length === 0) {
      console.log('   未获取到搜索数据');
      return newItems;
    }
    
    console.log(`   获取到 ${domItems.length} 条搜索结果，开始过滤...`);
    
    const filterOut = task.filter_out ? task.filter_out.split(',').map(s => s.trim().toLowerCase()) : [];
    const mustInclude = task.must_include ? task.must_include.split(',').map(s => s.trim().toLowerCase()) : [];
    
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO items (id, task_id, title, price, area, seller, link, publish_time, want_count, tags, original_price, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let count = 0;
    for (const item of domItems) {
      if (count >= limit) break;
      
      const { id: itemId, title, price, publishTime, wantCount, imageUrl } = item;
      let area = item.area;
      if (!itemId) continue;
      
      const titleLower = title.toLowerCase();
      const link = `https://www.goofish.com/item?id=${itemId}`;
      
      // ---- Filters ----
      // 品牌白名单：只入库目标品牌整车，其他品牌与配件一律跳过（--all-brand 可临时关闭）
      // --all-brand 关闭品牌锁（查电池/配件行情时必须关，否则全被当配件剔掉）
      if (!args.allBrand && !isNinebot(title)) {
        if (process.env.XIANYU_DEBUG_BRAND) console.log(`   [品牌跳过] ${title.slice(0, 40)}`);
        continue;
      }

      // Time filter (--hours) — parse relative time like "16小时前发布"
      if (args.hours && publishTime) {
        const hMatch = publishTime.match(/(\d+)小时/);
        const dMatch = publishTime.match(/(\d+)天/);
        const mMatch = publishTime.match(/(\d+)分钟/);
        let hoursAgo = 0;
        if (hMatch) hoursAgo = parseInt(hMatch[1]);
        else if (dMatch) hoursAgo = parseInt(dMatch[1]) * 24;
        else if (mMatch) hoursAgo = parseInt(mMatch[1]) / 60;
        if (hoursAgo > args.hours) continue;
      }
      
      // Price filter
      if (task.max_price && price > task.max_price) continue;
      if (task.min_price && price < task.min_price) continue;
      
      // Region filter
      // 注意：未登录时闲鱼不返回地区信息，area 恒为空。若严格按地区丢弃，
      // 会把全部结果误杀。因此默认「宽松模式」：地区未知(area为空)时保留并打标，
      // 仅当标题/地区明确指向其他城市时才剔除。加 XIANYU_REGION_STRICT=1 可强制严格。
      if (task.region && !task.zone) {
        const regionWords = task.region.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const textToCheck = (title + ' ' + area).toLowerCase();
        const hit = regionWords.some(r => textToCheck.includes(r));
        if (!hit) {
          const strict = process.env.XIANYU_REGION_STRICT === '1';
          const areaUnknown = !area || !area.trim();
          if (strict || !areaUnknown) continue;   // 严格模式 / 已知异地 → 丢弃
          area = '地区待确认';                      // 未知地区 → 保留打标
        }
      }
      
      // Text filter: exclude
      if (filterOut.length && filterOut.some(f => titleLower.includes(f))) continue;
      
      // Text filter: must include
      if (mustInclude.length && !mustInclude.some(f => titleLower.includes(f))) continue;
      
      // Dedup check
      const existing = db.prepare('SELECT id FROM items WHERE id = ?').get(String(itemId));
      if (existing) continue;
      
      // Insert
      insertStmt.run(
        String(itemId), task.id, title, price, area, '未知', link,
        publishTime, wantCount, '[]', '', imageUrl
      );
      
      const newItem = {
        id: itemId, taskId: task.id, taskKeyword: task.keyword,
        title, price, area, seller: '未知', link, publishTime, wantCount,
        tags: [], originalPrice: '', imageUrl
      };
      newItems.push(newItem);
      count++;
    }
    
  } catch (err) {
    console.log(`   ❌ 扫描失败: ${err.message}`);
  }
  
  return newItems;
}

// ============ Helpers ============
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 跨平台「地址栏导航」——绕过闲鱼 baxia 风控（page.goto 会被拦）。
 * 核心：用可信输入事件（isTrusted=true）在浏览器地址栏输入 URL，
 * 而非 page.goto()。macOS 用 AppleScript，Windows 用 PowerShell SendKeys 驱动真实窗口，Linux 用 xdotool。
 */
async function navigateViaOmnibox(page, url) {
  const { execSync } = require('child_process');
  const platform = process.platform;
  if (platform === 'darwin') {
    execSync(`osascript -e 'tell application "Google Chrome" to activate'`);
    await sleep(300);
    execSync(`osascript -e 'tell application "System Events" to keystroke "l" using command down'`);
    await sleep(200);
    execSync(`osascript -e 'tell application "System Events" to keystroke "${url}"'`);
    await sleep(200);
    execSync(`osascript -e 'tell application "System Events" to key code 36'`); // Enter
  } else if (platform === 'win32') {
    const pid = process.env.XIANYU_CHROME_PID || readChromePid();
    const ps = [
      '$ws = New-Object -ComObject WScript.Shell',
      pid ? `$ok = $ws.AppActivate(${pid})` : `$ok = $ws.AppActivate(\'Google Chrome\')`,
      'Start-Sleep -Milliseconds 400',
      "$ws.SendKeys('^l')",
      'Start-Sleep -Milliseconds 250',
      `$ws.SendKeys('${url.replace(/'/g, "''")}')`,
      'Start-Sleep -Milliseconds 250',
      "$ws.SendKeys('~')"
    ].join('\n');
    const tmp = path.join(require('os').tmpdir(), 'xianyu_omnibox.ps1');
    fs.writeFileSync(tmp, ps, 'utf-8');
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`);
  } else {
    execSync(`xdotool search --onlyvisible --class chrome windowactivate`);
    await sleep(300);
    execSync(`xdotool key ctrl+l`);
    await sleep(200);
    execSync(`xdotool type '${url}'`);
    await sleep(200);
    execSync(`xdotool key Return`);
  }
  await sleep(6000);
}

function readChromePid() {
  try {
    if (fs.existsSync(PID_PATH)) return fs.readFileSync(PID_PATH, 'utf-8').trim();
  } catch {}
  return '';
}

/** 把新商品写成 Markdown 摘要，便于无邮件环境也能查看 */
function writeDigest(items) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const lines = [`# 闲鱼新商品提醒 ${new Date().toLocaleString('zh-CN')}`, ''];
    for (const it of items) {
      lines.push(`- 🛒 **${it.title}**`);
      lines.push(`  💰 ¥${it.price} | 📍 ${it.area} | ⏰ ${it.publishTime}`);
      lines.push(`  🔗 ${it.link}`);
      lines.push('');
    }
    fs.writeFileSync(path.join(dir, `digest-${ts}.md`), lines.join('\n'), 'utf-8');
    fs.writeFileSync(path.join(dir, 'last_digest.md'), lines.join('\n'), 'utf-8');
  } catch (e) { /* ignore */ }
}

// ============ CLI ============
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const parsed = { command };
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--keyword' || arg === '-k') parsed.keyword = args[++i];
    else if (arg === '--max-price') parsed.maxPrice = parseFloat(args[++i]);
    else if (arg === '--min-price') parsed.minPrice = parseFloat(args[++i]);
    else if (arg === '--region' || arg === '-r') parsed.region = args[++i];
    else if (arg === '--zone' || arg === '-z') parsed.zone = args[++i];
    else if (arg === '--filter' || arg === '-f') parsed.filter = args[++i];
    else if (arg === '--only' || arg === '-o') parsed.only = args[++i];
    else if (arg === '--id') parsed.id = parseInt(args[++i]);
    else if (arg === '--limit' || arg === '-l') parsed.limit = parseInt(args[++i]);
    else if (arg === '--hours') parsed.hours = parseFloat(args[++i]);
    else if (arg === '--all-brand') parsed.allBrand = true;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else parsed._ = (parsed._ || []).concat(arg);
  }
  return parsed;
}

function printHelp() {
  console.log(`
闲鱼监控工具 - xianyu.js

用法:
  node xianyu.js <command> [options]

命令:
  add       添加监控任务
  remove    停用监控任务
  list      查看所有活跃任务
  scan      执行扫描（所有任务或指定任务）
  history   查看发现历史

add 选项:
  --keyword, -k  搜索关键词（必填）
  --max-price    最高价格
  --min-price    最低价格
  --region, -r   地区筛选
  --filter, -f   标题排除词（逗号分隔）
  --only, -o     标题必含词（逗号分隔，满足任一即可）

scan 选项:
  --id           只扫描指定任务
  --limit, -l    每个任务最多处理条数（默认30）

history 选项:
  --id           只看指定任务
  --limit, -l    显示条数（默认20）

环境变量:
  XIANYU_CDP_PORT  Chrome CDP 端口（默认 18803）
  XIANYU_DB_PATH   数据库路径（默认 data/xianyu-monitor.db）

示例:
  node xianyu.js add -k "深圳龙华租房" --max-price 3000 -f "中介,房产,地产"
  node xianyu.js scan
  node xianyu.js list
  node xianyu.js history --limit 10
`);
}

// ============ 商品详情（只读，不触发聊天）============
async function cmdItem(args) {
  const itemId = (args._ && args._[0]) || (args.id ? String(args.id) : null);
  if (!itemId || !/^\d+$/.test(String(itemId))) {
    console.error('用法: node scripts/xianyu.js item <商品ID>');
    console.error('示例: node scripts/xianyu.js item 1234567890');
    process.exit(1);
  }
  if (!(await ensureChrome())) { console.error('❌ Chrome 不可用'); process.exit(1); }

  const db = getDb();
  const known = db.prepare('SELECT * FROM items WHERE id = ?').get(String(itemId));
  db.close();

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}` });
  try {
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('goofish.com')) || pages[0] || await browser.newPage();
    const url = `https://www.goofish.com/item?id=${itemId}`;
    console.log(`打开商品页: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    await page.evaluate(() => {
      document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"]').forEach(b => b.click());
    }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(800);

    const info = await page.evaluate(() => {
      const txt = document.body ? document.body.innerText : '';
      // 卖家主页链接
      const sellerLinks = Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.getAttribute('href'))
        .filter(h => h && (h.includes('/personal') || h.includes('userId') || h.includes('seller')));
      return {
        txt,
        title: document.title,
        sellerLinks: [...new Set(sellerLinks)].slice(0, 5),
        needLogin: /登录后|请先登录|扫码登录/.test(txt),
        canChat: /我想要|联系卖家/.test(txt)
      };
    });

    console.log('\n=== 页面标题 ===');
    console.log(info.title);
    if (known) {
      console.log('\n=== 库内记录 ===');
      console.log(`${known.title.slice(0, 120)} | ¥${known.price} | ${known.publish_time}`);
    }
    console.log('\n=== 页面正文（前 1500 字，含卖家区） ===');
    console.log(info.txt.slice(0, 1500));
    console.log('\n=== 卖家链接 ===');
    console.log(info.sellerLinks.length ? info.sellerLinks.join('\n') : '（未解析到）');
    console.log('\n=== 可聊状态 ===');
    console.log(`需要登录: ${info.needLogin} | 有「我想要」按钮: ${info.canChat}`);

    const shot = path.join(path.dirname(DB_PATH), `item_${itemId}.png`);
    await page.screenshot({ path: shot });
    console.log(`\n截图: ${shot}`);
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

async function main() {
  const args = parseArgs();
  
  switch (args.command) {
    case 'add': cmdAdd(args); break;
    case 'seed': cmdSeed(); break;
    case 'remove': cmdRemove(args); break;
    case 'list': cmdList(); break;
    case 'scan': await cmdScan(args); break;
    case 'history': cmdHistory(args); break;
    case 'item': await cmdItem(args); break;
    default:
      if (!args.command) printHelp();
      else console.error(`未知命令: ${args.command}\n运行 --help 查看帮助`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
