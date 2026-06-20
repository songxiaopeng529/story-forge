# browser-use 在 macOS 上的安装、启动与排障

## Table of Contents

- [1. 一次性安装：全局，而不是项目级](#1-一次性安装全局而不是项目级)
- [2. 选择一种"复用登录态"的方案](#2-选择一种复用登录态的方案)
- [3. macOS 上启动调试端口 Chrome 的"硬坑"](#3-macos-上启动调试端口-chrome-的硬坑)
  - [3.1 关掉当前 Chrome](#31-关掉当前-chrome)
  - [3.2 不能用默认 user-data-dir](#32-不能用默认-user-data-dir)
  - [3.3 不要把 user-data-dir 放到 `~/Library/Application Support/`](#33-不要把-user-data-dir-放到-libraryapplication-support)
  - [3.4 复制现有 Chrome 数据到调试目录（保留登录态）](#34-复制现有-chrome-数据到调试目录保留登录态)
  - [3.5 用真正的二进制路径启动（不要 `open -na`）](#35-用真正的二进制路径启动不要-open--na)
  - [3.6 验证](#36-验证)
  - [3.7 之后的复用（一行启动）](#37-之后的复用一行启动)
- [4. 用 browser-use CLI 接管已启动的 Chrome](#4-用-browser-use-cli-接管已启动的-chrome)
- [5. 常见报错 → 解决](#5-常见报错--解决)
- [6. CLI 失效时的兜底：CDP 直接截图](#6-cli-失效时的兜底cdp-直接截图)
  - [6.1 完整截图流程（实战版）](#61-完整截图流程实战版)
- [7. 任务收尾](#7-任务收尾)
- [8. 一句话总结](#8-一句话总结)

本 skill 在"产品端截图"与"DOM 视觉树抽取"步骤都依赖 browser-use（或退一步用 CDP 直连）。
本文沉淀本仓库验证过的一套 **macOS 上稳定可用** 的安装、启动与排障流程，供后续任务复用。

> 出现任何"截图卡住、登录态失效、端口不通、Session 报错"问题前，**先按本文档比对一遍**，
> 不要再从零摸索。

## 1. 一次性安装：全局，而不是项目级

`uv init && uv add browser-use && uv sync` 是**项目级**操作，会在当前目录创建
`pyproject.toml` / `.venv` / `uv.lock` / `main.py`，污染业务仓库。

**正确做法**是用 `uv tool` 全局安装，任意目录都能用 `browser-use` 命令：

```bash
uv tool install browser-use     # 全局安装 CLI 到 ~/.local/bin
uvx browser-use install         # 装 Chromium（首次需要）
```

升级 / 卸载：

```bash
uv tool upgrade browser-use
uv tool uninstall browser-use
```

如果之前已经在某个仓库里跑过 `uv init`，按 `git status --short --ignored` 比对后，
仅删除 `pyproject.toml`、`uv.lock`、`.python-version`、`.venv/`、以及 `uv init`
模板生成的 `main.py` / `hello.py`（**不要**删原仓库已有文件）。

## 2. 选择一种"复用登录态"的方案

业务页面（飞书、RMP 等）几乎都需要登录。让 browser-use 拿到登录态有两条路：

| 方案                                                                       | 优点                               | 限制                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| A. 普通 `--profile` 让 browser-use 自启 Chrome                             | 简单                               | 同一时刻只能有一个 Chrome 进程占用同一个 user-data-dir，要先关日常 Chrome |
| B. 自己用 `--remote-debugging-port` 启动 Chrome，browser-use 通过 CDP 接管 | 不会再开新实例，登录态完整、可复现 | 启动一次需要先关掉日常 Chrome                                             |

**推荐方案 B**，下文按方案 B 展开。

## 3. macOS 上启动调试端口 Chrome 的"硬坑"

直接复制粘贴下面这套命令即可，**所有坑这条流水线都已经踩过**。

### 3.1 关掉当前 Chrome

直接 `pkill` 即可（注意会丢失未保存内容，需先关闭重要 tab）：

```bash
pkill -9 -f "Google Chrome.app"
sleep 2
pgrep -f "Google Chrome.app" | head -3   # 应无输出
```

⚠️ `osascript -e 'tell application "Google Chrome" to quit'` 在某些权限模式下会
报 `-10004 权限违例`；`pkill` 更稳。

### 3.2 不能用默认 user-data-dir

Chrome 自 2024 起拒绝把 `--remote-debugging-port` 与默认 user-data-dir 同用，
启动会直接报：

```
DevTools remote debugging requires a non-default data directory.
Specify this using --user-data-dir.
```

### 3.3 不要把 user-data-dir 放到 `~/Library/Application Support/`

放在 `Application Support/` 下（包括它的任意子目录）会撞 macOS TCC 文件保护，
报 `Operation not permitted`、Singleton 创建失败、Chrome 启动到一半 abort：

```
Failed to unlink .../SingletonLock: Operation not permitted
Failed to create a ProcessSingleton for your profile directory.
```

**结论：把 user-data-dir 放到家目录直接子目录**，例如 `~/chrome-debug`。

### 3.4 复制现有 Chrome 数据到调试目录（保留登录态）

不要全量复制（默认 6+ GB）。用 rsync 排除缓存类目录，通常压到 2~3 GB：

```bash
DEST="$HOME/chrome-debug"
mkdir -p "$DEST"
rsync -a \
  --exclude='Cache/' \
  --exclude='Code Cache/' \
  --exclude='GPUCache/' \
  --exclude='Service Worker/CacheStorage/' \
  --exclude='Service Worker/ScriptCache/' \
  --exclude='ShaderCache/' \
  --exclude='GrShaderCache/' \
  --exclude='component_crx_cache/' \
  --exclude='File System/' \
  --exclude='*/Cache/' \
  --exclude='*/Code Cache/' \
  --exclude='*.log' \
  --exclude='Singleton*' \
  "$HOME/Library/Application Support/Google/Chrome/" "$DEST/"
du -sh "$DEST"
```

⚠️ macOS 自带 rsync 是老版本（2.6.9），**不支持 `--info=progress2`**，加了会直接报错。
要进度条就用 `rsync -avh --progress`，或装 `brew install rsync` 切到新版。

### 3.5 用真正的二进制路径启动（不要 `open -na`）

```bash
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug" \
  --no-first-run --no-default-browser-check \
  >/tmp/chrome-debug.log 2>&1 & disown
```

⚠️ **不要用** `open -na "Google Chrome" --args ...`：macOS LaunchService 在多数
Chrome 版本下会**吞掉 `--args` 后的参数**，结果是启动了一个普通 Chrome，
9222 根本不监听，但 `pgrep` 又能看到进程，非常迷惑。

### 3.6 验证

```bash
sleep 2
lsof -nP -iTCP:9222 -sTCP:LISTEN     # 应有一行 LISTEN
curl -s http://localhost:9222/json/version
```

`json/version` 返回 `Browser` / `webSocketDebuggerUrl` 即成功。

### 3.7 之后的复用（一行启动）

副本数据已经存在，下次直接：

```bash
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-debug" \
  --no-first-run --no-default-browser-check \
  >/tmp/chrome-debug.log 2>&1 & disown
```

## 4. 用 browser-use CLI 接管已启动的 Chrome

```bash
browser-use --cdp-url http://localhost:9222 connect
# status: connected
# cdp_url: ws://localhost:9222/devtools/browser/...

browser-use --cdp-url http://localhost:9222 open "<URL>"
browser-use --cdp-url http://localhost:9222 state    # 验证页面已加载
browser-use --cdp-url http://localhost:9222 screenshot .figma-to-product/work/figma-<node-id>/product/screenshot.png
```

> 第一次开启会自动创建 default session。后续每次调用必须**带上同一个 `--cdp-url`**，
> 否则会报 `Session 'default' is already running with different config`。

## 5. 常见报错 → 解决

| 报错 / 现象                                                                                  | 根因                                                | 处理                                                               |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `DevTools remote debugging requires a non-default data directory`                            | 用了 `~/Library/Application Support/Google/Chrome`  | 改用 `~/chrome-debug` 或其它非默认目录                             |
| `Failed to create a ProcessSingleton for your profile directory` + `Operation not permitted` | user-data-dir 在 `Application Support/` 下被 TCC 拦 | 把目录搬到 `~/chrome-debug`                                        |
| Chrome 起来了但 `lsof -i :9222` 没监听                                                       | 用了 `open -na ... --args`，参数被吞                | 直接调 `Google Chrome.app/Contents/MacOS/Google Chrome`            |
| `Session 'default' is already running with different config. Run browser-use close first.`   | 上次 CLI 调用与当前 `--cdp-url` 配置不一致          | 后续调用必须**始终带相同的 `--cdp-url`**；或先 `browser-use close` |
| `browser-use sessions` 抛 `Operation not permitted: ~/.browser-use/default.state.json`       | macOS TCC 保护了状态文件，CLI session 机制不可用    | **改用兜底方案**：CDP 直连截图（见 §6）                            |
| `osascript ... -10004 权限违例`                                                              | macOS 权限提示                                      | 改用 `pkill -9 -f "Google Chrome.app"`                             |
| `rsync: --info=progress2: unknown option`                                                    | 自带 rsync 太老                                     | 去掉该参数；要进度条用 `-avh --progress` 或装新版 rsync            |

## 6. CLI 失效时的兜底：CDP 直接截图

只要 Chrome 调试端口已起来，下面这条命令一定能拿到图（绕过 browser-use CLI 的 session 机制）：

```bash
uvx --with httpx --with websockets python \
  .trae/skills/figma-to-product/scripts/cdp_screenshot.py \
  "<URL 子串，唯一定位某个 tab>" \
  "<保存路径>"
```

例如：

```bash
uvx --with httpx --with websockets python \
  .trae/skills/figma-to-product/scripts/cdp_screenshot.py \
  "rmp.bytedance.net/punishment_report" \
  ".figma-to-product/work/figma-<node-id>/product/screenshot.png"
```

脚本逻辑：

1. `GET http://localhost:9222/json` 列出所有 tab。
2. 选第一个 `type=page` 且 URL 包含给定子串的 tab。
3. 通过该 tab 的 `webSocketDebuggerUrl` 发送 `Page.captureScreenshot`，
   `captureBeyondViewport=true` 即整页截图。
4. 写入 `<保存路径>`，路径不存在会自动创建父目录。

脚本源码见 [scripts/cdp_screenshot.py](../scripts/cdp_screenshot.py)。

### 6.1 完整截图流程（实战版）

`cdp_screenshot.py` 只负责"对已存在的 tab 截图"。要从一个 URL 拿到一张稳定的清晰图，
完整流程分四步，**全部走 CDP HTTP/WebSocket，不依赖 browser-use CLI**：

#### Step 1：确认调试端口在线

```bash
curl -s http://localhost:9222/json/version -o /dev/null -w "%{http_code}\n"
# 期望: 200
```

非 200 就回到 §3 重启调试 Chrome。

#### Step 2：在已运行的 Chrome 中**新开一个 tab** 到目标 URL

```bash
curl -s -X PUT "http://localhost:9222/json/new?<完整 URL>" -o /dev/null -w "%{http_code}\n"
# 期望: 200
```

⚠️ 关键点：

- **必须用 `PUT`**：老版 Chrome 用 `GET`，新版（M127+）只接受 `PUT`，`GET` 会返回 405。
- URL **直接拼在 `?` 后面**，不要 URL-encode 整段；Chrome 会按"`?` 之后到结尾"原样作为目标地址。
- 这种方式会**复用当前调试 Chrome 的 cookie/登录态**，不需要再登录。
- 如果 URL 已经在某个 tab 打开过，**也建议重新 PUT**，会把它前置成新 tab，避免 `cdp_screenshot.py`
  按子串匹配时命中一个旧的、被滚动到中间状态的 tab。

#### Step 3：等待页面稳定后截图

```bash
sleep 15   # 业务页面普遍 10~20s；带 ECharts/SQL 编辑器/大表格的页面给 20~30s
uvx --with httpx --with websockets python \
  .trae/skills/figma-to-product/scripts/cdp_screenshot.py \
  "<URL 子串>" "<保存路径>"
```

`<URL 子串>` 只要能在所有 tab 中**唯一定位**目标 tab 即可，不必给完整 URL。
推荐用路径里最具体的一段，例如 `rmp-boe.bytedance.net/rule_library`、
`data.bytedance.net/dorado/development/node/123130962`。

#### Step 4：用"体积稳定"判定是否还在 loading

骨架屏、loading 占位、大图懒加载会让 PNG 体积持续变化。**至少截两次**，间隔 5s，
比对文件大小：

```bash
# 第一次
uvx --with httpx --with websockets python \
  .trae/skills/figma-to-product/scripts/cdp_screenshot.py "<子串>" "<路径>"
ls -lh <路径>

# 等一会儿再截一次同名文件覆盖
sleep 12
uvx --with httpx --with websockets python \
  .trae/skills/figma-to-product/scripts/cdp_screenshot.py "<子串>" "<路径>"
ls -lh <路径>
```

判定阈值（经验值）：

- **两次体积差 < 1%**：页面已稳定，最终图采用第二次。
- **两次体积仍在大幅变大**（如 600K → 730K）：再 `sleep 20+` 重截，最多 3 轮。
- **3 轮仍在变**：很可能页面有持续的轮询/动画/skeleton placeholder（如 ECharts 缓动），
  改成等待具体 DOM 选择器或人工确认；不要再死等。

#### 一次性整合脚本（可直接复制执行）

```bash
URL="https://rmp-boe.bytedance.net/rule_library?collapsed=1"
SUBSTR="rmp-boe.bytedance.net/rule_library"
OUT=".figma-to-product/work/figma-<node-id>/product/rule_library.png"

# 1) 健康检查
curl -fs http://localhost:9222/json/version >/dev/null \
  || { echo "调试 Chrome 未启动，参考 §3"; exit 1; }

# 2) 开 tab
curl -s -X PUT "http://localhost:9222/json/new?$URL" -o /dev/null

# 3) 等待 + 第一次截图
sleep 15
uvx --with httpx --with websockets python \
  .trae/skills/figma-to-product/scripts/cdp_screenshot.py "$SUBSTR" "$OUT"
SIZE1=$(stat -f%z "$OUT")

# 4) 再等一会儿 + 第二次截图，比对体积
sleep 12
uvx --with httpx --with websockets python \
  .trae/skills/figma-to-product/scripts/cdp_screenshot.py "$SUBSTR" "$OUT"
SIZE2=$(stat -f%z "$OUT")

echo "size: $SIZE1 → $SIZE2"
```

#### 常见踩坑

| 现象                                                    | 原因                                                | 解决                                                                          |
| ------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `cdp_screenshot.py` 报 `找不到 URL 包含 \`xxx\` 的 tab` | 子串没命中、tab 还没创建好                          | 先确认 Step 2 返回 200；再多 `sleep 2` 让 Chrome 把新 tab 注册进 `/json` 列表 |
| 截图全白 / 只看到 loading 转圈                          | Step 3 的 sleep 不够，或页面要登录                  | 加大 sleep；或在调试 Chrome 里先手动登录一次                                  |
| 体积反而变小（如 730K → 510K）                          | 页面进入"已登录后只渲染骨架"或 tab 切换到了别的 URL | 重新 PUT 同一个 URL，再走流程                                                 |
| 多个 tab 都包含子串                                     | 子串太短                                            | 子串改更具体，或先 `curl -s http://localhost:9222/json` 看实际命中            |

## 7. 任务收尾

- 调试用 Chrome 直接关窗口或 `kill <PID>`；副本数据保留以便下次复用。
- 想恢复日常 Chrome：从 Dock/Launchpad 启动即可，它用的是原始 `~/Library/Application Support/Google/Chrome`，与调试副本互不影响。但同一时刻**只能跑一个 Chrome 进程**。
- `~/chrome-debug` 副本里的飞书等登录态会随时间过期；过期后在调试 Chrome 内重新登录一次即可（不影响日常 Chrome）。

## 8. 一句话总结

- **全局**装 `browser-use`：`uv tool install browser-use`。
- **专门**给调试用一份 user-data-dir，放在 `~/chrome-debug`，**不要**放在 `Application Support/`。
- **直接调二进制**启动，不走 `open -na`。
- 一切正常时用 `browser-use --cdp-url ...`；CLI 卡 session 时切到 `scripts/cdp_screenshot.py` 兜底。
