#!/usr/bin/env node
/**
 * young.js — 准新车筛选器（按真实车龄，不去年款标签）
 *
 * 设计出发点：
 *   闲鱼卖家写的「24款/25款/26款」是「车型版本」，不是「车龄」。
 *   一台标「25款」的车可能是 2026 年 4 月才激活；
 *   一台标「24款」的车可能是 2025 年 12 月买的。
 *   → 判断新旧只能用：激活/上牌日期 + 行驶里程 + 电池循环次数。
 *
 * 用法：
 *   node scripts/young.js                     # 全部准新车
 *   node scripts/young.js --model MZ          # 只看 Mz 系列
 *   node scripts/young.js --max-km 8000       # 里程上限
 *   node scripts/young.js --json              # 输出 JSON
 */
const fs = require('fs');
const path = require('path');
const { isNinebot, judge } = require('./lib-brand');

const DATA = process.env.XIANYU_MARKET_JSON || path.join(__dirname, '..', 'data', 'market-report.json');
const { readJsonOrExit } = require('./lib-guard');
const REF = new Date('2026-11-08');

// ---------- 中文数字 → 阿拉伯 ----------
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToNum(s) {
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  let total = 0, section = 0, num = 0;
  for (const ch of s) {
    if (CN_DIGIT[ch] != null) { num = CN_DIGIT[ch]; }
    else if (ch === '十') { section += (num || 1) * 10; num = 0; }
    else if (ch === '百') { section += (num || 1) * 100; num = 0; }
    else if (ch === '千') { section += (num || 1) * 1000; num = 0; }
    else if (ch === '万') { total += (section + num) * 10000; section = 0; num = 0; }
  }
  const v = total + section + num;
  return v > 0 ? v : null;
}

// ---------- 行驶里程提取（必须排除「续航」）----------
const NUM = '(\\d+(?:\\.\\d+)?|[零一二三四五六七八九十百千万两]+)';
function kmFrom(m) {
  if (!m) return null;
  const base = cnToNum(m[1]);
  if (base == null) return null;
  const wan = m[2] ? 10000 : 1;
  return Math.round(base * wan);
}
function extractKm(t) {
  // 显式「行驶/跑了/里程」引导
  let m = t.match(new RegExp('(?:行驶|安全行驶|已行驶|跑了|骑了|里程数?|总里程|行驶里程)\\s*(?:里程)?\\s*[:：大约约为]?\\s*' + NUM + '\\s*(万)?\\s*(?:多)?\\s*(?:公里|km)', 'i'));
  if (m) return kmFrom(m);
  // 「X公里」后置「行驶/里程」
  m = t.match(new RegExp(NUM + '\\s*(万)?\\s*(?:多)?\\s*(?:公里|km)\\s*(?:行驶|里程)', 'i'));
  if (m) return kmFrom(m);
  // 兜底：句中出现 X公里，但同句不得含「续航」
  const sentences = t.split(/[，。；;、\n]/);
  for (const s of sentences) {
    if (/续航|电池|充电|跑得到|能跑|速度|极速|码/.test(s)) continue;
    const mm = s.match(new RegExp(NUM + '\\s*(万)?\\s*(?:多)?\\s*(?:公里|km)', 'i'));
    if (mm) {
      const v = kmFrom(mm);
      if (v != null && v >= 100) return v; // 低于 100 的多为口误/配件描述
    }
  }
  return null;
}

