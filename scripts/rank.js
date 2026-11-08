// 按多维条件给闲鱼结果打分排序（可选工具）
// 用法: node scripts/rank.js <taskId> [--conditions=牌,空车]
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB = path.join(__dirname, '..', 'data', 'xianyu-monitor.db');
const taskId = process.argv[2] || 2;

const PEARL_RIVER = ['深圳', '广州', '东莞', '佛山', '惠州', '中山', '珠海', '江门', '肇庆',
  '龙岗', '宝安', '龙华', '南山', '福田', '罗湖', '坪山', '光明', '盐田', '大鹏',
  '番禺', '天河', '白云', '增城', '花都', '黄埔', '从化', '南沙', '荔湾', '越秀', '海珠',
  '顺德', '南海', '禅城', '三水', '高明', '虎门', '长安镇', '松山湖', '大岭山',
  '惠城', '惠阳', '大亚湾', '斗门', '金湾', '香洲', '蓬江', '新会', '四会'];

// 明确异地（非珠三角）
const OTHER_CITIES = ['北京', '上海', '杭州', '哈尔滨', '天津', '成都', '重庆', '南京', '武汉',
  '西安', '苏州', '瑞安', '温州', '宁波', '济南', '青岛', '长沙', '郑州', '合肥', '福州',
  '厦门', '泉州', '南昌', '昆明', '贵阳', '南宁', '石家庄', '太原', '沈阳', '长春', '大连',
  '常州', '无锡', '徐州', '嘉兴', '金华', '台州', '绍兴', '湖州', '临沂', '潍坊', '洛阳'];

function parseMileage(title) {
  const m = title.match(/(\d+(?:\.\d+)?)\s*(万|千|w|k)?\s*(多)?\s*(公里|km|KM|Km)/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = m[2];
  if (unit === '万' || unit === 'w') n *= 10000;
  else if (unit === '千' || unit === 'k') n *= 1000;
  return Math.round(n);
}

function analyze(title, area) {
  const hasPlate = /带牌|真牌|有牌|牌证|牌照|上牌|已上牌|牌车|过户/.test(title);
  const isEmptyCar = /空车|裸车|不含电池|不带电池|无电池|空架|仅车架|换电\s*空车|车架空车/.test(title);
  const hasBattery = /带.{0,6}电池|含电池|大动力电池|铅酸电池|锂电池|安时|ah|AH/.test(title);
  const mileage = parseMileage(title);

  const prHit = PEARL_RIVER.filter(c => (title + area).includes(c));
  const otherHit = OTHER_CITIES.filter(c => (title + area).includes(c));

  return { hasPlate, isEmptyCar, hasBattery, mileage, prHit, otherHit };
}

const db = new DatabaseSync(DB);
const rows = db.prepare('SELECT title, price, area, link, publish_time FROM items WHERE task_id = ?').all(taskId);

console.log(`共 ${rows.length} 条结果\n`);

const scored = rows.map(r => {
  const a = analyze(r.title, r.area || '');
  let score = 0;
  if (a.hasPlate) score += 30;
  if (a.isEmptyCar) score += 30;
  if (a.mileage !== null) {
    const d = Math.abs(a.mileage - 10000) / 10000;
    if (d <= 0.25) score += 25;        // 7500~12500 公里
    else if (d <= 0.6) score += 12;    // 4000~16000
  }
  if (a.prHit.length) score += 20;
  if (a.otherHit.length && !a.prHit.length) score -= 40;
  return { ...r, ...a, score };
});

scored.sort((x, y) => y.score - x.score);

for (const s of scored) {
  const tags = [];
  if (s.hasPlate) tags.push('带牌');
  if (s.isEmptyCar) tags.push('空车');
  if (s.hasBattery && !s.isEmptyCar) tags.push('含电池');
  tags.push(s.mileage !== null ? `${s.mileage}公里` : '里程未写');
  const loc = s.prHit.length ? `珠三角:${s.prHit[0]}` : (s.otherHit.length ? `异地:${s.otherHit[0]}` : '地区未知');

  console.log(`[${String(s.score).padStart(3)}分] ¥${s.price} | ${loc} | ${tags.join(' / ')}`);
  console.log(`      ${s.title.slice(0, 110)}`);
  console.log(`      ${s.link}\n`);
}

db.close();
