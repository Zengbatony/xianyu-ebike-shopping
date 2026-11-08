#!/usr/bin/env node
/**
 * mk2.js — 九号 MMAX110 MK2 专项：原装 / 轻改 / 中改 / 重改 四级分层
 *
 * 为什么单独一个脚本：
 *   ① MK2 是「一代改款」，卖家写法极乱（机械师MK2 / 机械师一代mk2 / MMAX110MK2 /
 *      机械师110mk2 / 机械师1 mk2…），且与 MMAX110 / 110P 只差一个后缀，混进大盘会被淹掉。
 *   ② 命名撞车严重：E80C MK2（电摩）、猎户座 DZ110P MK2 都带 MK2，mmax.js 的 /mk\s*2/
 *      会把它们一起抓进来。必须先过「型号闸门」再谈分层。
 *   ③ MK2 这条线改装率只有 22%（MMAX90 是 58%），原装车是主流，"原装能不能买到、值多少"
 *      才是这条线唯一有价值的判断，所以必须分层而不是算中位数。
 *
 * 用法：
 *   node scripts/mk2.js                    # 终端 Markdown
 *   node scripts/mk2.js --json             # JSON
 *   node scripts/mk2.js --task 14,24,25    # 限定任务
 *   node scripts/mk2.js --md out.md        # 导出 Markdown
 *   node scripts/mk2.js --debug            # 打印每条的分层依据
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { judge, NOISE } = require('./mmax.js');

const _emitWarning = process.emitWarning;
process.emitWarning = function (w, ...r) {
  const msg = typeof w === 'string' ? w : (w && w.message) || '';
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return _emitWarning.call(process, w, ...r);
};

const DB_PATH = process.env.XIANYU_DB_PATH || path.join(__dirname, '..', 'data', 'xianyu-monitor.db');
const { openDbOrExit } = require('./lib-guard');

// ============ 一、型号闸门 ============
// MK2 必须由「机械师 / MMAX」承载，且不能是别的车的 MK2
const MK2_TOKEN = /mk\s*2|26\s*款.*机械师|机械师.*26\s*款/i;
const SUBJECT = /机械师|mmax|m\s*max/i;
// 命名撞车：E 系列电摩 / 猎户座 DZ 系列，都不是机械师
const WRONG_SERIES = /猎户座|\bdz\s*110|\bE\s*\d{2,3}\s*c?\b/i;
// 别的主语车系（出现在机械师之前 → 门店堆砌贴）
const OTHER_SERIES = /mz\s*130|mz\s*330|mz\s*mix|nz\s*mix|\bm95c\b|f\s*2z|f\s*90|\bq\s*8[05]/i;
const OTHER_BRAND = /极核|小牛|\bniu\b|雅迪|爱玛|台铃|绿源|新日|深远|九牛|小刀|绿佳|速珂/i;
// 别的 MMAX 型号（出现在 MK2 之前 → 实际是那台车的改装贴）
const OTHER_MMAX = /(?:机械师|mmax|m\s*max)\s*(?:90|110\s*p|二代|\b2\b)/i;

function isMk2(title) {
  const t = title;
  if (!MK2_TOKEN.test(t)) return 'not-mk2';
  if (!SUBJECT.test(t)) return 'wrong-series';
  if (WRONG_SERIES.test(t)) return 'wrong-series';
  // 别的品牌抢在前面（极核/小牛/雅迪…），九号只是顺带提
  if (OTHER_BRAND.test(t.slice(0, 24)) && !SUBJECT.test(t.slice(0, 24))) return 'stacking';

  const iMk2 = t.search(/mk\s*2/i);
  const iSub = t.search(SUBJECT);
  const iOther = t.search(OTHER_SERIES);
  const iOthMmax = t.search(OTHER_MMAX);

  // 别的车系抢在机械师前面 → 门店堆砌
  if (iOther > -1 && iOther < iSub && iSub > -1) return 'stacking';
  // 别的 MMAX 型号抢在 MK2 前面 → 那台车的改装贴
  if (iOthMmax > -1 && iOthMmax < iMk2) return 'other-mmax';
  return 'ok';
}

// ============ 二、改装分层 ============
// 判级原则：看「动力链动了哪一段」。
//   电池 / 控制器 / 电机 → 动了就改变车辆性质（速度、重量、合法性），不可逆
//   减震 / 刹车 / 轮胎 / 外观 → 行走系统与装饰，可逆，不影响合法性
// 关键陷阱：原厂 4825 / 4830 / 48V25Ah / 48V30Ah 是标配，必须先剥离再判，否则「原装车」会被判成改装。
const BIG_BATTERY =
  /\b(?:6[0-9]|[78]\d)\s*v\s*\d{2,3}|\b(?:51|52|53|48)\s*v?\s*(?:[4-9]\d|\d{3})\s*(?:a|ah|安)|大单体|宁德|磷酸铁锂|三元大单|lg\s*\d|sk\s*\d|\d{2,3}\s*[-－]\s*\d{2,3}\s*安|\b(?:72|76|80|84)(?:v)?(?:[2-9]\d)\s*(?=电池|锂电|安|a\b|ah\b)/i;
const CONTROLLER =
  /控制器|凌博|远驱|智科|全顺控|apt|e\s*180|e\s*300|\b7[0-9]2\d{2}\b|\b8[45]\d{4}\b|\b(?:260|350|450|550|680|850)\b\s*(?:控|板|空|的板|的空)|(?:远驱|智科|凌博)\s*\d{3}/i;
const MOTOR = /全顺|瓦片|\b(?:1[0-9]00|[2-9]\d{3}|[1-9]\d{4})\s*w\b|换电机|改电机|升级电机/i;
// 注意：换轮胎 / 换刹车片是保养，不是改装 —— 只有卡钳/上泵/减震/平叉/轮毂这类「升级件」才算
const CHASSIS =
  /平叉|减震|前叉|后胆|避震|卡钳|鲍鱼|布雷博|上泵|半热熔|轮毂|锻造|排骨|大闪电|螃蟹/i;
const COSMETIC =
  /氛围灯|一体座|靠背|座垫|坐垫|外壳|车壳|贴膜|贴纸|后视镜|尾箱|挡泥|把套|风挡|改色|包围|碳纤|钛合金|cnc/i;
// 声明原装 —— 但同句里有改装动词时不算（「改了上泵其它全原」不能判原装）
const STOCK_ASSERT = /全原装|全原厂|原厂配置|素车|原装素车|一切原装|全部原装|未改装|无改装|原装未改|零改装|原车原装|其它全原|其他全原/i;
const MOD_VERB = /改了|改过|换了|换装|升级|改装|加装|换上|改了|改的/i;

function stripStock(t) {
  return t
    // 「没改装控制器」「电池原厂」这类否定句不是改装证据，先摘掉
    .replace(/(?:没|未|无|不|非)\s*(?:改装|改|换|动|更换)[^，。；]{0,8}(?:控制器|电机|电池|三大件)/g, ' ')
    .replace(/(?:控制器|电机|电池|三大件)[^，。；]{0,6}(?:没|未|无|不)\s*(?:改装|改|换|动)[^，。；]{0,4}/g, ' ')
    .replace(/48\s*[-－v]?\s*(?:25|30)\s*(?:a|ah|安)\b/ig, ' ')   // 原厂 4825 / 4830 / 48V30Ah / 48-30
    .replace(/原装|原厂|原车|标配|出厂/g, ' ');
}

function modLevel(title) {
  const raw = title || '';
  // 「其它全原」常与「改了上泵」同现 —— 有改装动词 + 升级件时，不能判原装
  const realMod = /(?:改了|改过|换了|换装|升级|改装|加装)[^，。；]{0,10}(?:上泵|轮毂|减震|前叉|卡钳|控制器|电池|电机|平叉|包围)/.test(raw);
  if (STOCK_ASSERT.test(raw) && !realMod) return { lv: 0, name: '原装', hits: [] };

  const t = stripStock(raw);
  const bigBat = BIG_BATTERY.test(t);
  const ctrl = CONTROLLER.test(t);
  const motor = MOTOR.test(t);
  const chassis = CHASSIS.test(t);
  const cosmetic = COSMETIC.test(t);

  const hits = [];
  if (bigBat) hits.push('大电池');
  if (ctrl) hits.push('控制器');
  if (motor) hits.push('电机');
  if (chassis) hits.push('行走');
  if (cosmetic) hits.push('外观');

  // 换大单体电池 = 整车性质变了（超重/超压），一律重改
  if (bigBat) return { lv: 3, name: '重改', hits };
  if (ctrl && motor) return { lv: 3, name: '重改', hits };
  if (ctrl || motor) return { lv: 2, name: '中改', hits };
  if (chassis || cosmetic) return { lv: 1, name: '轻改', hits };
  return { lv: 0, name: '原装', hits };
}

// ============ 三、字段抽取 ============
// 不用 mmax.js 的 extractKm：它按分句整体跳过，长标题里一旦出现「电池」就把里程一起跳过
function extractKm2(t0) {
  let t = (t0 || '').replace(/(\d)\s+(\d)/g, '$1$2');
  t = t.replace(/([\d.]+)\s*w\s*公里/gi, (m, n) => `${n}万公里`);   // 1.7w公里
  const RE = /([\d.]+|[一二两三四五六七八九]{1,3})\s*(万)?\s*(多)?\s*[+＋]?\s*(?:公里|km|公裡)/gi;
  let m, best = null;
  while ((m = RE.exec(t)) !== null) {
    const before = t.slice(Math.max(0, m.index - 10), m.index);
    if (/续航|能跑|跑得到|满把|满电|理论/.test(before)) continue;       // 续航不是里程
    let v = /^\d/.test(m[1]) ? parseFloat(m[1]) : cnNum(m[1]);
    if (!v) continue;
    if (m[2]) v *= 10000;
    v = Math.round(v);
    if (v < 5 || v > 60000) continue;
    // 「100公里续航」这类没被 before 抓住的，看 after
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (/续航|左右|以上/.test(after) && v <= 200) continue;
    if (best == null || v > best) best = v;   // 「1万公里出头」优先取大值
  }
  return best;
}
const CN = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^([一二两三四五六七八九])万([一二两三四五六七八九])?$/);
  if (m) return CN[m[1]] * 10000 + (m[2] ? CN[m[2]] * 1000 : 0);
  let n = 0; for (const ch of s) { if (CN[ch] !== undefined) n = n * 10 + CN[ch]; } return n || null;
}
function extractCycles2(t) {
  const m = (t || '').match(/循环\s*(\d+)\s*次/);
  return m ? +m[1] : null;
}
function extractAct2(t0) {
  const t = (t0 || '').replace(/(\d)\s+(\d)/g, '$1$2');
  const pats = [
    /(?<![0-9A-Za-z])(20?2[3-9])\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]?\s*(?:\d{1,2}\s*日)?\s*(?:激活|上牌|购买|买的|入手|落地|购于|买于|提车)/,
    /(?:激活|上牌|购买|买的|入手|落地|提车)\s*(?:时间)?\s*[:：]?\s*(?<![0-9A-Za-z])(20?2[3-9])\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]?/,
    /^\s*(2[3-9])[.\-/](\d{1,2})[.\-/]\d{1,2}\s*(?:激活|上牌)/
  ];
  for (const p of pats) {
    const m = t.match(p);
    if (!m) continue;
    let y = +m[1]; if (y < 100) y += 2000;
    if (y < 2023 || y > 2027) continue;              // 「mk2 25年」被拼成 225 年这类脏数据
    const mo = +m[2];
    if (mo >= 1 && mo <= 12) return { y, m: mo, raw: `${y}-${String(mo).padStart(2, '0')}` };
  }
  return null;
}
// 「空车/不带电池」和「没有牌照」是否定表达，直接正则匹配会反向判成「带电池/带牌」
const NOBAT = /空车|不带电池|不含电池|无电池|没电池/;
const NOPLATE = /没有牌照|无牌照|不带牌|无牌|没牌|不带证|不上牌/;
const NOW = { y: 2026, m: 11 };
const monthsOld = a => (a ? (NOW.y - a.y) * 12 + (NOW.m - a.m) : null);

// ============ 四、采集 ============
function collect(taskIds) {
  const db = openDbOrExit(DB_PATH);
  const rows = taskIds && taskIds.length
    ? db.prepare(`SELECT * FROM items WHERE task_id IN (${taskIds.map(() => '?').join(',')})`).all(...taskIds)
    : db.prepare('SELECT * FROM items').all();
  db.close();

  const funnel = { raw: rows.length, notMk2: 0, wrongSeries: 0, otherMmax: 0, stacking: 0, fake: 0, noise: 0, priceTable: 0, accessory: 0, badPrice: 0, dup: 0 };
  const kept = [], seen = new Set();

  for (const r of rows) {
    const t = (r.title || '').replace(/\s+/g, ' ').trim();
    const gate = isMk2(t);
    if (gate === 'wrong-series') { funnel.wrongSeries++; continue; }
    if (gate === 'other-mmax') { funnel.otherMmax++; continue; }
    if (gate === 'stacking') { funnel.stacking++; continue; }
    if (gate === 'not-mk2') { funnel.notMk2++; continue; }

    const j = judge(t);
    if (!j.ok) { if (j.fake) funnel.fake++; else funnel.notMk2++; continue; }
    if (NOISE.test(t) || /首\s*\d{3,4}\s*可|首付|月供|能补的来|求置换|置换 能补/.test(t)) { funnel.noise++; continue; }
    // 价目表 / 官网指导价贴 —— 不是车
    if (/零售价|官网价|指导价|标价为裸车|不含牌/.test(t)) { funnel.priceTable++; continue; }
    // 配件贴：标题在卖电池/零件而不是整车（无任何整车信号 + 低价）
    const vehicleSignal = /公里|整车|空车|带牌|过户|激活|落地|提车|车出/.test(t);
    if (!vehicleSignal && r.price < 1500) { funnel.accessory++; continue; }
    if (!r.price || r.price < 500 || r.price > 12000) { funnel.badPrice++; continue; }

    const fp = `${t.slice(0, 30)}|${r.price}`;
    if (seen.has(fp)) { funnel.dup++; continue; }
    seen.add(fp);

    const act = extractAct2(t);
    const ml = modLevel(t);
    kept.push({
      id: r.id, title: t, price: r.price, area: r.area || '',
      km: extractKm2(t), cycles: extractCycles2(t),
      act: act ? act.raw : null, age: monthsOld(act),
      lv: ml.lv, lvName: ml.name, hits: ml.hits,
      noBat: NOBAT.test(t),
      plate: !NOPLATE.test(t) && /带牌|有牌|上牌|过户|牌照|绿牌|白牌/.test(t),
      hasBat: !NOBAT.test(t) && /带电池|带原厂|带\s*48|带锂电|含电池|锂电池/.test(t),
      abs: /abs/i.test(t),
      screen: /彩屏|5\s*寸|tft/i.test(t),
      dealer: /最新到店|到店|门店|车行|现车|支持分期|可上牌|包上牌|代办|全新车|仅此一批|数量不多|仅此一台|提车|支持邮寄/.test(t),
      want: r.want_count || 0
    });
  }
  return { kept, funnel };
}

// ============ 五、报告 ============
const median = a => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '-';
const dash = v => (v == null || v === '' ? '-' : String(v));

function report(kept, funnel) {
  const L = [], P = s => L.push(s);
  // 原装必须再拆：个人转让 vs 商家全新/代办 —— 两者价差 2000+，混算中位价会失真
  const GROUPS = [
    { name: '原装·个人转让', f: x => x.lv === 0 && !x.dealer },
    { name: '原装·商家全新/代办', f: x => x.lv === 0 && x.dealer },
    { name: '轻改（只动行走/外观）', f: x => x.lv === 1 },
    { name: '中改（控制器或电机）', f: x => x.lv === 2 },
    { name: '重改（大单体电池/双段动力）', f: x => x.lv === 3 }
  ];

  P('# 九号 MMAX110 MK2 · 珠三角车源分层报告');
  P('');
  P(`> 数据：闲鱼 珠三角·区域筛选 · 采集时间 2026-11-08 · **有效样本 ${kept.length} 条**`);
  P('> 关键词覆盖：九号MMAX110 MK2 / 机械师MK2 / 机械师一代mk2 / 九号MK2 / 机械师110mk2');
  P('> 分层口径：动力链（电池/控制器/电机）动过 = 中改以上；只动行走与外观 = 轻改；明确原装 = 原装');
  P('');
  P('## 一、总览');
  P('');
  P('| 分层 | 条数 | 占比 | 价带 | 中位价 | 带牌% | 空车% | 里程中位 |');
  P('|---|---|---|---|---|---|---|---|');
  for (const g0 of GROUPS) {
    const g = kept.filter(g0.f);
    if (!g.length) { P(`| **${g0.name}** | 0 | 0% | - | - | - | - | - |`); continue; }
    const ps = g.map(x => x.price);
    const kms = g.map(x => x.km).filter(v => v != null);
    P(`| **${g0.name}** | ${g.length} | ${pct(g.length, kept.length)} | ¥${Math.min(...ps)}–${Math.max(...ps)} | **¥${median(ps)}** | ${pct(g.filter(x => x.plate).length, g.length)} | ${pct(g.filter(x => x.noBat).length, g.length)} | ${kms.length ? median(kms) + ' km' : '-'} |`);
  }
  const ap = kept.map(x => x.price);
  P(`| **合计** | **${kept.length}** | 100% | ¥${Math.min(...ap)}–${Math.max(...ap)} | **¥${median(ap)}** | ${pct(kept.filter(x => x.plate).length, kept.length)} | ${pct(kept.filter(x => x.noBat).length, kept.length)} | - |`);
  P('');
  P('## 二、逐层明细（按价格升序）');
  P('');
  for (const g0 of GROUPS) {
    const g = kept.filter(g0.f).sort((a, b) => a.price - b.price);
    P(`### ${g0.name}（${g.length} 条）`);
    P('');
    if (!g.length) { P('_无样本_'); P(''); continue; }
    P('| 价格 | 里程 | 激活 | 车龄 | 配置位 | 标签 | 标题摘要 | id |');
    P('|---|---|---|---|---|---|---|---|');
    for (const x of g) {
      const flags = [x.abs ? 'ABS' : '', x.screen ? '彩屏' : '', x.noBat ? '空车' : '', x.dealer ? '商家' : ''].filter(Boolean).join(' / ') || '-';
      const tags = [x.plate ? '带牌' : '', x.hasBat ? '带电池' : '', x.hits.join('+')].filter(Boolean).join('·') || '未标';
      P(`| ¥${x.price} | ${dash(x.km)}${x.km != null ? ' km' : ''} | ${dash(x.act)} | ${x.age != null ? x.age + '月' : '-'} | ${flags} | ${tags} | ${x.title.slice(0, 54)} | ${x.id} |`);
    }
    P('');
  }
  P('## 三、清洗漏斗');
  P('');
  P('| 环节 | 剔除数 |');
  P('|---|---|');
  P(`| 原始抓取 | ${funnel.raw} |`);
  P(`| 非 MK2（含 MMAX110/90/二代） | ${funnel.notMk2} |`);
  P(`| 命名撞车（E 系电摩 / 猎户座 MK2） | ${funnel.wrongSeries} |`);
  P(`| 实为别的 MMAX 型号 | ${funnel.otherMmax} |`);
  P(`| 门店型号堆砌 | ${funnel.stacking} |`);
  P(`| 仿冒山寨 | ${funnel.fake} |`);
  P(`| 分期/租赁/置换求车 | ${funnel.noise} |`);
  P(`| 价目表/指导价贴（不是车） | ${funnel.priceTable} |`);
  P(`| 配件贴（卖电池/零件不是整车） | ${funnel.accessory} |`);
  P(`| 异常标价 | ${funnel.badPrice} |`);
  P(`| 重复挂车（标题+价格同指纹） | ${funnel.dup} |`);
  P(`| **有效** | **${kept.length}** |`);
  return L.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const dbg = argv.includes('--debug');
  const taskArg = argv.includes('--task') ? argv[argv.indexOf('--task') + 1] : null;
  const mdIdx = argv.indexOf('--md');
  const mdOut = mdIdx > -1 ? argv[mdIdx + 1] : null;
  const ids = taskArg ? taskArg.split(',').map(Number).filter(Boolean) : null;

  const { kept, funnel } = collect(ids);
  if (asJson) { console.log(JSON.stringify({ kept, funnel }, null, 2)); return; }
  if (dbg) {
    for (const lv of [0, 1, 2, 3]) {
      console.log(`==== L${lv} ${['原装', '轻改', '中改', '重改'][lv]} (${kept.filter(x => x.lv === lv).length}) ====`);
      for (const x of kept.filter(x => x.lv === lv).sort((a, b) => a.price - b.price)) {
        console.log(`¥${x.price} | ${x.hits.join('+') || '-'} | km=${x.km} | ${x.title.slice(0, 70)}`);
      }
    }
    return;
  }
  const out = report(kept, funnel);
  console.log(out);
  if (mdOut) { fs.mkdirSync(path.dirname(mdOut), { recursive: true }); fs.writeFileSync(mdOut, out, 'utf-8'); console.error(`\n✅ 已写入 ${mdOut}`); }
}

main();
