# PI Agent（pi-mono / pi-coding-agent）调研报告

> 调研时间：2026-07-05
> 官方地址：https://pi.dev ｜ GitHub：https://github.com/earendil-works/pi
> 作者：Mario Zechner（libGDX 作者，@badlogicgames）
> 许可：开源，npm 包 `@earendil-works/pi-coding-agent`

---

## 一、PI Agent 是什么

Pi（常被社区称为 **Pi Agent**、**Pi Coding Agent** 或 **pi-mono**）是一款由资深游戏/开源工程师 Mario Zechner 用 TypeScript 编写的**极简、终端优先的 AI 编程智能体框架（Coding Agent Harness）**。它的定位不是又一个大而全的 AI IDE（如 Cursor、Claude Code、GitHub Copilot Workspace），而是一把"可自己打磨的厨刀"——**让工具适配你的工作流，而不是反过来**。

它的一句话口号是：

> "There are many coding agents, but this one is mine."
> "Adapt Pi to your workflows, not the other way around."

Pi 同时也是当下热门开源个人 AI 助手 **OpenClaw** 的底层引擎（OpenClaw 将 Pi 作为 agent runtime，上面叠加了 Slack、WhatsApp、iMessage、日程、语音通话等多场景能力）。

---

## 二、核心能力（它能做什么）

### 1. 终端中的 AI 编程助手（CLI / TUI）
- 在终端中以自然语言驱动 AI **读代码、改文件、写文件、执行命令**，全自动完成从"需求描述"到"代码落地"的闭环。
- 自带一套自研 TUI 渲染引擎（`pi-tui`），支持差分渲染、Markdown 渲染、代码高亮、自动补全、状态栏实时显示 token/费用/模型。
- 支持图片粘贴（Ctrl+V / 拖拽）、`@` 文件引用、`!command` 把命令输出直接喂给模型。

### 2. 四大内建工具（默认仅 4 个，极少、极透明）
| 工具 | 用途 |
| --- | --- |
| `read` | 读取文件内容（文本/图片） |
| `write` | 新建/写入文件 |
| `edit` | 精确替换文件内容 |
| `bash` | 执行 shell 命令 |
> 另外可选启用 `grep`/`find`/`ls`，但默认保持最小集。这让 system prompt 极短，**省 token、响应快、行为可预测**。

### 3. 15+ 模型供应商、数百个模型，一键切换
- 支持 Anthropic、OpenAI / Codex、Azure OpenAI、Google Gemini / Antigravity、Mistral、Groq、Cerebras、xAI、OpenRouter、Vercel AI Gateway、Hugging Face、Kimi For Coding、MiniMax、NVIDIA、Bedrock、Ollama 本地模型等。
- 认证方式两种：**API Key**（环境变量 / `~/.pi/agent/auth.json`），或 **OAuth 订阅登录**（Claude Pro/Max、ChatGPT Plus/Pro、GitHub Copilot、Google Gemini CLI）——这是非常有特色的"认证继承"能力，个人订阅账号可直接复用。
- 会话中可随时 `/model`、`Ctrl+L`、`Ctrl+P` 切换/循环模型。

### 4. 树状（Git 式）会话历史与回溯
- 会话以 JSONL 文件存储在 `~/.pi/agent/sessions/`，结构是一棵**对话树**而不是线性列表。
- `/tree` 浏览历史、`/fork` 从任意节点分叉试验、`/resume` 回到任意节点继续。
- `/export` 导出 HTML、`/share` 一键上传到私有 GitHub Gist 获得可分享的 URL。
- 自动上下文压缩（Compaction），且压缩逻辑可通过扩展自定义（如按主题、代码感知、不同总结模型）。

