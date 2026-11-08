# 🛵 闲鱼二手电动车选购助手

> 一个给 AI Agent 用的 Skill：把闲鱼上「看起来都差不多」的二手电动车，按**真实残值**排出顺序。

[![test](https://github.com/Zengbatony/xianyu-ebike-shopping/actions/workflows/test.yml/badge.svg)](https://github.com/Zengbatony/xianyu-ebike-shopping/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()

---

## 它解决什么问题

二手电动车是信息极度不对称的市场。同一台车，卖家写的标题能差出 3000 块：

```
「九号机械师110 MK2 成色很新 手续齐全」        ¥5000
「九号机械师一代mk2 25年8月激活 4000公里 原厂48V30Ah 循环109次 还在保修」  ¥4608
```

**第二条比第一条便宜，而且车况好几倍。** 但在闲鱼列表里，两条长得一样 —— 缩略图、价格区间、几个标签。

人工翻 20 条还能分辨，翻 200 条就开始凭感觉了。这个 Skill 做的就是把这套判断变成可执行的规则。

它不是"价格监控器"。监控器只会告诉你"有新货了"。它要回答的是：

- 这台车**值不值**这个价？
- 这个卖家**靠不靠谱**？
- 卖家说的里程，**是不是调过表**？
- 同价位里**有没有严格更优解**？

---

## 三个核心方法

### 一、用电池循环数锚定残值，不看车龄、不看年款

二手电动车最贵的部件是电池，占整车成本 30–50%。而**仪表盘里程能改，电池 BMS 的循环次数改不了**。

所以判断真实残值的锚点是**循环次数**，不是「24款/25款」这种卖家随便写的标签。

实测同一批车里：

| 电池循环 | 挂牌价 |
|---|---|
| 17 次 | ¥999 |
| 109 次 | ¥4608 |
| 174 次 | ¥480 |
| 320 次 | ¥350 |
| 530 次 | （废电池，¥150–250） |

> ⚠️ 上表循环数与价格不是同一台车，仅示意「循环数是价格的最强预测变量」。
> 让卖家截一张 APP 车辆页，比让他描述成色可靠一百倍。

### 二、用「里程 ÷ 循环」交叉验证调表

48V30Ah 锂电实际单次满放续航约 55–70 km。反推一下就知道真假：

```
4700 km ÷ 74 次  = 63.5 km/次   ✅ 自洽
2000 km ÷ 200 次 = 10.0 km/次   ❌ 调过表
```

**10 km/次 在物理上不可能**（除非每次只骑 10 公里就充电，还要充 200 次）。这个算式能一句话戳穿调表车。

### 三、看卖家主页，比看车更准

这是本项目最有用的一个发现。同一批 21 条样本里：

| 卖家主页在卖什么 | 实际是什么人 | 车的特征 |
|---|---|---|
| 3 台 iPhone + 手表 + 运动相机 + 散装锂电池 | **二手贩子** | 平台打「标价不实」、电池来源不可证、写着「优先置换」 |
| 4 年只卖过 9 件闲置 | **真车主** | 主动写里程、主动写电池循环次数、价格实在 |

判据很简单：**主页全是数码产品和散装电池的人，卖车就是在做流水；主页一年卖一两件闲置的人，卖车才是真的换车。**

其中"同时卖散装锂电池"是最强的危险信号 —— 一台车最值钱的就是电池，有渠道拆卖电池的人，没有理由不拆。

---

## 能做什么

| 能力 | 脚本 | 一句话 |
|---|---|---|
| 关键词监控 + 去重 | `xianyu.js` | 定时扫描，新上架就落盘，SQLite 主键去重 |
| 区域筛选 | `--zone` | 走闲鱼官方「区域」浮层，服务端过滤 |
| 品牌白名单 | `lib-brand.js` | 剔配件贴、仿冒车、别品牌，配置驱动 |
| 准新车分级 | `young.js` | 激活日期+里程+循环三角验证，A/B/C/D 分级 |
| 代际细分 | `mmax.js` | 同一名字在二手市场指好几代车时，拆开统计 |
| 改装分层 | `mk2.js` | 原装/轻改/中改/重改四级，看动力链动了哪一段 |
| 单车深度核查 | `full-item.js` | 全量详情+参数栏+卖家主页，判真伪 |
| 市场行情采样 | `market.js` | 综合排序采样，算需求密度与原装率 |
| 区域系列报告 | `m-report.js` | 某系列 × 某区域，出 Markdown 对比报告 |

---

## 3 分钟跑起来

```bash
git clone git@github.com:Zengbatony/xianyu-ebike-shopping.git
cd xianyu-ebike-shopping
npm install
```

**第一步：启动一个专用的 Chrome（独立 profile，不影响日常浏览器）**

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/setup-chrome.ps1 start
# macOS / Linux
bash scripts/setup-chrome.sh start
```

在弹出的窗口里打开 `https://www.goofish.com`，**用小号**扫码登录。

> 不登录也能跑，但只能看到 6 小时前发布的货 —— 捡漏没有意义。Cookie 约 7 天过期。

**第二步：加监控词**

```bash
node scripts/xianyu.js add -k "九号机械师MK2" --zone "珠三角" --max-price 7000 -f "租赁,分期,回收,代拍"
node scripts/xianyu.js add -k "九号MMAX110"  --zone "深圳"   --max-price 6000
```

> `--zone` 走官方区域筛选，服务端过滤，最可靠。
> 不要用 `--region`：未登录时 `area` 字段恒为空，会大量误杀。

**第三步：扫一次**

```bash
node scripts/xianyu.js scan --hours 6
```

**第四步：出分析**

```bash
node scripts/market.js 九号机械师MK2 九号MMAX110     # 市场采样
node scripts/mk2.js --md 报告.md                     # 改装分层报告
node scripts/full-item.js <商品ID>                   # 单车深度核查
```

---

## 换品类 / 换品牌

默认预设是九号（Ninebot）。**换品牌只需要改 `config/brand.json`，不用动代码。**

```bash
cp config/brand.example-generic.json config/brand.json   # 里面是小牛的完整示例
# 改 brandPatterns / modelPatterns 即可
```

五个字段怎么填，见 [docs/brand-config.md](docs/brand-config.md)。

这个能力不限于电动车 —— 只要目标品类有"型号混乱、配件混杂、仿冒品"这三个特征，白名单过滤就能用。

---

## 两条必读的方法论

| 文档 | 内容 |
|---|---|
| [docs/methodology.md](docs/methodology.md) | 残值锚点、三角验证、改装分层、空车成本换算、需求密度 |
| [docs/pitfalls.md](docs/pitfalls.md) | 12 个实测踩过的坑：为什么"里程"会抓到"续航"、为什么品牌黑名单不可用 |

这两份是真正值钱的部分。代码谁都能写，坑是钱和时间换来的。

---

## 一个真实案例（脱敏）

两台同款同色 MK2，价格只差 ¥392：

| | A 车 | B 车 |
|---|---|---|
| 标价 | ¥5000 | **¥4608** |
| 平台标签 | **「标价不实」** | — |
| 卖家 | 6 年卖 39 件，主页 3 台 iPhone + 运动相机 + **散装锂电池** | 4 年卖 9 件，纯个人 |
| 激活 | 未写 | 2025-08 |
| 里程 | **未写** | 4000 km |
| 电池 | 48V30Ah（来源不可证） | 原厂，**循环 109 次** |
| 保修 | 未提 | **仍在保** |

A 车贵 ¥392，且：平台判定虚价、卖家是贩子、里程电池全空白、写着「优先置换」（收车钩子）。
B 车便宜、里程少 1 万、循环少 421 次、还在保修。

**结论不需要算第二遍。** 而如果只看列表页，这两条几乎没有区别。

---

## 风控与合规

- **扫描间隔 ≥ 30 分钟**，过快会触发 baxia 风控
- **只用小号**，不要用主号
- 仅用于个人选购与公开信息观察，遵守闲鱼用户协议
- 本项目不做登录态窃取、不绕过付费墙、不批量爬取个人信息

---

## 致谢与授权

本项目基于 [voltwake/xianyu-monitor](https://github.com/voltwake/xianyu-monitor) 改造，上游为 **MIT License**。

### 上游 LICENSE 对使用者只有两句话

MIT 全文的强制义务集中在这一段：

> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.

翻成可执行的两件事：

1. **保留版权声明** —— 任何副本、任何分发形式都必须带 `Copyright (c) <年份> <作者>`
2. **保留许可声明** —— MIT 正文含免责声明必须原样保留，不能删改

MIT 允许闭源商用、允许修改、允许再许可，**但署名权不可剥离**。

### 本项目的履行方式

```licence
Copyright (c) 2026 voltwake
  upstream: https://github.com/voltwake/xianyu-monitor

Copyright (c) 2026 Zengbatony
  modifications: https://github.com/Zengbatony/xianyu-ebike-shopping
```

> ⚠️ **上游 LICENSE 的一个瑕疵**：原文写的是 `Copyright (c) 2026`，年份后面没有著作权人姓名。
> 本项目按仓库所有者推断署名人为 `voltwake`，并在 LICENSE 中显式写上上游 URL 使来源可追溯。
> 这是推断而非原文记载，已在本节记录。

**保留自上游**：CLI 骨架、SQLite 去重、Chrome CDP 连接、搜索与扫描主流程。

**本项目新增**：品牌白名单配置化、准新车分级（`young.js`）、代际细分（`mmax.js`）、改装四级分层（`mk2.js`）、单车深度核查（`full-item.js`）、`lib-guard.js` 友好前置检查、16 个品牌判定用例、版权合规检查。

**本项目重写**：品牌过滤从硬编码改为配置驱动；`better-sqlite3` → `node:sqlite`（Windows 零编译）；SendKeys 导航 → `page.goto`；`seed` 命令支持 `zone` 字段；`setup-chrome.sh` 跨平台探测。

### 完整规范

许可要求、四种衍生情形的处理、发布前检查清单，见 [docs/licensing.md](docs/licensing.md)。
自动化检查：`npm run check:license`（CI 已接入，不通过直接 fail）。

**任何派生自本项目的作品，同样需要保留以上两段版权声明。**

---

## 目录结构

```
xianyu-ebike-shopping/
├─ SKILL.md                    # AI Agent 入口（skill 定义）
├─ README.md                   # 本文件
├─ README.en.md                # English
├─ config/
│  ├─ brand.json               # 品牌白名单（默认九号）
│  └─ brand.example-generic.json  # 换品牌示例（小牛）
├─ scripts/
│  ├─ xianyu.js                # CLI + 抓取 + SQLite 去重
│  ├─ lib-brand.js             # 品牌白名单判定（配置驱动）
│  ├─ lib-guard.js             # 前置条件友好检查
│  ├─ young.js                 # 准新车分级
│  ├─ mmax.js                  # 代际细分
│  ├─ mk2.js                   # 改装四级分层
│  ├─ full-item.js             # 单车深度核查
│  ├─ market.js                # 市场行情采样
│  ├─ market-analyze.js        # 需求密度聚合
│  ├─ m-report.js              # 区域系列报告
│  ├─ rank.js                  # 自定义维度打分
│  ├─ probe.js                 # DOM 排障探针
│  └─ setup-chrome.{ps1,sh}    # 启动专用 Chrome
├─ scripts/check-license.js    # 版权合规检查（CI 用）
├─ docs/
│  ├─ methodology.md           # 方法论
│  ├─ pitfalls.md              # 踩过的坑
│  ├─ brand-config.md          # 品牌配置说明
│  └─ licensing.md             # 版权与许可规范
├─ templates/
│  ├─ LICENSE.mit-self         # 自研项目 LICENSE 模板
│  ├─ LICENSE.mit-derived      # 衍生 MIT 项目 LICENSE 模板
│  ├─ NOTICE.apache            # Apache-2.0 衍生的 NOTICE 模板
│  └─ CREDITS.snippet.md       # README 的致谢段模板
└─ data/                       # 运行期产物（db / chrome-profile / digest），已 gitignore
```
