# dsh-token-usage

**DeepSeek Harness 的本地 Token 用量日历。** 在设置里按天、按模型看每个会话消耗了多少 token —— 数据全部来自本机会话日志，不联网、不上传。

[English](README.en.md) · [安装](#安装) · [统计口径](#统计口径) · [常见问题](#常见问题)

![license](https://img.shields.io/badge/license-MIT-blue.svg)
![dsh](https://img.shields.io/badge/DSH-0.2.x-4f7cff.svg)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

---

## 为什么需要它

DSH 只显示**当前会话**的 token 统计。想知道"这个月我在哪个模型上花得最多""昨天跑了多少 token"，只能自己去翻 `~/.dsh/sessions` 里的 zstd 日志。

这个插件把这些日志折成一张月历，放在 **设置 → Token 用量** 里：

```
┌ Token 用量 ────────────────────────────────────────────── 2026 年 10 月 ─┐
│ 本月合计  2.53 亿 tokens · 1,289 次调用 · 缓存命中 98.6%                  │
│   ‹   2026 年 10 月   ›                        最多：v4.1-flash  2.45 亿   │
│                                                                          │
│   一      二      三      四      五      六      日                      │
│   ·       ·       ·       1       2       3       4                      │
│   5       6       7       8       9       10      11                     │
│   …                                                                      │
│   19      20      21      22                                             │
│  4.4亿   2.5亿   1.4亿   2.5亿   ← 每格：当天总量 + 模型彩点              │
│                                                                          │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ 10 月 22 日 · 周四      2.53 亿 tokens · 1,289 次调用 · 缓存命中 98.6% │ │
│ │ ● deepseek-v4.1-flash-1017                  1,289 次        2.53 亿   │ │
│ │   [████████████████████░░░░░]  输入/缓存读/缓存写/输出 占比条          │ │
│ │   输入 3,634,255 · 缓存读 249,335,296 · 输出 890,248                  │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## 功能

- **月历热力图**：一格一天，按当天 token 总量着色；每格下方的小圆点是当天用到的模型（最多 4 个）
- **模型明细**：点某一天，展开当天每个模型的调用次数、输入 / 缓存读 / 缓存写 / 输出，以及四段占比条
- **月度汇总**：当月总量、调用次数、缓存命中率、当月最耗 token 的模型
- **完全本地**：只读 DSH 的会话历史服务，不写数据库、不联网、不新增任何模型可见内容（没有工具、没有 prompt）
- **零依赖**：纯 JS，无构建步骤，无 npm 依赖

## 安装

要求：DSH 桌面端 **0.2.x**，并且 `dsh` 命令可用（安装包会把它链到 `/usr/local/bin/dsh`）。

```bash
# 1. 先完全退出 DSH（⌘Q，关窗口不算）
# 2. 从 GitHub 安装
dsh plugin --profile desktop add git+https://github.com/SauronLee/dsh-token-usage.git
# 3. 打开 DSH → 设置 → Token 用量
```

Web 版把 `--profile desktop` 换成 `--profile web`。

其它安装方式：

| 方式 | 命令 | 适用 |
|---|---|---|
| GitHub 直装 | `dsh plugin --profile desktop add git+https://github.com/SauronLee/dsh-token-usage.git` | 推荐 |
| 自行打包 tgz | `npm pack` 后 `dsh plugin --profile desktop add ./dsh-token-usage-0.1.0.tgz` | 离线机器 |
| clone 后本地装 | `dsh plugin --profile desktop add /path/to/dsh-token-usage` | 改代码 |

> **装完必须重启 DSH。** 客户端插件清单只在启动时扫描一次；热重载只覆盖 `cordis.patch.yml` 的配置行，不覆盖新包。

命令不在 PATH 时用绝对路径：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add git+https://github.com/SauronLee/dsh-token-usage.git
```

## 使用

- 打开 **设置 → Token 用量**（排在「模型」后面）
- 左右箭头翻月，「回到今天」跳回当前月
- 右上角 **刷新** 强制重算；否则结果在进程内缓存 120 秒，启动后 3 秒会预热一次
- 第一次打开显示「正在统计会话日志…」，一般 1 秒内出结果（会话很多时会更久）

## 统计口径

| 项 | 口径 |
|---|---|
| 一次调用 | 一条带 provider usage 的 `assistant/message` 事件；重试各算一次，失败但上报了 usage 的也计入 |
| 当天总量 | 输入 + 缓存读 + 缓存写 + 输出（不直接信任 `totalTokens`，保证分项永远对得上） |
| 归哪一天 | 事件时间戳按**本机时区**归日 |
| 模型名 | `message.source.model`；缺失时记为「未知模型」 |
| 缓存命中率 | 缓存读 ÷ (缓存读 + 输入) |
| 读取失败 | 单个会话日志损坏或正在落盘时只跳过该会话，其余照常统计 |

> **这不是账单。** DSH 不含模型价格表，插件只统计 token 数量，不折算金额。金额、缓存计价、批处理折扣等以 DeepSeek 平台的用量页为准；这里的数字和账单口径也会有差异。

## 隐私

- 只读取 DSH 的会话历史服务（`ctx.sessionQuery`），不解析、不复制、不上传会话内容
- 唯一的对外接口是 `GET /plugins/dsh-token-usage/data`，只返回按天/按模型聚合的 token 计数，走 DSH 自带的浏览器认证
- 没有遥测，没有外部请求，数据不出本机

## 兼容性

| DSH | 状态 |
|---|---|
| 0.2.1-rc.2 | ✅ 已验证（开发机） |
| 其它 0.2.x | 理论可用，欢迎反馈 |
| 0.1.x | ❌ 未验证（`webServer` / `sessionQuery` 接口不同） |

## 常见问题

**设置里没有「Token 用量」**
没有完全重启。关窗口不会重启进程，用 ⌘Q 退出后重新打开。

**显示「读取失败：sessionQuery 服务未挂载」**
你的 profile 组合里禁用了会话历史服务。检查 `cordis.patch.yml` 里 `session-query-sqlite` 那一行。

**数字比平台账单少**
插件只统计本机 `~/.dsh/sessions` 能看到的会话。换机器、删日志、清空历史都会让它变少。

**数字不动**
结果缓存 120 秒；点「刷新」强制重算。

**能看金额吗**
不能。插件不含价格表，只有 token 数量。

## 开发

```
dsh-token-usage/
├── lib/index.js        # host 侧：折账、缓存、HTTP 路由（纯 ESM，无依赖）
├── lib/client.js       # 浏览器侧：设置节、日历 UI（手写 client bundle 协议）
├── cordis.patch.yml    # bundle 补丁：往组合树里插一行
├── scripts/install.mjs # 没有 dsh 命令时的兜底安装脚本
└── test/*.test.mjs     # node:test
```

```bash
node --test test/*.test.mjs
```

浏览器侧没有构建步骤：它按 DSH 的 `window.__ModuleLoader__.load({ id, factory })` 协议手写，只从平台模块表取 `react`。改完 `lib/client.js` 刷新页面即可；host 侧改动需要重启进程（HMR 只重读配置，不重载模块根）。

测试覆盖：折账纯函数（跨天、跨模型、脏数据）、路由处理（含认证拒绝）、以及用 `react-dom/server` 真渲染日历组件。

### 数据接口

```
GET /plugins/dsh-token-usage/data[?refresh=1]
```

需要浏览器已认证（和其它插件路由一样走 connection 网关）。返回：

```jsonc
{
  "generatedAt": 1792655000000,
  "timeZone": "Asia/Shanghai",
  "ttlMs": 120000,
  "sessions": 64,          // 成功读取的会话数
  "failedSessions": 0,     // 读不出来的会话数（损坏/正在落盘），不影响其它记录
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

## 卸载

```bash
dsh plugin --profile desktop remove dsh-token-usage
```

然后重启 DSH。

## 许可

[MIT](LICENSE)