### 5. 可组合的"上下文工程"（Context Engineering）
Pi 把上下文控制权完全交给用户/扩展，这是它区别于 Claude Code/Cursor 的最大工程亮点：
- **AGENTS.md**：项目级指令，启动时自动从当前目录及父目录、`~/.pi/agent/` 加载（兼容 `CLAUDE.md`）。
- **SYSTEM.md** / `APPEND_SYSTEM.md`：替换或追加默认 system prompt。
- **Skills（技能）**：遵循 [agentskills.io](https://agentskills.io) 标准，**按需加载**的 Markdown + 工具能力包，不会撑爆 prompt 缓存。
- **Prompt 模板**：Markdown 形式的可复用提示词，`/模板名` 触发。
- **Dynamic Context**：扩展可以在每轮前注入消息、过滤历史、接入 RAG、实现长期记忆。

### 6. 运行中干预（Steering / Follow-up）
AI 执行过程中可以继续输入：
- `Enter` 发送 **steering 消息**：当前工具跑完立刻打断后续工具，让 AI 先处理你的新指示。
- `Alt+Enter` 排队 **follow-up 消息**：等本轮全部工具跑完再执行。
- 相当于"在智能体干活时随时插话纠偏"，避免一跑错就只能中止重来。

### 7. 自扩展：AI 自己写扩展来扩展自己
这是 Pi 最被社区称道的特性：
- 扩展是 TypeScript 模块，可以新增命令、工具、TUI 组件、模型供应商、自定义压缩策略、自定义权限流程等。
- 你可以**直接在终端里让 Pi 给自己写一个扩展**，保存后 `/reload` 热重载即可使用，无需重启、无需 fork 源码。
- 扩展、技能、模板、主题可打包成 **Pi Package**，通过 npm 或 git 分发。
- 社区已有扩展：`pi-web-ui`（浏览器聊天 UI）、`pi-mom`（Slack Bot）、`@termdraw/pi`（终端绘图）等。

### 8. 四种使用模式
| 模式 | 场景 |
| --- | --- |
| **Interactive** | 完整 TUI，日常交互 |
| **Print / JSON** | `pi -p "提问"` 用于 shell 脚本；`--mode json` 输出事件流，方便接入其他工具 |
| **RPC** | 通过 stdin/stdout 的 JSONL 协议，方便非 Node 语言集成 |
| **SDK** | 作为 npm 包嵌入你自己的 Node.js 应用（OpenClaw 就是这样用的） |

---

## 三、它刻意"不做什么"——这正是它的价值所在

Pi 官网有一个罕见的板块叫 **"What we didn't build"**。作者刻意不内建以下功能，主张需要的人自己或让 Pi 写扩展实现：

- **无 MCP 协议**：认为用 CLI 工具 + README（Skills）就够，需要 MCP 可自己写扩展。
- **无子代理（sub-agents）**：推荐开多个 tmux/终端实例并行，或写扩展。
- **无权限弹窗**：默认 YOLO 模式直接执行，需要沙箱/确认请放到容器里或写扩展。
- **无计划模式（Plan Mode）**：把计划写到文件里就好。
- **无内建 TODO**：用 `TODO.md` 或扩展。
- **无后台 bash**：用 tmux，让一切操作可见可观察。
- **不绑定任何单一模型/厂商**：通过统一 LLM API 自由切换。

这种"少即是多"的设计带来三个直接好处：
1. **System prompt 极短**——token 更省、响应更快、模型行为更稳定可预测。
2. **行为完全透明**——它偷偷注入了什么上下文一目了然，便于做"上下文工程"。
3. **核心不膨胀**——升级不会破坏你已有的工作流。

---

## 四、架构速览（monorepo 分包）

| 包 | 作用 |
| --- | --- |
| `@earendil-works/pi-ai` | 统一 LLM API，封装 20+ 供应商，支持 streaming、tool calling（TypeBox schema）、thinking/reasoning、跨供应商上下文交接、token/费用统计 |
| `@earendil-works/pi-agent-core` | Agent 主循环：工具执行、校验、事件流、状态管理 |
| `@earendil-works/pi-tui` | 自研终端 UI 框架：retained-mode、差分渲染、编辑器、Markdown 渲染 |
| `@earendil-works/pi-coding-agent` | 最终 CLI：把上面三者拼起来，加上会话管理、扩展、主题、AGENTS.md 等 |

---

## 五、典型使用场景（有什么用）

1. **日常终端编程助手**
   比 Claude Code 更轻、更可控，适合习惯命令行、在意 token 与可预测性的开发者。直接在项目根目录 `pi` 启动，描述需求让它改代码、跑测试、修 bug。

2. **多模型自由切换/比价/对比**
   同一任务可以中途切模型（写代码用 Claude、想便宜用 GPT、本地用 Ollama），甚至可以用 Ctrl+P 在收藏模型间循环对比输出。

3. **可分叉的 AI 结对编程"实验台"**
   像 Git 分支一样管理对话：一个方向让它重构，另一个方向让它加新功能，最后 `/tree` 对比结果，选最好的那条分支继续。

4. **构建自己的 AI 助手 / Agent 产品**
   通过 SDK 嵌入或 RPC 接入，Pi 负责统一 LLM 调用、工具循环、会话管理，你在上面叠加业务 UI 和场景能力。**OpenClaw、pi-chat（Slack 机器人）等都建立在它之上**，是当下构建个人 AI 助手的热门骨架。

5. **脚本/CI/自动化中的"一次性 AI 调用"**
   `pi -p "帮我把这个目录下所有 .ts 文件里的 XXX 替换成 YYY 并跑测试"`，写进 shell 脚本、Makefile、git hook 里即可。

6. **自定制工作流**
   让 Pi 帮你写它自己的扩展：自定义 TUI 面板（如 commit/push 向导、代码 review 面板、Q&A 向导）、内部工具、私有模型供应商适配、RAG/长期记忆、自定义权限审批流程等。

7. **本地/自托管模型场景**
   对 Ollama、llama.cpp、vLLM、LM Studio 等本地推理端点做了专门兼容，不依赖 Vercel AI SDK 那种对本地模型 tool calling 支持不佳的抽象，适合隐私敏感、离线开发场景。

8. **会话复盘与分享**
   `/share` 直接生成可公开访问的会话 Gist URL，适合教学、博客、开源协作中"AI 是怎么帮我修这个 bug"的可复现分享。

---

## 六、适合谁 / 不适合谁

**适合：**
- 熟悉终端、熟悉命令行工作流的开发者。
- 对现有 AI IDE（Cursor、Claude Code）功能膨胀、不可控、偷偷注入上下文感到不满的"power user"。
- 想在 Pi 上搭自己的 Agent 产品/个人助手/聊天机器人的开发者（比 OpenCode SDK 轻、比 Vercel AI SDK 完整）。
- 需要在多家模型之间自由切换、或使用本地/自托管模型的人。
- 会一点 TypeScript，愿意自己打磨工具的人——作者原话："Pi is a good chef's knife, not a multi-function food processor."

**不适合：**
- 希望开箱即用、功能越多越好、点点按钮就能完成所有事的用户（这类场景 Cursor / Claude Code 更合适）。
- 不会命令行、也不想学扩展机制的非技术用户。
- 对"默认 YOLO 执行命令、无权限弹窗"这种哲学不放心、且不愿自己做容器/沙箱的人。

---

## 七、快速上手（最小体验路径）

```bash
# 任选一种安装方式
curl -fsSL https://pi.dev/install.sh | sh
# 或
npm  install -g --ignore-scripts @earendil-works/pi-coding-agent
pnpm add -g --ignore-scripts @earendil-works/pi-coding-agent

# 配置 API Key（以 Anthropic 为例）
export ANTHROPIC_API_KEY=sk-...
# 或 /login 使用 OAuth 订阅登录

# 在项目根目录启动
cd your-project
pi
```

常用命令：`/model` 切模型、`/tree` 查看会话树、`/fork` 分叉、`/compact` 压缩上下文、`/reload` 热重载扩展、`/share` 分享会话。

---

## 八、一句话总结

**Pi Agent 不是要做"最强"的 AI 编程工具，而是要做"最能被你自己改造成你想要的样子"的 Agent 骨架。**
它用极简内核 + 可自扩展（甚至让 AI 自己写扩展）+ 完整可控的上下文 + 多模型自由切换 + Git 式会话树，给命令行用户和 Agent 开发者提供了一个干净、轻量、透明、可长期依赖的 coding agent 底座，也是构建下一代个人 AI 助手（如 OpenClaw）的优秀底层引擎。

---

## 参考资料

- 官网：https://pi.dev
- GitHub：https://github.com/earendil-works/pi
- 作者博文：*What I learned building an opinionated and minimal coding agent* — https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- 使用指南（Gist）：https://gist.github.com/graysonchen/23b03af24fa98e69b7d3e532d6378b8e
- 中文解读（知乎）：https://zhuanlan.zhihu.com/p/2028858973692916778
- OpenClaw（基于 Pi 的个人 AI 助手）：https://github.com/OpenClaw/OpenClaw
- Pi 的真正价值是造自己的 agent（视频）：https://www.youtube.com/watch?v=5Y09zGe-w9w
