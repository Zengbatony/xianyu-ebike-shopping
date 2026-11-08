#!/usr/bin/env node
/**
 * m-report.js — 生成「九号某系列 × 某区域」的 Markdown 行情报告
 *
 * 用法：node scripts/m-report.js [--tasks 2,7,8,9,10] [--out 报告.md]
 *
 * 清洗顺序：
 *   1. 品牌锁 lib-brand（含仿冒排除）
 *   2. 价格 500–8000（¥1/¥2 是改装党的报价引流惯例，不是真实标价）
 *   3. 分期/以租代购/押金 剔除
 *   4. 型号堆砌（标题出现 ≥3 个型号）= 商家引流贴，剔除
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { isNinebot, judge } = require('./lib-brand');

const DB = process.env.XIANYU_DB_PATH || path.join(__dirname, '..', 'data', 'xianyu-monitor.db');
const { openDbOrExit } = require('./lib-guard');

const INSTALMENT = /(分期|芬期|首付|手付|以租代购|押金|租金|日租|月租|出租)/;
const MODELS = [
  ['Mz MIX', /mz\s*mix|mzmix/i],
  ['Mz130', /mz\s*130/i],
  ['Mz330 闪骑', /mz\s*330|330\s*闪骑/i],
  ['Mz MAX', /mz\s*max/i],
  ['MMAX 机械师', /mmax|机械师/i],
  ['M95C / M85C', /m\s*9[05]\s*c/i],
  ['Mz 未细分', /(?<![a-z])mz(?![a-z])/i],
];
const MODEL_HITS = [
  /mz\s*mix|mzmix/ig, /mz\s*130/ig, /mz\s*330/ig, /mz\s*max/ig,
  /mmax|机械师/ig, /m\s*9[05]\s*c/ig, /nz\s*mix|nz/ig, /f2z/ig, /f90/ig,
];
function isStacking(t) {
  let n = 0;
  for (const re of MODEL_HITS) { re.lastIndex = 0; if (re.test(t)) n++; }
  return n >= 3;
}

function pickModel(t) {
  for (const [name, re] of MODELS) if (re.test(t)) return name;
  return '其他';
}

function extractSignals(t) {
  const s = {};
  const km = t.match(/(?:行驶|安全行驶|跑了|骑了|总里程|里程)\s*[:：大约]?\s*([\d.]+)\s*(万)?\s*(?:多)?\s*(?:公里|km)/i);
  if (km) s.km = Math.round(parseFloat(km[1]) * (km[2] ? 10000 : 1));
  const act = t.match(/(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})?\s*[日号]?\s*(?:激活|上牌|购买|买的|入手)/);
  if (act) {
    let y = parseInt(act[1]); if (y < 100) y += 2000;
    s.act = `${y}-${String(parseInt(act[2])).padStart(2, '0')}`;
  }
  s.empty = /空车|不带电池|不含电池|不配电池|没电池/.test(t);
  s.battery = !s.empty && /带电池|含电池|带电瓶|锂电|铅酸|原装电池|大电池/.test(t);
  s.plate = /带牌|白牌|绿牌|蓝牌|黄牌|上牌|可过户|过户/.test(t);
  s.mod = /改了|改装|升级|换了|凌博|远驱|全顺|顿哲|智科|APT|apt|平叉|减震|控制器|电机|半热熔|一体坐|短尾|护杠/.test(t);
  s.stock = /原装|原厂|未改|无改|纯原|全原装/.test(t);
  return s;
}

function median(a) { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }

function main() {
  const argv = process.argv.slice(2);
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const taskIds = (get('--tasks', '2,7,8,9,10')).split(',').map(Number);
  const outFile = get('--out', null);

  const db = openDbOrExit(DB);
  const all = db.prepare(`SELECT * FROM items WHERE task_id IN (${taskIds.map(() => '?').join(',')})`).all(...taskIds);
  db.close();

  const seen = new Set();
  const uniq = [];
  for (const r of all) { if (seen.has(r.id)) continue; seen.add(r.id); uniq.push(r); }

  const stats = { total: uniq.length, fake: 0, accessory: 0, instalment: 0, weirdPrice: 0, stacking: 0 };
  const kept = [];
  for (const r of uniq) {
    const t = (r.title || '').replace(/\s+/g, ' ');
    const j = judge(t);
    if (!j.ok) { if (j.fake) stats.fake++; else stats.accessory++; continue; }
    if (INSTALMENT.test(t)) { stats.instalment++; continue; }
    if (!r.price || r.price < 500 || r.price > 8000) { stats.weirdPrice++; continue; }
    if (isStacking(t)) { stats.stacking++; continue; }
    kept.push({ ...r, t, sig: extractSignals(t), model: pickModel(t) });
  }

  // 按型号聚合
  const groups = {};
  for (const r of kept) (groups[r.model] = groups[r.model] || []).push(r);

  const order = ['Mz130', 'Mz MIX', 'Mz MAX', 'Mz330 闪骑', 'MMAX 机械师', 'M95C / M85C', 'Mz 未细分', '其他'];
  const lines = [];
  const P = (s = '') => lines.push(s);

  P('# 九号 M 系列 · 珠三角在售行情');
  P('');
  P(`**采样**：2026-11-08 19:52–19:55，闲鱼「区域=珠三角」服务端筛选 × 5 组关键词`);
  P(`**原始** ${stats.total} 条 → 有效 **${kept.length} 条**（剔除：仿冒 ${stats.fake}、配件/非整车 ${stats.accessory}、分期租购 ${stats.instalment}、异常标价 ${stats.weirdPrice}、型号堆砌 ${stats.stacking}）`);
  P('');
  P('---');
  P('');
  P('## 一、型号横向对比');
  P('');
  P('| 型号 | 在售 | 价格带 | 中位价 | 空车占比 | 改装占比 | 判断 |');
  P('|---|---|---|---|---|---|---|');

  const judgeMap = {
    'Mz130': '准新供给最猛，价格已塌',
    'Mz MIX': '改装最盛，原装稀缺',
    'Mz MAX': '高配（ABS/TCS），二手溢价',
    'Mz330 闪骑': '小众高配，流通少',
    'MMAX 机械师': '大改为主，议价空间大',
    'M95C / M85C': '低端走量，外卖车多',
    'Mz 未细分': '标题未写具体型号',
    '其他': '待人工归类',
  };

  for (const name of order) {
    const g = groups[name];
    if (!g || !g.length) continue;
    const prices = g.map(r => r.price);
    const emptyRatio = Math.round(g.filter(r => r.sig.empty).length / g.length * 100);
    const modRatio = Math.round(g.filter(r => r.sig.mod).length / g.length * 100);
    P(`| **${name}** | ${g.length} | ¥${Math.min(...prices)}–${Math.max(...prices)} | **¥${median(prices)}** | ${emptyRatio}% | ${modRatio}% | ${judgeMap[name] || ''} |`);
  }
  P('');

  // 明细
  P('---');
  P('');
  P('## 二、各型号明细（按价格升序）');
  for (const name of order) {
    const g = groups[name];
    if (!g || !g.length) continue;
    const prices = g.map(r => r.price);
    P('');
    P(`### ${name}　${g.length} 条 · 中位 ¥${median(prices)}`);
    P('');
    P('| 价格 | 车龄信号 | 电池 | 牌/过户 | 改装 | 标题要点 |');
    P('|---|---|---|---|---|---|');
    for (const r of [...g].sort((a, b) => a.price - b.price)) {
      const s = r.sig;
      const age = [s.act ? `激活${s.act}` : '', s.km != null ? `${s.km}km` : ''].filter(Boolean).join(' ') || '—';
      const bat = s.empty ? '**空车**' : (s.battery ? '带电池' : '—');
      const plate = s.plate ? '✅' : '—';
      const mod = s.mod ? (s.stock ? '部分改' : '**改装**') : '原装';
      P(`| ¥${r.price} | ${age} | ${bat} | ${plate} | ${mod} | ${r.t.slice(0, 56).replace(/\|/g, '/')} |`);
    }
    P('');
    P('> 链接：' + [...g].sort((a, b) => a.price - b.price).slice(0, 5).map(r => `¥${r.price} https://www.goofish.com/item?id=${r.id}`).join('　'));
  }

  const md = lines.join('\n');
  if (outFile) { fs.writeFileSync(outFile, md, 'utf-8'); console.log('已写入 ' + outFile); }
  else console.log(md);

  console.log(`\n[统计] 原始 ${stats.total}，有效 ${kept.length}，仿冒 ${stats.fake}，配件 ${stats.accessory}，分期 ${stats.instalment}，异常价 ${stats.weirdPrice}，堆砌 ${stats.stacking}`);
}

main();