// ---------- 激活/上牌日期（年份必须归一化为四位）----------
function extractAct(t) {
  const pats = [
    /(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})?\s*[日号]?\s*(?:激活|上牌|购买|买的|入手|提车)/,
    /(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(?:底|初|中)?\s*(?:激活|上牌|购买|买的|入手|提车)/,
    /(?:激活日期|上牌日期|购买日期)\s*[:：]?\s*(\d{2,4})[.\-/年]\s*(\d{1,2})/,
    /(\d{2,4})[.\-/](\d{1,2})[.\-/]\d{1,2}\s*(?:激活|上牌)/,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (!m) continue;
    let y = parseInt(m[1]);
    if (y < 100) y += 2000;          // 26 → 2026
    const mo = parseInt(m[2]);
    if (mo < 1 || mo > 12 || y < 2023 || y > 2030) continue;
    return { raw: `${y}-${String(mo).padStart(2, '0')}`, y, m: mo };
  }
  return null;
}

// ---------- 电池循环 ----------
function extractCycle(t) {
  const m = t.match(/循环\s*(\d+)\s*次/);
  return m ? parseInt(m[1]) : null;
}

// ---------- 年款标签 ----------
function extractVer(t) {
  const all = t.match(/(2[3-9])\s*款/g);
  if (!all) return null;
  return [...new Set(all.map(s => s.replace(/\s/g, '')))].join('/');
}

// ---------- 型号识别 ----------
const MODELS = [
  ['Mz MIX', /mz\s*mix|mzmix/i],
  ['Mz130', /mz\s*130/i],
  ['Mz330', /mz\s*330/i],
  ['Mz 其他', /九号\s*mz|\bmz\b/i],
  ['F2z', /f2z/i],
  ['F90', /f90/i],
  ['F60', /f60/i],
  ['Fz 系列', /\bfz\b/i],
  ['Nz 系列', /\bnz\b|nz\s*mix/i],
  ['N70C', /n\s*70\s*c/i],
  ['N85C/N80', /n\s*(85|80)\s*c?/i],
  ['M85C/M95C', /m\s*(85|95)\s*c/i],
  ['MMAX', /mmax|机械师/i],
  ['E 系列', /\be\s*(100|125|150|200|300)/i],
  ['Q 系列', /\bq\s*(80|85|90)/i],
  ['M385C/M3 系列', /m\s*385\s*c/i],
  ['V 系列', /\bv\s*(30|70)/i],
  ['A/B/C 系列', /九号\s*[abc]\s*\d{2}/i],
];

const NOISE = /出租|月租|日租|租车|押金|分期|首付|回收|高价收|车架|仅车架|定金|引流|一件代发|虚拟道具/;

function classify(title) {
  // 千分位空格归一：「总里程5 159公里」→「总里程5159公里」
  const t = title.replace(/\s+/g, ' ').replace(/(\d)\s+(\d)/g, '$1$2');
  const act = extractAct(t);
  const km = extractKm(t);
  const cyc = extractCycle(t);
  const ver = extractVer(t);
  let model = '未识别';
  for (const [name, re] of MODELS) { if (re.test(t)) { model = name; break; } }

  // 改装判定
  const modWords = /改了|改装|升级|换了|换装|定制|凌博|远驱|全顺|顿恩|智科|APT|apt|博世|MSO|mss|MSS|平叉|减震|控制器|电机|宽胎|半热熔|一体坐|短尾|护杠|尾箱/;
  const modified = modWords.test(t);
  // 原装声明
  const claimedStock = /原装|原厂|未改|无改|纯原|全原装/.test(t);
  // 空车
  const empty = /空车|不带电池|不含电池|不配电池|无电池|没电池/.test(t);
  const stockRhyme = /带电池|含电池|带电瓶|原装电池|锂电池.*带/.test(t);

  return { model, act, km, cyc, ver, modified, claimedStock, empty, battery: stockRhyme && !empty };
}

function monthsSince(a) {
  if (!a) return null;
  return (REF.getFullYear() - a.y) * 12 + (REF.getMonth() + 1 - a.m);
}

