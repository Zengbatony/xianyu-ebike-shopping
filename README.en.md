# 🛵 Used E-Bike Shopping Assistant (Xianyu / Goofish)

> An AI Agent skill that ranks second-hand e-bikes on Xianyu by **real residual value** — not by listing titles.

[![test](https://github.com/Zengbatony/xianyu-ebike-shopping/actions/workflows/test.yml/badge.svg)](https://github.com/Zengbatony/xianyu-ebike-shopping/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-brightgreen)](https://nodejs.org)

---

## The problem

The used e-bike market is extremely asymmetric. Two listings for the same model can differ by 3,000 RMB — and look identical in the search grid:

```
"Ninebot MMOX110 MK2, excellent condition, papers complete"     ¥5000
"Ninebot MK2 activated 2025-08, 4000 km, OEM 48V30Ah, 109 cycles, still under warranty"  ¥4608
```

**The second one is cheaper and has far better condition.** A human can tell after 20 listings. After 200, they start guessing. This skill turns that judgment into executable rules.

It is not a price watcher. A watcher only says "new item". This answers:

- Is this bike **worth** the asking price?
- Is this **seller** trustworthy?
- Is the odometer **rolled back**?
- Is there a **strictly better option** at the same price?

---

## Three core methods

### 1. Anchor residual value on battery cycles, not model year

The battery is 30–50% of an e-bike's cost. **Odometer readings can be edited; BMS cycle counts cannot.**

Sellers write "2024 model / 2025 model / 2026 model" — those are product versions, not age. Measured on the same label, real age varied by **15 months**.

| Battery cycles | Price observed |
|---|---|
| 17 | ¥999 |
| 109 | ¥4608 |
| 174 | ¥480 |
| 320 | ¥350 |
| 530 | (dead cell, ¥150–250) |

> Ask the seller for a screenshot of the vehicle page in the official app. It beats any description.

### 2. Cross-validate odometer with `km ÷ cycles`

A 48V30Ah pack delivers roughly 55–70 km per full discharge:

```
4700 km ÷ 74 cycles  = 63.5 km/cycle   ✅ consistent
2000 km ÷ 200 cycles = 10.0 km/cycle   ❌ rolled back
```

10 km/cycle is physically implausible. One division exposes a tampered odometer.

### 3. Judge the seller's profile, not the bike

The single most useful finding in this project, from a 21-listing sample:

| What the seller's profile shows | Who they are | What the bike looks like |
|---|---|---|
| 3 iPhones + smartwatch + action camera + loose Li-ion packs | **Reseller** | Platform flags "price untrue", unverifiable battery, "trade-in preferred" |
| 9 idle items over 4 years | **Real owner** | Volunteers mileage, volunteers cycle count, negotiable |

**Someone who also sells loose lithium packs has every incentive to strip the OEM battery and swap in a generic one.**

---

## What it does

| Capability | Script | In one line |
|---|---|---|
| Keyword monitoring + dedup | `xianyu.js` | Scheduled scans, SQLite primary-key dedup |
| Region filter | `--zone` | Uses Xianyu's official region popover (server-side) |
| Brand whitelist | `lib-brand.js` | Filters accessory posts, counterfeits, other brands — config driven |
| Near-new grading | `young.js` | Activation + mileage + cycles triangulation, A/B/C/D |
| Generation split | `mmax.js` | When one name covers several generations |
| Mod-level layering | `mk2.js` | Stock / light / mid / heavy, by drivetrain intrusion |
| Single-item audit | `full-item.js` | Full detail + spec table + seller profile |
| Market sampling | `market.js` | Demand density and stock-modification ratio |
| Region report | `m-report.js` | Series × region → Markdown report |

---

## Quick start

```bash
git clone git@github.com:Zengbatony/xianyu-ebike-shopping.git
cd xianyu-ebike-shopping
npm install

# 1. Launch a dedicated Chrome (separate profile)
powershell -ExecutionPolicy Bypass -File scripts/setup-chrome.ps1 start   # Windows
bash scripts/setup-chrome.sh start                                        # macOS / Linux

# 2. Log in with a THROWAWAY account at https://www.goofish.com
#    (without login you only see items older than 6 hours)

# 3. Add a watch
node scripts/xianyu.js add -k "Ninebot MMOX110 MK2" --zone "深圳" --max-price 7000

# 4. Scan and analyse
node scripts/xianyu.js scan --hours 6
node scripts/mk2.js --md report.md
node scripts/full-item.js <itemId>
```

---

## Swap the brand / category

Default preset is Ninebot. To target another brand, edit `config/brand.json` only — no code changes:

```bash
cp config/brand.example-generic.json config/brand.json
```

The skill applies to any category with **model-name chaos, accessory noise, and counterfeits**.

---

## Docs

| File | Contents |
|---|---|
| [docs/methodology.md](docs/methodology.md) | Residual anchoring, triangulation, mod layering, bare-bike cost math |
| [docs/pitfalls.md](docs/pitfalls.md) | 12 pitfalls measured the hard way |
| [docs/brand-config.md](docs/brand-config.md) | How to write a brand whitelist |

---

## Ethics & rate limits

- Scan interval **≥ 30 minutes**; faster triggers anti-bot risk control
- **Use a throwaway account only**
- Public information observation and personal purchasing only
- No credential theft, no paywall bypass, no bulk personal-data scraping

---

## Credits

Built on top of [voltwake/xianyu-monitor](https://github.com/voltwake/xianyu-monitor) (MIT).
Brand filtering rewritten, 8 analysis scripts added, Windows build dependency removed.

Released under MIT — see [LICENSE](LICENSE).
