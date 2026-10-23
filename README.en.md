# dsh-token-usage

**A local token-usage calendar for DeepSeek Harness.** See how many tokens each day and each model actually consumed, straight from your on-disk session logs — no network, no upload.

[简体中文](README.md) · [Install](#install) · [How the numbers work](#how-the-numbers-work) · [FAQ](#faq)

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![dsh](https://img.shields.io/badge/DSH-0.2.x-4f7cff.svg)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

---

## Why

DSH shows token usage for the **current session only**. To answer "which model ate my month" or "how many tokens did I burn yesterday", you have to dig through the zstd session logs under `~/.dsh/sessions` yourself.

This plugin folds those logs into a month calendar under **Settings → Token 用量**:

```
┌ Token 用量 ────────────────────────────────────────────── October 2026 ──┐
│ Month   253.2M tokens · 1,289 calls · 98.6% cache hit                     │
│   ‹   October 2026   ›                          top: v4.1-flash  245M      │
│                                                                          │
│   Mon     Tue     Wed     Thu     Fri     Sat     Sun                     │
│   ·       ·       1       2       3       4       5                      │
│   …                                                                      │
│   19      20      21      22                                             │
│  440M    250M    140M    253M    ← daily total + one dot per model        │
│                                                                          │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Oct 22, Thu        253.2M tokens · 1,289 calls · 98.6% cache hit      │ │
│ │ ● deepseek-v4.1-flash-1017                  1,289 calls      253.2M   │ │
│ │   [████████████████████░░░░░]  input / cache read / cache write / out │ │
│ │   input 3,634,255 · cache read 249,335,296 · output 890,248           │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## Features

- **Month heatmap** — one cell per day, tinted by that day's total tokens; per-day model dots below the number (up to 4)
- **Per-model breakdown** — click a day to expand calls, input / cache read / cache write / output, and a four-segment share bar for every model used that day
- **Month rollup** — month total, calls, cache hit rate, and the heaviest model of the month
- **Fully local** — reads DSH's session-history service only; no database writes, no network calls, nothing model-visible (no tools, no prompt text)
- **Zero dependencies** — plain JS, no build step, no npm packages

## Install

Requires DSH desktop **0.2.x** and the `dsh` command (the installer links it to `/usr/local/bin/dsh`).

```bash
# 1. Fully quit DSH first (⌘Q — closing the window is not enough)
# 2. Install from GitHub
dsh plugin --profile desktop add git+https://github.com/SauronLee/dsh-token-usage.git
# 3. Open DSH → Settings → Token 用量
```

For the Web profile use `--profile web` instead of `--profile desktop`.

Other options:

| Option | Command | When |
|---|---|---|
| From GitHub | `dsh plugin --profile desktop add git+https://github.com/SauronLee/dsh-token-usage.git` | recommended |
| Self-packed tarball | `npm pack`, then `dsh plugin --profile desktop add ./dsh-token-usage-0.1.0.tgz` | offline machines |
| Local clone | `dsh plugin --profile desktop add /path/to/dsh-token-usage` | hacking on it |

> **A restart is required.** The client plugin manifest is scanned once at boot; HMR only reloads `cordis.patch.yml` rows, not newly installed packages.

If `dsh` is not on your PATH:

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add git+https://github.com/SauronLee/dsh-token-usage.git
```

## Usage

- Open **Settings → Token 用量** (listed after Models)
- Arrows switch months, "回到今天" jumps back to the current month
- **刷新** forces a rebuild; otherwise the ledger is cached in-process for 120 s and warmed 3 s after boot
- The first open shows "正在统计会话日志…" and usually resolves within a second

## How the numbers work

| Item | Rule |
|---|---|
| One call | One `assistant/message` event carrying provider usage. Retries count separately; failed attempts that still reported usage count too |
| Day total | input + cache read + cache write + output (computed from parts, not from `totalTokens`, so the breakdown always adds up) |
| Day bucket | Event timestamp in the **host's local time zone** |
| Model name | `message.source.model`, falling back to a placeholder when absent |
| Cache hit rate | cache read ÷ (cache read + input) |
| Read failure | A corrupt or mid-write session log is skipped; the rest still counts |

> **This is not a bill.** DSH ships no model price table, so the plugin counts tokens and never converts to money. For actual spend, cache pricing and batch discounts, see your DeepSeek platform usage page.

## Privacy

- Reads only `ctx.sessionQuery`; session content is never parsed, copied or uploaded
- The single endpoint, `GET /plugins/dsh-token-usage/data`, returns aggregated token counts only and sits behind DSH's browser authentication
- No telemetry, no outbound requests; data never leaves the machine

## Compatibility

| DSH | Status |
|---|---|
| 0.2.1-rc.2 | ✅ verified on the development machine |
| other 0.2.x | expected to work; feedback welcome |
| 0.1.x | ❌ untested (`webServer` / `sessionQuery` differ) |

## FAQ

**There is no "Token 用量" section in Settings.**
You did not fully restart. Closing the window keeps the process alive — quit with ⌘Q and reopen.

**"读取失败：sessionQuery 服务未挂载"**
Your profile composition disables the session-history service. Check the `session-query-sqlite` row in `cordis.patch.yml`.

**The numbers are lower than my platform bill.**
Only sessions visible under this machine's `~/.dsh/sessions` are counted. Another machine, deleted logs, or cleared history all reduce the total.

**The numbers do not move.**
The ledger is cached for 120 s; press 刷新 to force a rebuild.

**Can it show money?**
No. There is no price table, only token counts.

## Development

```
dsh-token-usage/
├── lib/index.js        # host half: folding, cache, HTTP route (plain ESM, no deps)
├── lib/client.js       # browser half: settings section + calendar UI (hand-written bundle)
├── cordis.patch.yml    # bundle patch: inserts the host row
├── scripts/install.mjs # fallback installer for machines without the dsh command
└── test/*.test.mjs     # node:test
```

```bash
node --test test/*.test.mjs
```

The browser half has no build step: it is written directly in DSH's `window.__ModuleLoader__.load({ id, factory })` protocol and only requires `react` from the platform module table. Edit `lib/client.js` and refresh the page; host-side changes need a process restart (HMR reloads configuration, not module roots).

Tests cover the folding helpers (cross-day, cross-model, malformed rows), the route handler (including the auth rejection), and a real `react-dom/server` render of the calendar.

### Data endpoint

```
GET /plugins/dsh-token-usage/data[?refresh=1]
```

Requires an authenticated browser (same connection gate as every other plugin route).

```jsonc
{
  "generatedAt": 1792655000000,
  "timeZone": "Asia/Shanghai",
  "ttlMs": 120000,
  "sessions": 64,
  "failedSessions": 0,
  "totals": { "calls": 4927, "input": 0, "cacheRead": 0, "cacheWrite": 0, "output": 0, "total": 0 },
  "days": {
    "2026-10-22": {
      "calls": 1289, "input": 3634255, "cacheRead": 249335296, "cacheWrite": 0, "output": 890248,
      "total": 253170790,
      "models": [{ "model": "deepseek-v4.1-flash-1017", "calls": 1289, "total": 253170790 }]
    }
  },
  "models": [{ "model": "deepseek-v4.1-flash-1017", "calls": 4927, "total": 0 }]
}
```

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-token-usage
```

Then restart DSH.

## License

[MIT](LICENSE)