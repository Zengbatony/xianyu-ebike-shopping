// 深度分析 market-report.json：剔除噪音，找出真正好卖的车型
const fs = require('fs');
const path = require('path');

const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'market-report.json'), 'utf-8'));

const MODEL_RULES = [
  ['Mz MIX', /mz\s*mix|mzmix/i],
  ['Mz MAX', /mz\s*max(?!\s*mix)/i],
  ['Mz130', /mz\s*130/i],
  ['Mz330', /mz\s*330/i],
  ['Mz 其他', /九号\s*mz|\bmz\b/i],
  ['Q85C', /q\s*85/i],
  ['Q 系列(其他)', /\bq\s*(80|90)/i],
  ['N70C', /n\s*70/i],
  ['N85C', /n\s*85/i],
  ['N95C/M95C', /[mn]\s*95/i],
  ['M85C/M385C', /m\s*(85|385|395)/i],
  ['N 系列(其他)', /\bn\s*(80|100)/i],
  ['F90', /f90/i],
  ['F2z', /f2z/i],
  ['F60', /f60/i],
  ['Fz 系列', /\bfz\b|fzmix/i],
  ['Nz 系列', /\bnz\b|nzmix/i],
  ['MMAX', /mmax/i],
  ['E 系列', /\be\s*(100|125|150|200|300)/i],
  ['B40/C40', /[bc]\s*(40|110)/i],
  ['滑板/卡丁车', /滑板车|卡丁车|平衡车/i]
];

function detectModel(title) {
  for (const [n, re] of MODEL_RULES) if (re.test(title)) return n;
  return '未标注型号';
}

const MOD_STRONG = /改装|爆改|升级|换了|加装|改好|已改|改的|凌博|全顺|远驱|智科|欧老师|APT\s*\d|mms|明哲|米其林|倍耐力|天使胎|风冷|水冷|锂电|换电|一体座|尾架|尾箱|大灯改|平叉|卡钳|减震改|刷程序|解码/i;
const STOCK = /原装|未改装|没改|素车|原厂|无改装|原车|未动|没动过|原封|全原装/i;

function classifyMod(t) {
  const stock = STOCK.test(t);
  const mod = MOD_STRONG.test(t);
  if (stock && !/改装|爆改/.test(t)) return '原装';
  if (mod) return '改装';
  if (stock) return '原装';
  return '未标注';
}

// 剔除噪音：租赁 / 分期 / 引流 / 商家收车
const NOISE = /出租|月租|日租|租车|可租可售|分期|首付|押金|回收|收购|高价收|包月|按天/i;

const rows = d.raw
  .map(r => ({ ...r, model: detectModel(r.title), mod: classifyMod(r.title) }))
  .filter(r => r.price >= 300 && !NOISE.test(r.title));

console.log(`原始 ${d.raw.length} 条 → 剔除租赁/分期/引流/低价噪音后 ${rows.length} 条\n`);

// ---- 按型号聚合 ----
const g = {};
for (const r of rows) {
  if (!g[r.model]) g[r.model] = { model: r.model, n: 0, wants: 0, wantList: [], prices: [], stock: 0, mod: 0, unknown: 0, best: null };
  const x = g[r.model];
  x.n++;
  x.wants += r.wantCount;
  x.wantList.push(r.wantCount);
  if (r.price > 0) x.prices.push(r.price);
  if (r.mod === '原装') x.stock++;
  else if (r.mod === '改装') x.mod++;
  else x.unknown++;
  if (!x.best || r.wantCount > x.best.wantCount) x.best = r;
}

const med = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const list = Object.values(g).map(x => ({
  model: x.model,
  n: x.n,
  totalWant: x.wants,
  medianWant: med(x.wantList),
  maxWant: Math.max(...x.wantList),
  priceMin: x.prices.length ? Math.min(...x.prices) : 0,
  priceMedian: med(x.prices),
  priceMax: x.prices.length ? Math.max(...x.prices) : 0,
  stockPct: Math.round(x.stock / x.n * 100),
  modPct: Math.round(x.mod / x.n * 100),
  best: x.best
})).sort((a, b) => b.totalWant - a.totalWant);

console.log('型号'.padEnd(14) + '挂牌'.padStart(5) + '想要合计'.padStart(9) + '想要中位'.padStart(9) + '单帖最高'.padStart(9)
  + '价格中位'.padStart(9) + '价区间'.padStart(14) + '原装%'.padStart(7) + '改装%'.padStart(7));
console.log('-'.repeat(86));
for (const x of list) {
  console.log(
    x.model.padEnd(14) + String(x.n).padStart(5) + String(x.totalWant).padStart(9) +
    String(x.medianWant).padStart(9) + String(x.maxWant).padStart(9) +
    String(x.priceMedian).padStart(9) + `${x.priceMin}-${x.priceMax}`.padStart(14) +
    String(x.stockPct).padStart(7) + String(x.modPct).padStart(7)
  );
}

console.log('\n===== 单帖「想要」数 TOP15（真实需求最猛的帖子）=====');
rows.sort((a, b) => b.wantCount - a.wantCount).slice(0, 15).forEach((r, i) => {
  console.log(`${String(i + 1).padStart(2)}. 想要${String(r.wantCount).padStart(4)} | ¥${String(r.price).padStart(5)} | ${r.model.padEnd(12)} | ${r.mod.padEnd(4)} | ${r.title.slice(0, 40)}`);
});

console.log('\n===== 原装车样本（可参考的「没改的车」）=====');
const stockCars = rows.filter(r => r.mod === '原装').sort((a, b) => b.wantCount - a.wantCount).slice(0, 12);
for (const r of stockCars) {
  console.log(`  ¥${String(r.price).padStart(5)} | ${r.model.padEnd(12)} | 想要${String(r.wantCount).padStart(3)} | ${r.title.slice(0, 46)}`);
}

fs.writeFileSync(path.join(__dirname, '..', 'data', 'market-analysis.json'), JSON.stringify({ total: rows.length, list, topPosts: rows.slice(0, 50) }, null, 2), 'utf-8');
console.log('\n分析结果已存 data/market-analysis.json');
