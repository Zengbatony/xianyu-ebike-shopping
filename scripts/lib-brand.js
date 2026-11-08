/**
 * lib-brand.js — 品牌白名单过滤（配置驱动）
 *
 * 解决的问题：闲鱼搜索结果里 ~70% 是噪音 —— 配件贴、仿冒车、隔壁品牌、
 * 「支持换雅迪」这类对比话术。不做过滤，后面的行情统计全是脏数据。
 *
 * 设计原则（两条铁律，都是从误杀里学来的）：
 *
 *   1. 只做白名单，不做品牌黑名单。
 *      卖家写「支持换雅迪」「比小牛好骑」「同价位吊打台铃」时，那台车是你要的品牌。
 *      按"出现其他品牌名就排除"来写，实测误杀率能到 20%。
 *
 *   2. 配件词不能一刀切。
 *      「整车配件齐全」「原装配件都在」「改了一些配件」全是整车描述。
 *      所以配件判定必须叠加「是否具备车辆主体特征」（公里/过户/上牌/成色…）。
 *      一刀切会误杀 20%（本项目实测：180 条里 36 条）。
 *
 * 配置：config/brand.json（或用 XIANYU_BRAND_CONFIG 指向自定义文件）
 * 换品类/换品牌只改配置，不改代码。
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.XIANYU_BRAND_CONFIG
  || path.join(__dirname, '..', 'config', 'brand.json');

/**
 * 编译一组 pattern 字符串为单个正则。
 * 无效 pattern 不会炸掉整个模块，只跳过并告警 —— 用户手改配置时大概率会写错一个。
 */
function compile(patterns, flags = 'i') {
  if (!patterns || !patterns.length) return null;
  const parts = [];
  for (const p of patterns) {
    try {
      new RegExp(p, flags);          // 先单独校验
      parts.push(p);
    } catch (e) {
      console.warn(`[lib-brand] 忽略无效正则: ${p} (${e.message})`);
    }
  }
  return parts.length ? new RegExp(parts.join('|'), flags) : null;
}

let PROFILE = null;

function loadProfile() {
  if (PROFILE) return PROFILE;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(
      `[lib-brand] 读不到品牌配置 ${CONFIG_PATH}\n` +
      `  参考 config/brand.example-generic.json 自己写一份，\n` +
      `  或用环境变量 XIANYU_BRAND_CONFIG 指向配置文件。\n  原始错误: ${e.message}`
    );
  }

  PROFILE = {
    name: raw.name || 'custom',
    label: raw.label || raw.name || 'custom',
    BRAND: compile(raw.brandPatterns),
    MODEL: compile(raw.modelPatterns),
    ACC_STRONG: compile(raw.accessoryStrong),
    ACC_PART: compile(raw.accessoryPart),
    VEHICLE_SIGNAL: compile(raw.vehicleSignals),
    FAKE: compile(raw.fakePatterns),
    OTHER_BRAND: compile(raw.otherBrands),
    // 车型代际/型号细分规则（可选，给 mmax.js / mk2.js 这类脚本用）
    generations: raw.generations || null,
  };
  return PROFILE;
}

const test = (re, s) => (re ? re.test(s) : false);

function norm(title) {
  return String(title || '').replace(/\s+/g, ' ').replace(/(\d)\s+(\d)/g, '$1$2');
}

/**
 * 返回判定详情，便于排障（--debug 用）
 * @param {string} title 商品标题
 * @returns {{ok:boolean,brand:boolean,model:boolean,vehicleSignal:boolean,
 *            accessory:boolean,fake:boolean,other:boolean,reason:string}}
 */
function judge(title) {
  const P = loadProfile();
  const t = norm(title);

  const brand = test(P.BRAND, t);
  const model = test(P.MODEL, t);
  const vehicleSignal = test(P.VEHICLE_SIGNAL, t);
  const accStrong = test(P.ACC_STRONG, t);
  // 单件配件词：只有「没有车辆主体特征」时才算配件
  const accPart = test(P.ACC_PART, t) && !vehicleSignal;
  const accessory = accStrong || accPart;
  const fake = test(P.FAKE, t);
  const other = test(P.OTHER_BRAND, t);

  const hit = (brand || model) && !accessory && !fake;

  let reason;
  if (fake) reason = '仿冒/山寨';
  else if (hit) reason = brand ? '品牌名命中' : '型号词命中';
  else if (accessory) reason = accStrong ? '配件-自报' : '配件-单件';
  else if (other) reason = '其他品牌';
  else reason = '无品牌特征';

  return { ok: hit, brand, model, vehicleSignal, accessory, fake, other, reason };
}

/**
 * 是否为「目标品牌整车」
 * @param {string} title
 * @returns {boolean}
 */
function isTargetBrand(title) {
  return judge(title).ok;
}

// 向后兼容：老调用方写的是 isNinebot
const isNinebot = isTargetBrand;

module.exports = {
  isTargetBrand,
  isNinebot,          // 兼容别名
  judge,
  loadProfile,
  CONFIG_PATH,
};
