/**
 * lib-guard.js — 友好的前置条件检查
 *
 * 存在的理由：这几个脚本是串起来用的 —— market.js 产出 JSON，young.js 才读得到；
 * xianyu.js 扫过，mk2.js / m-report.js 才有库可查。
 * 直接抛 ENOENT / SQLITE_CANTOPEN 对使用者毫无信息量，所以统一转成人话。
 */

const fs = require('fs');
const path = require('path');

/** 读 JSON，失败时给出下一步该跑什么 */
function readJsonOrExit(file, hint) {
  if (!fs.existsSync(file)) {
    console.error(`\n❌ 找不到数据文件：${file}`);
    if (hint) console.error(`   → ${hint}`);
    console.error('');
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`\n❌ 数据文件不是合法 JSON：${file}`);
    console.error(`   ${e.message}`);
    console.error('');
    process.exit(1);
  }
}

/** 打开 SQLite，失败时提示先跑扫描 */
function openDbOrExit(dbPath, hint) {
  if (!fs.existsSync(dbPath)) {
    console.error(`\n❌ 找不到数据库：${dbPath}`);
    console.error(`   → ${hint || '请先运行一次扫描：node scripts/xianyu.js scan --hours 6'}`);
    console.error('');
    process.exit(1);
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (e) {
    console.error(`\n❌ 当前 Node 不支持 node:sqlite（需要 v22.5+）`);
    console.error(`   当前版本：${process.version}，请升级 Node 后重试。`);
    console.error('');
    process.exit(1);
  }
  return new DatabaseSync(dbPath);
}

module.exports = { readJsonOrExit, openDbOrExit };
