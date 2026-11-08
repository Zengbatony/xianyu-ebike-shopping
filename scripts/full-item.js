#!/usr/bin/env node
// 全量抓取单个闲鱼商品详情：完整描述 + 参数栏 + 卖家信息 + 留言
// 用法: node scripts/full-item.js <itemId> [--json]
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CDP_PORT = process.env.CDP_PORT || 18803;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const id = process.argv[2];
  if (!id) { console.error('用法: node scripts/full-item.js <itemId>'); process.exit(1); }
  const asJson = process.argv.includes('--json');

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}` });
  try {
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('goofish.com')) || pages[0] || await browser.newPage();
    await page.goto(`https://www.goofish.com/item?id=${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4500);

    // 关掉弹层
    await page.evaluate(() => {
      document.querySelectorAll('[class*="closeIcon"],[class*="close-btn"],[class*="close"]').forEach(b => {
        try { b.click(); } catch (e) {}
      });
    }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(600);

    // 滚动加载（详情页描述较短，但评论区/留言需滚）
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 900));
      await sleep(600);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(400);

    const data = await page.evaluate(() => {
      const clean = s => (s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
      const txt = document.body ? document.body.innerText : '';

      // 参数栏：闲鱼是「品牌：xxx」这种竖排 label/value 结构，innerText 里会被拆成单字
      const params = {};
      document.querySelectorAll('[class*="desc--"] li, [class*="item--"] li, [class*="params"] li').forEach(li => {
        const t = clean(li.innerText);
        const m = t.match(/^(.{2,8}?)\s*[：:]\s*([\s\S]+)$/);
        if (m) params[clean(m[1])] = clean(m[2]).replace(/\n+/g, ' ');
      });

      // 卖家区
      const sellerBox = document.querySelector('[class*="seller-container"],[class*="seller"]');
      const sellerTxt = clean(sellerBox ? sellerBox.innerText : '');

      // 描述区（标题下方正文）
      const descEl = document.querySelector('[class*="desc"],[class*="content"]');
      const descTxt = clean(descEl ? descEl.innerText : '');

      return { txt, params, sellerTxt, descTxt, url: location.href };
    });

    if (asJson) {
      console.log(JSON.stringify({ id, ...data }, null, 1));
    } else {
      console.log('=== 全量正文 ===');
      console.log(data.txt);
      console.log('\n=== 参数栏（解析） ===');
      console.log(Object.keys(data.params).length ? JSON.stringify(data.params, null, 1) : '（未解析到）');
    }

    const shot = path.join(path.dirname(require.resolve('../data/xianyu-monitor.db')), `item_full_${id}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    if (!asJson) console.log(`\n全页截图: ${shot}`);
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
})().catch(e => { console.error(e); process.exit(1); });
