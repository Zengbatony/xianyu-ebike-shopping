#!/usr/bin/env node
/**
 * 品牌白名单判定测试
 *
 * 这些用例不是编的，每一条都对应一个真实踩过的坑：
 *   - 「整车配件齐全」被误判成配件    → 180 条里误杀 36 条
 *   - 按品牌黑名单排除                → 误杀率 20%
 *   - 「假9号」被抓进库
 *   - 卖家写「支持换雅迪」被当成雅迪车
 *
 * 跑法：node test/brand.test.js
 */

const { judge, isTargetBrand } = require('../scripts/lib-brand');

const CASES = [
  // ============ 应该收 ============
  ['九号机械师MK2 银灰 48V30Ah 4000公里 带牌', true, '品牌名 + 车辆特征'],
  ['MMAX110 mk2 空车 不带电池', true, '型号词兜底（标题没写"九号"）'],
  ['九号整车配件齐全 行驶5000公里 手续齐', true, '「配件齐全」是整车描述，不是配件贴'],
  ['九号机械师90 支持换雅迪 比小牛好骑', true, '不做品牌黑名单：别家名字只是对比'],
  ['九号改了一些配件 减震换了 里程8000', true, '改配件仍是整车'],
  ['九号M95C 骑着很舒服 可小刀', true, '弱信号但命中品牌'],
  ['【九号】机械师 25年激活 循环109次', true, '括号包品牌名'],

  // ============ 应该剔：配件 ============
  ['适用九号M95C电池组 全新', false, '自报"适用" = 配件'],
  ['九号原装充电器 通用款', false, '自报"通用" = 配件'],
  ['机械师靠背 九号适用', false, '单件配件词 + 配件自报'],
  ['九号 头盔 全新未拆', false, '单件配件词，无车辆主体特征'],
  ['全新48V30Ah锂电 循环0次', false, '无品牌特征'],

  // ============ 应该剔：仿冒 / 其他品牌 ============
  ['假9号 nicebike M95C 1088', false, '仿冒词'],
  ['高仿九号机械师 便宜出', false, '高仿'],
  ['雅迪冠能 5000公里 带牌', false, '其他品牌，无目标品牌特征'],
  ['爱玛小乔 九成新 可过户', false, '其他品牌'],
];

let pass = 0;
const fails = [];

console.log('品牌白名单判定测试\n' + '─'.repeat(72));

for (const [title, expected, note] of CASES) {
  const j = judge(title);
  const ok = j.ok === expected;
  if (ok) pass++;
  else fails.push({ title, expected, got: j.ok, reason: j.reason });

  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const act = j.ok ? '\x1b[32m收\x1b[0m' : '\x1b[90m剔\x1b[0m';
  console.log(`${mark} ${act}  ${j.reason.padEnd(12)} ${title.slice(0, 34).padEnd(36)} ${note}`);
}

console.log('─'.repeat(72));
if (fails.length) {
  console.log(`\x1b[31m失败 ${fails.length} 条：\x1b[0m`);
  for (const f of fails) {
    console.log(`  「${f.title}」期望 ${f.expected ? '收' : '剔'}，实际 ${f.got ? '收' : '剔'}（${f.reason}）`);
  }
} else {
  console.log(`\x1b[32m全部通过 ${pass}/${CASES.length}\x1b[0m`);
}

// 别名兼容性检查（老脚本还在用 isNinebot）
if (typeof isTargetBrand !== 'function') {
  console.log('\x1b[31misTargetBrand 未导出\x1b[0m');
  process.exit(1);
}

process.exit(fails.length ? 1 : 0);
