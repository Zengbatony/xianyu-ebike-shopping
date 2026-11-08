#!/usr/bin/env node
/**
 * mmax.js — 九号 MMAX 机械师系列 代际细分分析
 *
 * 为什么需要单独一个脚本：
 *   MMAX 是九号命名最混乱的一条产品线。同一个词「机械师110」在闲鱼上至少指向 3 个不同代际：
 *     MMAX110 / MMAX110P（一代，带 ABS）
 *     MMax2 110P（机械师二代）
 *     MMAX110 MK2（26 款，再改款）
 *   三者价格差 2000-3000，混在一起统计会得出完全错误的行情结论。
 *   所以必须按「代际优先级」判定，而不是按字面型号字符串匹配。
 *
 * 用法：
 *   node scripts/mmax.js                       # 全部 MMAX 车源按代际分组
 *   node scripts/mmax.js --json                # JSON 输出
 *   node scripts/mmax.js --task 11,12,13,14    # 限定任务
 *   node scripts/mmax.js --md <out.md>         # 导出 Markdown 报告
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { judge } = require('./lib-brand');

// 屏蔽 node:sqlite 实验性告警
const _emitWarning = process.emitWarning;
process.emitWarning = function (w, ...r) {
  const msg = typeof w === 'string' ? w : (w && w.message) || '';
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return _emitWarning.call(process, w, ...r);
};

const DB_PATH = process.env.XIANYU_DB_PATH || path.join(__dirname, '..', 'data', 'xianyu-monitor.db');

// ---------- 代际判定（顺序即优先级，匹配到即停）----------
// 注意：判断顺序不能乱。MK2 必须先于 110P，二代必须先于一代，
// 否则「MMax2 110P」会被 110P 规则错抓成一代。
// 「机械师max90」「机械师Max110」是闲鱼最常见的简写，必须支持裸 max+数字。
// 但 (?<!mz\s) 是必需的：Mz MAX 是另一个车型，不能被当成 MMAX110。
const MX = '(?:mmax|机械师|m\\s*max|(?<!mz\\s)max)';
const GEN_RULES = [
  { gen: 'MMAX110 MK2', re: /mk\s*2|26\s*款.*机械师|机械师.*26\s*款/i, ord: 4 },
  { gen: 'MMAX2 (机械师二代)', re: /机械师\s*二代|二代\s*机械师|mmax\s*2|mmax2|机械师\s*2(?![0-9])|mm\s*2\s*110|明日香/i, ord: 3 },
  { gen: 'MMAX110P (一代带ABS)', re: new RegExp(`${MX}\\s*110\\s*p|110\\s*p\\b`, 'i'), ord: 2.5 },
  { gen: 'MMAX110 (一代)', re: new RegExp(`${MX}\\s*110|mmax110`, 'i'), ord: 2 },
  { gen: 'MMAX90', re: new RegExp(`${MX}\\s*90|mmax90`, 'i'), ord: 1 },
  { gen: 'MMAX (未标细号)', re: /mmax|机械师|m\s*max/i, ord: 0 }
];

// 「机械师靠背」「机械师坐垫」是配件描述，主体可能是 Mz/F 系车 —— 不能算 MMAX 整车
const MMAX_ACCESSORY_ONLY = /机械师\s*(靠背|坐垫|后视镜|尾箱|挡泥|脚踏|减震|把套|贴纸|大灯)/;
// 标题主语是其他九号车系时，MMAX 词只是形容词（如「加了机械师靠背」）
const OTHER_NINEBOT_SUBJECT = /mz\s*130|mz\s*330|mz\s*mix|mzmix|mz\s*max|\bnz\b|f\s*90|f\s*2z|m\s*9[05]\s*c|q\s*8[05]/i;

function detectGen(title) {
  const t = (title || '').replace(/\s+/g, ' ');
  if (MMAX_ACCESSORY_ONLY.test(t) && !/mmax\s*(90|110)|机械师\s*(mmax|m\s*max|90|110|二代)/i.test(t)) return null;
  const gen = (() => { for (const r of GEN_RULES) if (r.re.test(t)) return r.gen; return null; })();
  if (!gen) return null;
  // 已命中具体 MMAX 代际就保留；只命中泛词且有其他车系主语 → 判为误命中
  if (gen === 'MMAX (未标细号)' && OTHER_NINEBOT_SUBJECT.test(t)) return null;
  return gen;
}

// ---------- 噪音 ----------
const NOISE = /出租|月租|日租|租车|押金|分期|首付|芬期|手付|以租代购|回收|代拍|车架|定金|月付|带回家/;
// 型号堆砌：标题里 ≥3 个不同型号 = 门店引流贴
const STACK_RULES = [/mz\s*mix|mzmix/ig, /mz\s*130/ig, /mz\s*330/ig, /mz\s*max/ig,
  /mmax/ig, /机械师/ig, /m\s*9[05]\s*c/ig, /nz\s*mix/ig, /f2z/ig, /f90/ig, /q\s*8[05]/ig];
function isStacking(t) {
  let n = 0;
  for (const re of STACK_RULES) { re.lastIndex = 0; if (re.test(t)) n++; }
  return n >= 3;
}

// ---------- 里程（必须排除「续航」）----------
const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  // 支持「一万二」这类口语
  const m = s.match(/^([一二两三四五六七八九])万([一二两三四五六七八九])?$/);
  if (m) return CN_NUM[m[1]] * 10000 + (m[2] ? CN_NUM[m[2]] * 1000 : 0);
  let n = 0;
  for (const ch of s) { if (CN_NUM[ch] !== undefined) n = n * 10 + CN_NUM[ch]; }
  return n || null;
}

function extractKm(t) {
  t = (t || '').replace(/(\d)\s+(\d)/g, '$1$2');   // 修「5 159公里」这类断字
  // 引导词在前
  let m = t.match(/(?:行驶|安全行驶|已行驶|跑了|骑了|总里程|行驶里程|里程)\s*[:：大约约]?\s*([\d.]+|[一二两三四五六七八九]+)\s*(万)?\s*(多)?\s*(?:公里|km)/i);
  if (m) {
    const v = cnToNum(m[1]);
    if (v != null) return Math.round(v * (m[2] ? 10000 : 1));
  }
  // 单位在后接里程词
  m = t.match(/([\d.]+)\s*(万)?\s*(多)?\s*(?:公里|km)\s*(?:行驶|里程)/i);
  if (m) return Math.round(parseFloat(m[1]) * (m[2] ? 10000 : 1));
  // 兜底：分句扫描，排除续航/电池语境
  for (const seg of t.split(/[，。；;、\n]/)) {
    if (/续航|电池|充电|能跑|跑得到|满把|满电/.test(seg)) continue;
    const mm = seg.match(/([\d.]+|[一二两三四五六七八九]{2,})\s*(万)?\s*(多)?\s*(?:公里|km)/i);
    if (mm) {
      const v = Math.round(cnToNum(mm[1]) * (mm[2] ? 10000 : 1));
      if (v >= 100) return v;
    }
  }
  return null;
}

function extractCycles(t) {
  const m = (t || '').match(/循环\s*(\d+)\s*次/);
  return m ? parseInt(m[1], 10) : null;
}

function extractAct(t) {
  t = (t || '').replace(/(\d)\s+(\d)/g, '$1$2');
  let m = t.match(/(20?2[3-9])\s*年\s*(\d{1,2})\s*月(?:\s*\d{1,2}\s*日)?\s*(?:激活|上牌|购买|买的|入手|购于|买于)/);
  if (!m) m = t.match(/(?:激活|上牌|购买|买的|入手)\s*[:：]?\s*(20?2[3-9])\s*年\s*(\d{1,2})\s*月/);
  if (!m) return null;
  let y = parseInt(m[1], 10); if (y < 100) y += 2000;
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo, raw: `${y}-${String(mo).padStart(2, '0')}` };
}

// 月份差（以 2026-11 为基准）
const NOW = { y: 2026, m: 11 };
function monthsOld(act) {
  if (!act) return null;
  return (NOW.y - act.y) * 12 + (NOW.m - act.m);
}

// ---------- 车况标签 ----------
const TAG = {
  empty: /空车|不带电池|不含电池|没电池|无电池|不含电|标价空车/,
  whole: /带电池|原装电池|带原厂|带\s*48|整车出|带电出/,
  plate: /上牌|带牌|过户|白牌|绿牌|蓝牌|车牌|包牌/,
  mod: /改了|改装|升级|换装|凌博|远驱|全顺|顿恩|智科|apt|平叉|半热熔|锻造|宁德|大辐射|布雷博|鲍鱼|e300|72260|841800|三管车架|大单体/i,
  abs: /abs/i,
  crash: /摔|倒车|事故|有花|刮痕|磕碰/
};

function tagsOf(t) {
  const out = [];
  if (TAG.empty.test(t)) out.push('空车');
  else if (TAG.whole.test(t)) out.push('带电池');
  if (TAG.plate.test(t)) out.push('带牌/可过户');
  if (TAG.mod.test(t)) out.push('改装');
  if (TAG.abs.test(t)) out.push('ABS');
  if (TAG.crash.test(t)) out.push('有摔/花');
  return out;
}

// ---------- 重复挂车检测 ----------
// 同一车商把一台车重复挂 N 次（标题几乎一致），会严重虚高挂牌量。
// 用「标题前 40 字 + 价格」做指纹。
function fingerprint(r) {
  const t = (r.title || '').replace(/\s+/g, '').slice(0, 40);
  return t + '|' + r.price;
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function fmt(n) { return n == null ? '-' : String(n); }

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const taskArg = argv.includes('--task') ? argv[argv.indexOf('--task') + 1] : null;
  const mdIdx = argv.indexOf('--md');
  const mdOut = mdIdx > -1 ? argv[mdIdx + 1] : null;
  const fromIdx = argv.indexOf('--from');
  const fromFile = fromIdx > -1 ? argv[fromIdx + 1] : null;
  const scopeIdx = argv.indexOf('--scope');
  const scopeLabel = scopeIdx > -1 ? argv[scopeIdx + 1] : (fromFile ? '全国·综合排序' : '珠三角·区域筛选');

  let rows;
  if (fromFile) {
    // 从 market.js 的采样结果读取（综合排序，带 wantCount / rank）
    // 综合排序是平台自己的推荐序，比「最新」序更能代表真实需求量
    const d = JSON.parse(fs.readFileSync(fromFile, 'utf-8'));
    rows = (d.raw || []).map(r => ({
      id: r.id, title: r.title, price: r.price, area: r.area,
      want_count: r.wantCount || 0, _rank: r.rank, _kw: r.keyword
    }));
  } else {
    const db = new DatabaseSync(DB_PATH);
    if (taskArg) {
      const ids = taskArg.split(',').map(Number).filter(Boolean);
      rows = db.prepare(`SELECT * FROM items WHERE task_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    } else {
      rows = db.prepare('SELECT * FROM items').all();
    }
    db.close();
  }

  const funnel = { raw: rows.length, notMmax: 0, fake: 0, noise: 0, stacking: 0, badPrice: 0, dup: 0 };
  const kept = [];
  const seen = new Set();

  for (const r of rows) {
    const t = (r.title || '').replace(/\s+/g, ' ');
    const j = judge(t);
    if (!j.ok) { if (j.fake) funnel.fake++; else funnel.notMmax++; continue; }
    const gen = detectGen(t);
    if (!gen) { funnel.notMmax++; continue; }
    if (NOISE.test(t)) { funnel.noise++; continue; }
    if (isStacking(t)) { funnel.stacking++; continue; }
    // 价格清洗：<500 是改装圈「私聊报价」惯例；>9000 多为未激活新车全包价
    if (!r.price || r.price < 500 || r.price > 9000) { funnel.badPrice++; continue; }
    const fp = fingerprint(r);
    if (seen.has(fp)) { funnel.dup++; continue; }
    seen.add(fp);

    const km = extractKm(t);
    const cyc = extractCycles(t);
    const act = extractAct(t);
    kept.push({
      id: r.id, gen, price: r.price, area: r.area || '',
      title: t, km, cyc, act: act ? act.raw : null,
      months: monthsOld(act), tags: tagsOf(t),
      want: r.want_count || 0,
      rank: r._rank || null,
      // 每循环公里数 = 里程/循环，用于识别调表
      kmPerCycle: (km && cyc) ? +(km / cyc).toFixed(1) : null
    });
  }

  // 按代际聚合
  const byGen = {};
  for (const r of kept) {
    const g = byGen[r.gen] = byGen[r.gen] || { gen: r.gen, items: [], prices: [] };
    g.items.push(r); g.prices.push(r.price);
  }

  const stats = Object.values(byGen).map(g => {
    const empty = g.items.filter(x => x.tags.includes('空车')).length;
    const mod = g.items.filter(x => x.tags.includes('改装')).length;
    const plate = g.items.filter(x => x.tags.includes('带牌/可过户')).length;
    const kms = g.items.map(x => x.km).filter(v => v != null);
    const news = g.items.filter(x => x.months != null && x.months <= 6).length;
    const wants = g.items.map(x => x.want || 0);
    return {
      gen: g.gen,
      count: g.items.length,
      priceMin: Math.min(...g.prices),
      priceMax: Math.max(...g.prices),
      priceMed: median(g.prices),
      emptyPct: Math.round(empty / g.items.length * 100),
      modPct: Math.round(mod / g.items.length * 100),
      platePct: Math.round(plate / g.items.length * 100),
      kmMed: kms.length ? median(kms) : null,
      newPct: Math.round(news / g.items.length * 100),
      wantTotal: wants.reduce((a, b) => a + b, 0),
      wantAvg: +(wants.reduce((a, b) => a + b, 0) / g.items.length).toFixed(1),
      wantMed: median(wants),
      items: g.items.sort((a, b) => a.price - b.price)
    };
  }).sort((a, b) => (GEN_RULES.find(r => r.gen === a.gen)?.ord || 0) - (GEN_RULES.find(r => r.gen === b.gen)?.ord || 0));

  if (asJson) {
    console.log(JSON.stringify({ funnel, stats }, null, 2));
    return;
  }

  const L = [];
  const P = (s = '') => { L.push(s); };

  P('# 九号 MMAX 机械师系列 · 代际细分行情');
  P('');
  P(`> 数据：闲鱼 ${scopeLabel} · 采集时间 2026-11-08 · 有效样本 ${kept.length} 条`);
  P('');
  P('## 一、MMAX 到底有几个型号');
  P('');
  P('| 代际 | 在售 | 价带 | 中位价 | 空车% | 改装% | 带牌% | 里程中位 | 半年内新车% |');
  P('|---|---|---|---|---|---|---|---|---|');
  for (const s of stats) {
    P(`| **${s.gen}** | ${s.count} | ¥${s.priceMin}–${s.priceMax} | **¥${s.priceMed}** | ${s.emptyPct}% | ${s.modPct}% | ${s.platePct}% | ${s.kmMed != null ? s.kmMed + ' km' : '-'} | ${s.newPct}% |`);
  }
  P('');
  // 需求密度：只有从综合排序样本读取时才有意义。
  // DB 里的 want_count 来自「最新」排序，帖子刚挂出、想要数还没累积，直接展示会误导。
  const totalWant = fromFile ? stats.reduce((a, s) => a + s.wantTotal, 0) : 0;
  if (totalWant > 0) {
    P('## 二、需求热度（按综合排序样本的「想要」数）');
    P('');
    P('「每条平均想要」比总数更能说明问题 —— 它衡量一条帖子挂出去能吸引多少人。');
    P('');
    P('| 代际 | 挂牌 | 想要合计 | 每条平均 | 中位 | 需求判定 |');
    P('|---|---|---|---|---|---|');
    for (const s of [...stats].sort((a, b) => b.wantAvg - a.wantAvg)) {
      const verdict = s.wantAvg >= 60 ? '🔥 热销' : s.wantAvg >= 25 ? '✅ 正常' : s.wantAvg >= 10 ? '⚠️ 偏冷' : '❄️ 滞销';
      P(`| **${s.gen}** | ${s.count} | ${s.wantTotal} | **${s.wantAvg}** | ${s.wantMed} | ${verdict} |`);
    }
    P('');
  }
  P(`## ${totalWant > 0 ? '三' : '二'}、逐条明细`);
  P('');
  for (const s of stats) {
    P(`### ${s.gen}（${s.count} 条）`);
    P('');
    P('| 价格 | 里程 | 循环 | 激活 | 车龄 | 标签 | 标题摘要 | id |');
    P('|---|---|---|---|---|---|---|---|');
    for (const r of s.items) {
      const kmPc = r.kmPerCycle != null ? ` (${r.kmPerCycle}km/次)` : '';
      P(`| ¥${r.price} | ${fmt(r.km)}${kmPc} | ${fmt(r.cyc)} | ${fmt(r.act)} | ${r.months != null ? r.months + '月' : '-'} | ${r.tags.join('·') || '-'} | ${r.title.slice(0, 46).replace(/\|/g, '/')} | ${r.id} |`);
    }
    P('');
  }
  P(`## ${totalWant > 0 ? '四' : '三'}、数据清洗漏斗`);
  P('');
  P('| 环节 | 剔除数 |');
  P('|---|---|');
  P(`| 原始抓取 | ${funnel.raw} |`);
  P(`| 非 MMAX / 非九号 | ${funnel.notMmax} |`);
  P(`| 仿冒山寨 | ${funnel.fake} |`);
  P(`| 分期/租赁/代拍 | ${funnel.noise} |`);
  P(`| 型号堆砌引流 | ${funnel.stacking} |`);
  P(`| 异常标价(<500 或 >9000) | ${funnel.badPrice} |`);
  P(`| 重复挂车（标题+价格同指纹） | ${funnel.dup} |`);
  P(`| **有效** | **${kept.length}** |`);

  const out = L.join('\n');
  console.log(out);
  if (mdOut) {
    fs.mkdirSync(path.dirname(mdOut), { recursive: true });
    fs.writeFileSync(mdOut, out, 'utf-8');
    console.error(`\n✅ 已写入 ${mdOut}`);
  }
}

if (require.main === module) main();

module.exports = { detectGen, judge, extractKm, extractCycles, extractAct, monthsOld, TAG, NOISE, isStacking, GEN_RULES };