function main() {
  const argv = process.argv.slice(2);
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const modelFilter = get('--model', null);
  const maxKm = parseInt(get('--max-km', '999999'));
  const maxAge = parseInt(get('--max-age', '9999'));
  const asJson = argv.includes('--json');
  const allBrand = argv.includes('--all-brand');   // 关闭品牌白名单（默认只留 config/brand.json 里的品牌）

  const d = readJsonOrExit(DATA, '请先跑市场采样：node scripts/market.js <关键词1> <关键词2> ...');
  const raw = d.raw || [];

  const rows = [];
  for (const r of raw) {
    const c = classify(r.title || '');
    const age = monthsSince(c.act);
    rows.push({ ...r, ...c, age });
  }

  // 型号价格中位（用于识别引流）
  const byModel = {};
  for (const r of rows) {
    if (!r.price || r.price < 300) continue;
    (byModel[r.model] = byModel[r.model] || []).push(r.price);
  }
  const med = {};
  for (const k in byModel) {
    const a = byModel[k].sort((x, y) => x - y);
    med[k] = a[Math.floor(a.length / 2)];
  }

  let list = rows.filter(r => {
    if (!allBrand && !isNinebot(r.title)) return false;  // 品牌白名单过滤
    if (NOISE.test(r.title)) return false;              // 租赁/分期/回收/车架
    if (!r.price || r.price < 300) return false;        // 明显引流标价
    if (modelFilter && !r.model.toLowerCase().includes(modelFilter.toLowerCase())) return false;
    if (r.km != null && r.km > maxKm) return false;
    if (r.age != null && r.age > maxAge) return false;
    return true;
  });

  // 引流标记：价格低于同型号中位 55%
  for (const r of list) {
    const m = med[r.model];
    r.cheapBait = m && r.price < m * 0.55;
  }
  list = list.filter(r => !r.cheapBait);

  // 车龄分层
  const grade = (r) => {
    if (r.age != null) {
      if (r.age <= 14) return 'A';
      if (r.age <= 24) return 'B';
      return 'C';
    }
    if (r.km != null && r.km <= 3000) return 'A';
    if (r.km != null && r.km <= 10000) return 'B';
    return 'D';
  };
  for (const r of list) r.grade = grade(r);

  list.sort((a, b) => {
    const ga = a.grade, gb = b.grade;
    if (ga !== gb) return ga.localeCompare(gb);
    const aa = a.age == null ? 99 : a.age, ab = b.age == null ? 99 : b.age;
    if (aa !== ab) return aa - ab;
    const ka = a.km == null ? 999999 : a.km, kb = b.km == null ? 999999 : b.km;
    return ka - kb;
  });

  if (asJson) { console.log(JSON.stringify(list, null, 2)); return; }

  const label = { A: 'A级 准新车（≤14个月或≤3000km）', B: 'B级 成长期（15-24个月 或 3000-10000km）', C: 'C级 老车（>24个月）', D: 'D级 车龄不明' };
  console.log(`\n数据源 ${raw.length} 条 → 有效 ${list.length} 条；价格中位参考：${Object.entries(med).map(([k, v]) => k + ' ¥' + v).join(' | ')}\n`);

  let cur = '';
  for (const r of list) {
    if (r.grade !== cur) { cur = r.grade; console.log('\n═══ ' + label[cur] + ' ═══'); }
    const flags = [
      r.ver ? '款:' + r.ver : null,
      r.act ? '激活:' + r.act.raw : null,
      r.km != null ? r.km + 'km' : null,
      r.cyc ? '循环' + r.cyc : null,
      r.empty ? '空车' : (r.battery ? '带电池' : null),
      r.claimedStock ? '称原装' : null,
      r.modified ? '有改装' : null,
      '想要' + (r.wantCount || 0),
    ].filter(Boolean).join(' · ');
    console.log(`¥${String(r.price).padEnd(5)} ${r.model.padEnd(9)} ${flags}`);
    console.log(`       ${(r.title || '').replace(/\s+/g, ' ').slice(0, 130)}`);
    console.log(`       https://www.goofish.com/item?id=${r.id}`);
  }
  console.log('');
}

main();
