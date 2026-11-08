---
name: xianyu-ebike-shopping
description: 二手电动车选购决策助手（闲鱼/Goofish）。抓取闲鱼车源并按真实残值排序，用电池循环数、里程÷循环交叉验证、卖家主页画像三重方法识别调表车与虚价车，支持品牌白名单过滤、准新车分级、代际细分、改装分层与会话式深度核查。Use when: user wants to buy/monitor a used e-bike or scooter on 闲鱼/Xianyu/Goofish, compare second-hand EV listings, check whether a listing is a scam or an odometer rollback, track competitor pricing, set up price alerts. 关键词：闲鱼购车、二手电动车、九号、小牛、二手电动车怎么选、闲鱼监控、调表车、捡漏。
---

# 二手电动车选购决策助手

> 基于开源 [`voltwake/xianyu-monitor`](https://github.com/voltwake/xianyu-monitor)（MIT）改造。
> 核心改造：品牌锁改成**配置驱动白名单**、数据库换 `node:sqlite`（零编译）、导航改 `page.goto`、
> 新增 8 个分析脚本（准新车分级 / 代际细分 / 改装分层 / 单车核查 / 市场采样 / 区域报告）。

## 安装与执行位置

技能根目录：`~/.workbuddy/skills/xianyu-ebike-shopping/`
（也支持任何目录，只要 `npm install` 过）

**所有命令在技能根目录执行**（不是 scripts 里）：

```bash
cd <技能根目录>
node scripts/xianyu.js <command>
```

依赖：`puppeteer-core`（必需）。Node ≥ 22.5 时用内置 `node:sqlite`，**不需要** `better-sqlite3`，
也就不需要 Visual Studio C++ 构建工具。

---

## 一、启动专用 Chrome（机器重启后要跑一次）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-chrome.ps1 start   # Windows
bash scripts/setup-chrome.sh start                                        # macOS / Linux
```

- 独立 profile：`data/chrome-profile`，**不影响日常浏览器**
- CDP 端口 **18803**（脚本会自愈：发现 Chrome 没跑会自动拉起）
- 在那个窗口打开 `https://www.goofish.com`，用**小号**扫码登录
- Cookie 约 7 天有效。其他动作：`status` / `stop`

### 登录 vs 未登录（关键差异）

| 状态 | 可见商品 | 价值 |
|---|---|---|
| 未登录 | 基本只有 **6 小时前**发布的 | 能跑，但时效差，捡漏无意义 |
| 已登录 | **几分钟内**实时发布 | 捡漏与竞品情报的正确姿势 |

自动判定：搜到「X分钟前发布」= 已登录；全是「6小时前发布」= 未登录。

---

## 二、监控任务管理

```bash
# 添加
node scripts/xianyu.js add -k "九号机械师MK2" --zone "珠三角" --max-price 7000 \
  -f "碎屏,维修,回收,租赁"        # -f = 排除词
  # 可选: --min-price 3000  --only "带牌,过户"（必含词）
  # 地区二选一（强烈推荐 --zone）：
  #   --zone "珠三角"       ← 闲鱼官方区域浮层，服务端过滤，最可靠
  #   --region "深圳,广州"  ← 本地文本匹配，未登录时 area 恒为空，会大量误杀

# 查看 / 停用
node scripts/xianyu.js list
node scripts/xianyu.js remove --id 3

# 扫描
node scripts/xianyu.js scan --hours 6
node scripts/xianyu.js scan --id 1 --hours 24
node scripts/xianyu.js history --limit 20
```

扫描输出 `--- NEW_ITEMS_JSON ---` 与 `--- END_NEW_ITEMS_JSON ---` 之间的标准 JSON 数组，
字段：`id / taskKeyword / title / price / area / link / publishTime / wantCount / imageUrl`。
同时落盘 `data/last_digest.md` 与 `data/digest-<时间戳>.md`。

---

## 三、区域筛选（必读）

**优先 `--zone`，不要 `--region`。**

- `--zone "珠三角"` — 点开搜索页「区域」浮层选官方区域，**服务端过滤**，不依赖登录。
  可选值：`全国 / 珠三角 / 江浙沪 / 京津冀 / 东三省 / 广东 / 深圳 / 广州 / 东莞 …`（各省各市）
- `--region "深圳,广州"` — 本地拿 `title + area` 做字符串匹配。**未登录时 `area` 恒为空**，
  只能靠标题写城市名才命中。仅作兜底。

实现：搜索 → 关弹窗 → 点「区域」→ 在 `.ant-popover` 里点目标区域 → 等刷新 → 排序 → 抓取。

---

## 四、品牌白名单（配置驱动）

**默认预设九号 Ninebot，配置在 `config/brand.json`。换品牌只改配置，不改代码。**

```js
const { isTargetBrand, judge } = require('./scripts/lib-brand');
isTargetBrand(title)   // true = 目标品牌整车
judge(title)           // { ok, brand, model, vehicleSignal, accessory, fake, reason }
// 兼容别名：isNinebot
```

判定是**白名单制**，不是品牌黑名单。两条铁律：

| 坑 | 现象 | 正确做法 |
|---|---|---|
| 品牌黑名单 | 标题提其他品牌就排除，误杀率 20% | 只用白名单。「支持换雅迪」「比小牛好骑」是目标品牌车在对比 |
| 配件词一刀切 | 「整车配件齐全」「改了一些配件」被误杀 20%（180 条里 36 条） | 配件判定必须叠加「无车辆主体特征」（公里/过户/上牌/成色…） |

实测：180 条样本 → 保留 176，剔除 4，**误杀 0**。

临时关闭：`young.js --all-brand`、`xianyu.js scan --id N --all-brand`。

> ⚠️ **查配件行情必须关白名单**。查「九号4825电池」「轮胎」「刹车片」时不加 `--all-brand`，
> 会一条都抓不到 —— 白名单会把配件全剔掉。

### 九号电池接口只有两种，买错装不上

- **老国标 2+5**（两粗五细）→ MMAX90、F90、Bmax、C90 等老款
- **新国标 2+4**（两粗四细）→ 机械师二代、NZ90、CZ90、F2Z110 等新款

实测「九号4825电池」珠三角行情：14 条明确适配 2+5，价带 **¥298–500，中位 ¥420**。
这个数直接决定「换电池 vs 换车」的决策边界。

---

## 五、准新车分级：`scripts/young.js`

**核心方法论：不认年款标签，只看真实车龄证据。**

闲鱼写的「24款/25款/26款」是车型版本，不是车龄 —— 实测同标签下车龄能差 15 个月。
判断新旧只能用「**激活日期 + 电池循环 + 行驶里程**」三角验证。

```bash
node scripts/young.js                    # 全部准新车，A/B/C/D 分级
node scripts/young.js --model MZ         # 只看某系列
node scripts/young.js --max-km 8000
node scripts/young.js --json             # JSON 供二次加工
```

- **A 级** ≤14 月或 ≤3000km / **B 级** 15–24 月或 3000–1万km / **C 级** >24 月 / **D 级** 车龄不明
- **里程提取必须排除「续航 XX 公里」**，否则把续航当里程（实测 180 条误判 20+）
- 支持「三千公里」「六百公里」中文数字
- **年份归一化**：`26年` 补成 `2026`，否则算成两千年被全过滤
- **引流识别**：低于同型号中位 55% 自动标记；租赁/分期/首付/押金/车架关键词过滤
- **改装判定**：`改了/凌博/远驱/全顺/顿恩/智科/平叉/半热熔` 命中即算。
  注意「原装也可以复原」是话术 —— 改过再复原仍是改装车

---

## 六、代际细分：`scripts/mmax.js`

**用于命名混乱的产品线。** 同一个「机械师110」在闲鱼指 3 个不同代际，价格差 2000–3000，混着统计必然出错。

```bash
node scripts/mmax.js                                       # 读 DB，按代际出库存表
node scripts/mmax.js --from data/market-report-mmax.json    # 额外出需求热度
node scripts/mmax.js --md 报告.md
node scripts/mmax.js --task 11,12,13,14
```

九号 MMAX 代际判定（顺序即优先级，不可打乱）：

| 顺序 | 代际 | 关键正则 | 识别特征 |
|---|---|---|---|
| 1 | MMAX110 MK2 | `mk\s*2` | **5 寸彩屏**；卖家写「机械师一代mk2」 |
| 2 | MMax2 二代 | `机械师\s*二代\|mmax2\|明日香` | 真二代，MMax2 110P |
| 3 | MMAX110P | `110\s*p\b` | 原厂带 ABS |
| 4 | MMAX110 | `max\s*110` | 4830 电池 |
| 5 | MMAX90 | `max\s*90` | 4825 电池 |

**三个必须踩准的坑**：

1. `mk2` 必须先判，且加 `(?<!mz\s)` 守卫 —— 「MMax2 110P」含 `m2` 但不含 mk2；
   而「Mz MAX」是另一车型。反过来 `\bmk2\b` 会漏掉「MMAX110MK2」这种无空格写法，**不要加词边界**。
2. 「机械师靠背」「机械师坐垫」是配件，主语可能是 Mz/F 系车，不能算 MMAX 整车。
3. **「带 ABS」不是 110P 的证据** —— 有卖家把普通 110 说成带 ABS；
   也有车主写「ABS 提示灯亮」，那是**故障灯在亮**。

> 需求热度只在 `--from` 模式输出：DB 里的 `want_count` 来自「最新」排序，
> 刚挂出的帖子想要数还没累积，直接展示会误导。

---

## 七、改装分层：`scripts/mk2.js`

**用于「一个型号要分原装/改装卖」的场景。** MK2 原装率 62%，且命名和 E80C MK2 / 猎户座 DZ110P MK2 撞车。

```bash
node scripts/mk2.js                    # 读全库，出分层报告
node scripts/mk2.js --debug            # 打印每条分层依据（调规则必用）
node scripts/mk2.js --json
node scripts/mk2.js --md 报告.md
```

四层口径（看**动力链动了哪一段**）：

| 层级 | 判据 | 例 |
|---|---|---|
| 原装 | 无改装词，或明确「全原装/素车」 | — |
| 轻改 | 只动行走/外观（减震/卡钳/上泵/轮毂/包围/座垫） | 布雷博小螃蟹、OUP 包围 |
| 中改 | 控制器 **或** 电机（凌博/远驱/智科/APT/72260） | 智科 260、APT F400 |
| 重改 | 大单体电池（≥60V 或 48V≥40Ah）**或** 控制器+电机双改 | 7665、驰兔 52-120 安 |

**五个必须踩准的坑**（全是实测踩出来的）：

1. **`mk2` 会撞三种车**：E80C MK2（电摩）、猎户座 DZ110P MK2、Mz330 门店堆砌贴。
   必须先过「型号闸门」：要有 `机械师|mmax` 承载，且标题前 18 字不能是别的车系主语。
2. **别的型号抢先出现**：「九号机械师90 450拉3000w…接置换机械师mk2」是 MMAX90 的改装贴。
   规则：`OTHER_MMAX` 位置早于 `mk2` → 判给那台车。
3. **原厂电池不是改装**：`4825 / 4830 / 48V30Ah / 48-30` 是标配，先 strip 再判。
   反过来 `7665 / 7220` 这种四位简写要加 lookahead `(?=电池|锂电|安)`，
   否则会把价格 `7699` 当成 76V99Ah。
4. **否定句会反向判定**：「没改装控制器」命中 `控制器`；「不带电池」命中 `带电池`；
   「没有牌照」命中 `牌照`。必须前置摘掉否定片段，或用 `NOPLATE / NOBAT` 排除。
5. **换轮胎/换刹车片是保养不是改装**；「其它全原」常与「改了上泵」同现，
   `STOCK_ASSERT` 与 `MOD_VERB` 冲突时**以后者为准**。

> 输出时**原装必须再拆「个人转让 / 商家全新」** —— 价差 2000+，混算中位价会失真
> （实测 21 条：个人 ¥6500 vs 商家 ¥7399）。

---

## 八、单车深度核查：`scripts/full-item.js`

**用于「这台车到底能不能买」。** 只看列表页会漏掉两类致命信息：平台打的虚价标签、卖家是不是贩子。

```bash
node scripts/full-item.js <itemId>            # 全量正文 + 参数栏 + 全页截图
node scripts/full-item.js <itemId> --json
node scripts/probe-multi.js <id1> <id2> ...  # 批量抓详情，横向对比
```

**四个必须看的信号**：

1. **「标价不实」是平台标签，不是卖家写的。** 闲鱼按同类成交价自动判定虚价。
   出现即说明标价是引流价。机械师品类出现率很高（21 条里至少 3 条）。
2. **卖家主页决定车的真伪。** 取 `a[href*="userId"]` 的 `userId`，
   访问 `https://www.goofish.com/personal?userId=xxx`：
   - 同时卖多台手机/相机/**散装锂电池** → 二手贩子，标价必虚、电池必疑
   - 4–6 年只卖几件闲置 → 真车主，通常主动写里程和循环次数
   - **卖散装锂电池的人卖电动车 = 高危**：有动机拆原厂电池单卖，再装杂牌
3. **参数栏空白的项比写出来的更可信。** 里程/循环/激活日期三栏同时空白 = 卖家在回避。
4. **「优先置换 / 支持置换」= 收车钩子，不是卖车贴。** 真实意图是钓有车的人来压价收车，
   纯现金买家反而排在后面。

**参数栏解析的坑**：闲鱼参数是竖排 label/value 结构，`innerText` 里会被拆成单字
（`品\n牌\n：\n九号电动`）。别用正则匹配 `品牌：xxx`，要么遍历 `li` 取 `textContent` 归一化，
要么只用参数栏做兜底 —— 主判断还是靠描述正文。

**推荐位是免费增量车源**：详情页底部「为你推荐」按同品类+同地域关联，
常含搜索词没覆盖到的车。抓 `a[href*="item?id="]`，一次能捞 20+ 条。

---

## 九、市场行情：`scripts/market.js` + `market-analyze.js`

摸清某品类「什么型号好卖、什么价位、原装占比多少」：

```bash
node scripts/market.js 九号电动车 九号MZ 九号F90     # 多关键词采样 → data/market-report.json
node scripts/market-analyze.js                       # 剔噪音，输出车型热度榜
```

- `market.js` 用**综合排序**（平台推荐序）而非「最新」：排名靠前 = 平台判定易成交，
  是「好不好卖」最直接的信号
- `market-analyze.js` 按型号聚合：挂牌量、**需求密度**（每条平均想要数）、价格带、原装率/改装率
- 噪音过滤：价格 < ¥300，或标题含「租/分期/首付/押金/回收」

---

## 十、区域系列报告：`scripts/m-report.js`

```bash
node scripts/m-report.js --tasks 2,7,8,9,10 --out 报告.md
```

- 按 task_id 聚合，按型号分组：价格带 / 中位价 / 空车占比 / 改装占比 + 逐条明细
- **清洗链路**：品牌白名单（含仿冒）→ 剔分期租购 → 价格 500–8000 → 剔型号堆砌
  （标题 ≥3 个型号 = 商家引流贴）
- 必须先给任务配 `--zone`，报告里的区域才是真的

> **¥1 / ¥2 标价必须剔除**：改装圈行规 —— 标 1 元强制私聊，真实成交 1.5–2.5 万。
> 不剔会把玩家改装车算进中位数，直接把行情带偏。

---

## 十一、两条硬核算术

### 交叉验证里程（最硬的一招）

48V30Ah 锂电实际单次满放约 55–70 km。用 **里程 ÷ 循环次数** 反推：

- 4700 km ÷ 74 次 = 63.5 km/次 → 自洽 ✅
- 声称 2000 km 但循环 200 次 = 10 km/次 → **必是调表** ❌

**仪表里程能改，电池 BMS 循环数改不了。** 让卖家截 APP 车辆页即可核对。

### 空车价 ≠ 真实成本

锂电版空车出是因为电池拆卖更值钱：

```
空车 ¥3300 + 自购 48V30Ah 锂电 ¥1200–1800 = 落地 ¥4500–5100
```

对比时一律换算成**整车落地成本**，不要拿空车价和带电池价直接比。

---

## 十二、技术原理（排障必读）

1. 连接 CDP：`puppeteer.connect({ browserURL: 'http://127.0.0.1:18803' })`
2. 首页 `page.goto('https://www.goofish.com')` —— **可用**（仅搜索结果 URL 可能触发登录墙）
3. 搜索走页面搜索框：`page.click('input[class*="search-input"]')` → `keyboard.type()` → `Enter`
   （CDP Input 事件 `isTrusted=true`，与真人无差别）
4. 排序：点「新发布」→ 下拉里选「最新」
5. 抓取：`a[class*="feeds-item-wrap"]` 卡片 → 解析标题/价格/地区/链接
6. 去重：SQLite `items` 表以商品 id 为主键

### 反爬实测（2026-11）

| 做法 | 结果 |
|---|---|
| headless Chrome | ❌ 被拦「非法访问」 |
| 带 `?q=` 的搜索结果 URL 直接 goto | ⚠️ 可能触发登录墙 |
| 首页 goto | ✅ 正常 |
| 页面搜索框 CDP 点击 + 键入 + Enter | ✅ 正常 |
| JS `el.click()` | ⚠️ `isTrusted=false`，有风险 |
| **非 headless + CDP Input** | ✅ **推荐姿势** |

### 未登录态实测

- 搜索正常，单次 30 张卡片，`title / price / link / publishTime` 提取成功
- `area` 与 `seller` 为空（登录后有值）
- `imageUrl` 部分为阿里占位图，正常

---

## 十三、定时自动跑

对话里说「每天/每小时跑一次闲鱼监控」即可创建自动化。prompt 模板：

```
闲鱼监控扫描任务。
1. 确保 Chrome 运行：bash <技能根>/scripts/setup-chrome.sh start
2. 扫描：cd <技能根> && node scripts/xianyu.js scan --hours 3
3. 解析 --- NEW_ITEMS_JSON --- 与 --- END_NEW_ITEMS_JSON --- 之间的 JSON 数组。
4. 有新品则推送，每条格式：🛒 标题(截前60字) / 💰 ¥价格 | 📍 地区 / ⏰ 发布时间 / 🔗 link
5. 无新品则安静结束。完成后只回一句「发现N条/无新商品」。
```

也可用系统任务计划：每 30 分钟跑 `node <技能根>/scripts/xianyu.js scan --hours 3`。

---

## 十四、排障

| 症状 | 原因与处理 |
|---|---|
| `无法连接 Chrome (端口 18803)` | Chrome 没启动 → 跑 `setup-chrome.* start` |
| `无法打开闲鱼` | 网络问题或 Chrome 无窗口 → 重启 Chrome |
| 全是「6小时前发布」 | 未登录 / cookie 过期 → 窗口里重新扫码 |
| 搜索结果 0 条 | 过滤太严（价格上限低/排除词多）→ 放宽 `--max-price` 或去掉 `-f` |
| 抓不到卡片 | 前端类名变了 → `node scripts/probe.js` 看当前 DOM，改选择器 |
| `找不到数据库/数据文件` | 正常提示 → 先跑 `xianyu.js scan` 或 `market.js` |
| PowerShell 报「字符串缺少终止符」 | ps1 被按 GBK 解析 → 保持 ps1 内容为纯 ASCII |
| 查配件行情一条都抓不到 | 品牌白名单把配件剔了 → 加 `--all-brand` |

---

## 十五、风控与合规

- 扫描间隔 **≥ 30 分钟**，过快触发 baxia 风控
- **只用小号**，别用主号
- 仅用于个人选购与公开信息观察，遵守闲鱼用户协议
- 不做登录态窃取、不绕过付费墙、不批量爬取个人信息

---

## 目录结构

```
xianyu-ebike-shopping/
├─ SKILL.md                       # 本文件（AI 入口）
├─ README.md / README.en.md       # 面向人的说明
├─ config/
│  ├─ brand.json                  # 品牌白名单（默认九号）
│  └─ brand.example-generic.json  # 换品牌示例（小牛）
├─ scripts/
│  ├─ xianyu.js                   # 核心 CLI（抓取 + SQLite 去重）
│  ├─ lib-brand.js                # 品牌白名单（配置驱动）
│  ├─ lib-guard.js                # 前置条件友好检查
│  ├─ young.js                    # 准新车分级
│  ├─ mmax.js                     # 代际细分
│  ├─ mk2.js                      # 改装四级分层
│  ├─ full-item.js                # 单车深度核查
│  ├─ probe-multi.js              # 批量详情对比
│  ├─ market.js                   # 市场行情采样
│  ├─ market-analyze.js           # 需求密度聚合
│  ├─ m-report.js                 # 区域系列报告
│  ├─ rank.js                     # 自定义维度打分
│  ├─ probe.js                    # DOM 排障探针
│  └─ setup-chrome.ps1 / .sh      # 启动专用 Chrome
├─ docs/
│  ├─ methodology.md
│  ├─ pitfalls.md
│  └─ brand-config.md
└─ data/                          # 运行期：db / chrome-profile / digest（gitignore）
```
