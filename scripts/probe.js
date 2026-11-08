// DOM 排障探针 —— 闲鱼前端改版时用它确认选择器是否还有效
// 用法: node scripts/probe.js ["关键词"]
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = process.env.XIANYU_CDP_PORT || 18803;
const KEYWORD = process.argv[2] || '4G 随身WiFi';

(async () => {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const pages = await browser.pages();
  let page = pages.find(p => p.url().includes('goofish.com')) || pages[0];

  console.log('[1] CDP 连接成功，页面数:', pages.length);

  if (!page.url().includes('goofish.com')) {
    await page.goto('https://www.goofish.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
  }
  console.log('[2] 首页:', page.url(), '|', await page.title());

  await page.evaluate(() => {
    document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"]').forEach(b => b.click());
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(800);

  const hasInput = await page.evaluate(() => !!document.querySelector('input[class*="search-input"]'));
  console.log('[3] 搜索框选择器 input[class*="search-input"]:', hasInput);
  if (!hasInput) {
    const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(i => `${i.className}|${i.placeholder}`));
    console.log('    当前所有 input:', JSON.stringify(inputs));
    browser.disconnect();
    return;
  }

  await page.click('input[class*="search-input"]');
  await page.click('input[class*="search-input"]', { clickCount: 3 });
  await sleep(200);
  await page.keyboard.type(KEYWORD, { delay: 60 });
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(6000);

  await page.evaluate(() => {
    document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"]').forEach(b => b.click());
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(800);

  console.log('[4] 搜索后:', page.url(), '|', await page.title());

  const stat = await page.evaluate(() => {
    const cards = document.querySelectorAll('a[class*="feeds-item-wrap"]');
    const bodyTxt = document.body ? document.body.innerText : '';
    return {
      cardCount: cards.length,
      hrefSample: cards[0] ? cards[0].getAttribute('href') : null,
      firstCardText: cards[0] ? cards[0].innerText.slice(0, 150) : null,
      loginState: /分钟前发布/.test(bodyTxt) ? '已登录(有分钟级新品)' : '未登录/仅6小时前',
      blocked: /非法|滑动验证|请登录后查看/.test(bodyTxt)
    };
  });
  console.log('[5] 卡片选择器 a[class*="feeds-item-wrap"] 命中:', stat.cardCount);
  console.log('[6] 登录状态判断:', stat.loginState);
  console.log('[7] 疑似被拦:', stat.blocked);
  console.log('[8] 样本链接:', stat.hrefSample);
  console.log('[9] 首张卡片文本:', JSON.stringify(stat.firstCardText));

  browser.disconnect();
})().catch(e => {
  console.error('PROBE FAILED:', e.message);
  process.exit(1);
});
