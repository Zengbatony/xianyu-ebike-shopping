// 九号电动车市场调研 —— 全国范围多关键词采样，分析型号热度 / 改装比例 / 价格带
// 用法: node scripts/market.js [关键词1] [关键词2] ...
// 默认跑内置关键词组；结果写 data/market-report.json 并在终端输出排行

const path = require('path');
const fs = require('fs');
const { isNinebot } = require('./lib-brand');
const puppeteer = require('puppeteer-core');

const PORT = process.env.XIANYU_CDP_PORT || 18803;
const OUT_DIR = path.join(__dirname, '..', 'data');

const DEFAULT_KEYWORDS = ['九号电动车', '九号MZ', '九号F90', '九号Nz', '九号MMAX', '九号E系列'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Chrome 自愈 ----------
async function cdpAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cands = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  return cands.find(p => p && fs.existsSync(p)) || null;
}

async function ensureChrome() {
  if (await cdpAlive()) return true;
  const chrome = findChrome();
  if (!chrome) { console.error('找不到 chrome.exe'); return false; }
  const profileDir = path.join(OUT_DIR, 'chrome-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  console.log('Chrome 未运行，自动启动...');
  const { spawn } = require('child_process');
  const child = spawn(chrome, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    if (await cdpAlive()) { console.log('Chrome 已就绪'); return true; }
  }
  return false;
}

// 主要城市白名单（闲鱼卡片上的地区通常只写城市名）
const CITY_LIST = ['深圳', '广州', '东莞', '佛山', '惠州', '中山', '珠海', '江门', '肇庆',
  '北京', '上海', '天津', '重庆', '杭州', '南京', '苏州', '武汉', '成都', '西安', '长沙',
  '郑州', '济南', '青岛', '合肥', '福州', '厦门', '泉州', '南昌', '昆明', '南宁', '贵阳',
  '石家庄', '太原', '沈阳', '长春', '哈尔滨', '大连', '无锡', '常州', '宁波', '温州',
  '金华', '台州', '绍兴', '嘉兴', '湖州', '徐州', '临沂', '潍坊', '汕头', '揭阳', '汕尾'];

// ---------- 型号识别（具体优先）----------
const MODEL_RULES = [
  ['Mz MIX', /mz\s*mix|mzmix/i],
  ['Mz MAX', /mz\s*max(?!\s*mix)/i],
  ['Mz130', /mz\s*130/i],
  ['Mz330', /mz\s*330/i],
  ['Mz25/26款', /mz\s*2[56]\s*款/i],
  ['Mz 其他', /九号\s*mz|\bmz\b/i],
  ['F2z', /f2z/i],
  ['F90', /f90/i],
  ['F60', /f60/i],
  ['Fz 系列', /\bfz\b|fzmix|fz\s*110|fz\s*\d{3}/i],
  ['Nz 系列', /\bnz\b|nzmix|nz\s*90/i],
  ['N70/N85/N100', /n\s*(70|85|100)/i],
  ['MMAX', /mmax|m\s*max/i],
  ['E 系列', /\be\s*(100|125|150|200|300)/i],
  ['Q 系列', /\bq\s*(80|90)/i],
  ['V 系列', /\bv\s*(30|70)/i],
  ['A/B/C 系列', /九号\s*[abc]\s*\d{2}/i],
  ['滑板/卡丁车', /滑板车|卡丁车|平衡车/i]
];

function detectModel(title) {
  for (const [name, re] of MODEL_RULES) {
    if (re.test(title)) return name;
  }
  return '未识别';
}

// ---------- 改装识别 ----------
// 强改装信号（明确表示动过车）
const MOD_STRONG = /改装|爆改|升级|换了|加装|改好|已改|改的|凌博|全顺|远驱|智科|欧老师|APT\s*\d|mms|明哲|米其林|倍耐力|天使胎|风冷|水冷|锂电|换电|一体座|尾架|尾箱|大灯改|平叉|卡钳|减震改|刷程序|解码/i;
// 原装信号
const STOCK = /原装|未改装|没改|素车|原厂|无改装|原车|未动|没动过|原封|全原装/i;

function classifyMod(title) {
  const stock = STOCK.test(title);
  const mod = MOD_STRONG.test(title);
  if (stock && !/改装|爆改/.test(title)) return '原装';
  if (mod) return '改装';
  if (stock) return '原装';
  return '未标注';
}

// ---------- 时间解析 ----------
function hoursAgo(publishTime) {
  if (!publishTime) return null;
  let m = publishTime.match(/(\d+)分钟/);
  if (m) return parseInt(m[1]) / 60;
  m = publishTime.match(/(\d+)小时/);
  if (m) return parseInt(m[1]);
  m = publishTime.match(/(\d+)天/);
  if (m) return parseInt(m[1]) * 24;
  return null;
}

// ---------- 抓取单个关键词 ----------
async function scrapeKeyword(browser, keyword) {
  const pages = await browser.pages();
  let page = pages.find(p => p.url().includes('goofish.com')) || pages[0];
  if (!page) page = await browser.newPage();

  if (!page.url().includes('goofish.com')) {
    await page.goto('https://www.goofish.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
  }

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"]').forEach(b => b.click());
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(600);

  // 搜索框输入
  const hasInput = await page.evaluate(() => !!document.querySelector('input[class*="search-input"]'));
  if (!hasInput) { console.log(`   [${keyword}] 找不到搜索框`); return []; }

  await page.click('input[class*="search-input"]');
  await page.click('input[class*="search-input"]', { clickCount: 3 });
  await sleep(200);
  await page.keyboard.type(keyword, { delay: 55 + Math.random() * 60 });
  await sleep(350 + Math.random() * 300);
  await page.keyboard.press('Enter');
  await sleep(5500 + Math.random() * 2000);

  await page.evaluate(() => {
    document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"]').forEach(b => b.click());
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(700);


  // 保持「综合」排序：这是闲鱼平台自己的推荐排序，位置越靠前 = 平台判定越热销/越易成交。
  // 这是衡量「好不好卖」最直接的信号，比「想要」数准（新帖的想要数还没累积）。

  const items = await page.evaluate((cities) => {
    const out = [];
    const cards = document.querySelectorAll('a[class*="feeds-item-wrap"]');
    let rank = 0;
    for (const card of cards) {
      const href = card.href || '';
      const idMatch = href.match(/id=(\d+)/);
      if (!idMatch) continue;
      const text = card.innerText || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      let title = '';
      for (const line of lines) {
        if (line.length > 10 && !line.match(/^[¥￥\d]/) && !line.match(/^\d+[小时天分钟]+/)) { title = line; break; }
      }
      if (!title) title = lines[0] || '';
      const priceMatch = text.match(/[¥￥]\s*([\d,.]+)/);
      const timeMatch = text.match(/(\d+[小时天分钟]+前发布)/);
      let area = '';
      for (const c of cities) { if (text.includes(c)) { area = c; break; } }
      const wantMatch = text.match(/(\d+)人想要/);
      out.push({
        id: idMatch[1],
        rank: ++rank,
        title,
        price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0,
        area,
        publishTime: timeMatch ? timeMatch[0] : '',
        wantCount: wantMatch ? parseInt(wantMatch[1]) : 0
      });
    }
    return out;
  }, CITY_LIST);

  console.log(`   [${keyword}] 抓到 ${items.length} 条`);
  return items.map(it => ({ ...it, keyword }));
}

// ---------- 统计 ----------
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function aggregate(rows) {
  const byModel = {};
  for (const r of rows) {
    const model = detectModel(r.title);
    const mod = classifyMod(r.title);
    const hrs = hoursAgo(r.publishTime);
    if (!byModel[model]) byModel[model] = {
      model, count: 0, want: 0, prices: [], wants: [], areas: {}, ranks: [],
      stock: 0, modified: 0, unlabeled: 0, recent: 0, top10: 0, sample: []
    };
    const g = byModel[model];
    g.count++;
    if (r.rank) { g.ranks.push(r.rank); if (r.rank <= 10) g.top10++; }
    g.want += r.wantCount;
    if (r.price > 100) g.prices.push(r.price);
    g.wants.push(r.wantCount);
    if (r.area) g.areas[r.area] = (g.areas[r.area] || 0) + 1;
    if (mod === '原装') g.stock++;
    else if (mod === '改装') g.modified++;
    else g.unlabeled++;
    if (hrs !== null && hrs <= 48) g.recent++;
    if (g.sample.length < 2 && mod === '原装') g.sample.push(r.title.slice(0, 60));
  }
  return Object.values(byModel).map(g => {
    const areaTop = Object.entries(g.areas).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}×${v}`).join(' ') || '—';
    return {
      model: g.model,
      count: g.count,
      top10: g.top10,
      avgRank: g.ranks.length ? +(g.ranks.reduce((a, b) => a + b, 0) / g.ranks.length).toFixed(1) : 0,
      totalWant: g.want,
      medianWant: median(g.wants),
      priceMin: g.prices.length ? Math.min(...g.prices) : 0,
      priceMax: g.prices.length ? Math.max(...g.prices) : 0,
      priceMedian: median(g.prices),
      stockRatio: g.count ? Math.round(g.stock / g.count * 100) : 0,
      modRatio: g.count ? Math.round(g.modified / g.count * 100) : 0,
      unlabeled: g.unlabeled,
      recent48h: g.recent,
      areaTop,
      sample: g.sample
    };
  }).sort((a, b) => (b.top10 - a.top10) || (a.avgRank - b.avgRank));
}

// ---------- 主流程 ----------
(async () => {
  const keywords = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_KEYWORDS;
  if (!(await ensureChrome())) { console.error('Chrome 不可用'); process.exit(1); }

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const all = [];
  const seen = new Set();
  let skipped = 0;

  try {
    for (const kw of keywords) {
      try {
        const rows = await scrapeKeyword(browser, kw);
        let added = 0;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          if (!isNinebot(r.title)) { skipped = (skipped || 0) + 1; continue; }  // 品牌白名单过滤（config/brand.json）
          seen.add(r.id);
          all.push(r);
          added++;
        }
        console.log(`   → 新增去重后 ${added} 条（累计 ${all.length}）`);
      } catch (e) {
        console.log(`   [${kw}] 失败: ${e.message.split('\n')[0]}`);
      }
      await sleep(8000 + Math.random() * 5000);  // 防风控
    }
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }

  if (!all.length) { console.log('没抓到数据'); process.exit(1); }

  const ranked = aggregate(all);

  console.log('\n' + '='.repeat(78));
  console.log(`九号全国市场采样 | 关键词 ${keywords.length} 个 | 去重样本 ${all.length} 条`);
  console.log('='.repeat(78));
  console.log('\n【型号热度榜】按「综合排序 TOP10 占席」降序（越靠前=平台越主推=越好卖）\n');
  console.log('型号'.padEnd(13) + '挂牌'.padStart(5) + 'TOP10'.padStart(7) + '均名次'.padStart(7)
    + '想要合计'.padStart(9) + '均价'.padStart(8) + '价区间'.padStart(13) + '原装%'.padStart(7) + '改装%'.padStart(7) + '48h'.padStart(6));
  console.log('-'.repeat(86));
  for (const r of ranked) {
    console.log(
      r.model.padEnd(13) +
      String(r.count).padStart(5) +
      String(r.top10).padStart(7) +
      String(r.avgRank || '-').padStart(7) +
      String(r.totalWant).padStart(9) +
      String(r.priceMedian).padStart(8) +
      `${r.priceMin}-${r.priceMax}`.padStart(13) +
      String(r.stockRatio).padStart(7) +
      String(r.modRatio).padStart(7) +
      String(r.recent48h).padStart(6)
    );
  }

  console.log('\n【地区分布（前3）】');
  for (const r of ranked.slice(0, 8)) console.log(`  ${r.model.padEnd(14)} ${r.areaTop}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'market-report.json');
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), keywords, totalSample: all.length, ranked, raw: all }, null, 2), 'utf-8');
  console.log(`\n原始数据: ${outFile}`);
})();
