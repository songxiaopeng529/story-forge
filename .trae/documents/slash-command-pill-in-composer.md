# 输入框 Slash 命令胶囊化改进方案

## Summary（目标）

当前用户在输入框输入 `/slash` 命令、按回车/点击确认后，输入框没有可见反馈（内置命令甚至被主动清空），体验不符合主流 Coding Agent。目标是：**确认 slash 命令后，在输入框内以一个带矩形圆角背景、可撤销的「命令胶囊(pill)」呈现该命令**，textarea 继续用于输入命令的自然语言参数。

已与用户确认的三项决策：
- **形态**：方案 A —— 胶囊置于现有输入框容器内、textarea 上方，不引入 contenteditable/富文本编辑器。
- **范围**：仅 **模式类（`/plan`）+ skill 类** 命令确认后在输入框留胶囊；导航/即时动作类（`/models`、`/skills`、`/settings`、`/timer`、`/compact`）保持现状（执行完即走，不留胶囊）。
- **参数**：胶囊 + textarea 参数 —— 胶囊只代表命令本身，textarea 继续输入后续自然语言参数，发送时合并。

## Current State Analysis（现状分析，基于实际探索）

### 组件层级与数据流
- 输入框在 [agent-workspace.tsx](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/components/agent-workspace.tsx)，是原生 `<textarea>`（line 602-617），`value={props.prompt}`，受控于上层。
- 数据流：`App.tsx` 持有 `prompt`/`composerMode` state → 经 [agent-layout.tsx](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/components/agent-layout.tsx)（中转层，line 159-199 透传）→ `AgentWorkspace`。
- 发送：`App.sendPrompt()`（[App.tsx](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/App.tsx#L309-L352)）读取 `prompt` 与 `composerMode`，调用 `window.storyForge.turns.start({ prompt, mode })`。发送后 `setPrompt("")` + `setComposerMode("normal")`。

### slash 命令现有行为（[selectSlashCommand](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/components/agent-workspace.tsx#L335-L356)）
- `builtin` 命令：调用 `command.action?.()`，每个 action 内先 `props.onPromptChange("")` 清空输入。
  - `/plan`：`onPromptChange("")` + `onComposerModeChange("plan")`。
  - `/timer`/`/compact`/`/models`/`/skills`/`/settings`：`onPromptChange("")` + 打开面板或触发即时动作。
- `skill` 命令：往 textarea 插入 `"/xxx "` 文本，等用户补参数后发送。

### 后端 slash 解析（关键约束）
- [parseSlashInvocation](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/agent-coordinator.ts#L581-L593)：prompt 以 `/` 开头时，切出 `command` 和 `argumentsText`。
- [resolveSkillInvocation](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/main/agent-coordinator.ts#L481-L509)：若 prompt 是 slash 调用，会去 `skillResolver.resolveInvocation(command)`；**找不到对应 skill 会抛 `Skill not found: <command>`**。
- **因此**：`/plan` **绝不能**作为 `/plan` 前缀拼进最终 prompt（后端会当未知 skill 报错）。`/plan` 只应通过 `mode: "plan"` 传递，prompt 仅含 textarea 自然语言内容。**skill 命令则相反**，必须把 `/xxx` 前缀拼回 prompt 后端才能解析。两类合并逻辑不同。

### 受影响的现有测试（[App.test.tsx](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/__test__/App.test.tsx)）
- line 156-192「offers enabled skills…inserts the selected invocation」：断言选中 skill 后 `input` 值为 `/agent-browser `。胶囊化后 skill 不再插入 textarea，此断言需改为断言胶囊出现、input 为空。
- line 208-229「starts a plan mode turn」：选 `/plan` 后 input 为空、显示 "Plan"，输入文本回车后 `start` 以 `prompt: "Investigate the runtime", mode: "plan"` 调用。语义与新方案一致，主要新增胶囊断言，核心断言保留。
- line 194-206「runs built-in slash commands」（`/timer`）、line 231-253（`/compact`）：导航/即时类不变，无需改。

## Proposed Changes（具体改动）

### 改动 1：`agent-workspace.tsx` 新增命令胶囊状态与类型

**What/Why**：引入本地状态表示「已激活的、需在输入框留胶囊的命令」。仅模式类/skill 类会 set 它。

**How**：
- 新增类型：
  ```ts
  type ActiveSlashCommand = {
    invocation: `/${string}`;
    title: string;
    icon: ReactNode;
    kind: "mode" | "skill"; // mode=仅设 composerMode 不入 prompt；skill=前缀入 prompt
  };
  ```
- 新增 state：`const [activeSlashCommand, setActiveSlashCommand] = useState<ActiveSlashCommand>();`
- 在 session 切换的 `useEffect`（line 119-123）中，连同 `setSlashRange(undefined)` 一起 `setActiveSlashCommand(undefined)`，避免跨会话残留。

### 改动 2：`selectSlashCommand` 分流处理

**What/Why**：让 `/plan` 与 skill 命令走「留胶囊」路径，其余保持原状。

**How**（改 [selectSlashCommand](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/components/agent-workspace.tsx#L335-L356)）：
- `/plan` 命令的 `action`（line 161-164）：改为不再直接执行，而是在 `selectSlashCommand` 中识别为 mode 类 → `setActiveSlashCommand({ invocation:"/plan", title:"Plan mode", icon, kind:"mode" })` + `onComposerModeChange("plan")` + `onPromptChange("")`（清空 textarea，移除已输入的 `/plan` 触发文本）。
- skill 命令（`kind === "skill"`）：不再插入 `"/xxx "` 文本，改为 `setActiveSlashCommand({ invocation: command.invocation, title: command.title, icon: command.icon, kind:"skill" })` + `onPromptChange("")`（清空触发文本）+ 聚焦 textarea。
- 导航/即时类 builtin（`/timer`、`/compact`、`/models`、`/skills`、`/settings`）：保持 `command.action?.()` 原逻辑不变。
  - 实现方式：给 `SlashCommandItem` 增加可选标记，或在 `selectSlashCommand` 内用 `command.id === "plan"` / `command.kind === "skill"` 判定。倾向用显式标记：给 builtin 命令项加 `pill?: boolean`（仅 `/plan` 为 true），保持判定清晰、避免字符串魔法。

### 改动 3：渲染命令胶囊（textarea 上方，输入框容器内）

**What/Why**：在包裹 textarea 的圆角边框盒子（[line 546](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/components/agent-workspace.tsx#L546) `rounded-2xl border`）内、`relative` 容器内 textarea 之前，渲染胶囊行。

**How**：
- 当 `activeSlashCommand` 存在时，渲染一行：
  ```tsx
  <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
    <span className="inline-flex items-center gap-1.5 rounded-md border border-forge-line bg-forge-canvas px-2 py-1 text-[12px] font-medium text-forge-ink" data-testid="active-slash-command">
      <span className="flex h-4 w-4 items-center justify-center text-forge-muted">{activeSlashCommand.icon}</span>
      <span className="font-mono font-semibold">{activeSlashCommand.invocation}</span>
      <button aria-label={`Remove ${activeSlashCommand.invocation} command`} onClick={clearActiveSlashCommand} type="button" className="ml-0.5 text-forge-muted hover:text-forge-ink">
        <X size={12} />
      </button>
    </span>
  </div>
  ```
- 胶囊存在时 textarea 的 `placeholder` 改为提示补充参数（如 `` `为 ${activeSlashCommand.invocation} 补充说明…` ``），否则保持原占位符。
- `clearActiveSlashCommand()`：`setActiveSlashCommand(undefined)`；若被清的是 `kind:"mode"` 的 `/plan`，同时 `onComposerModeChange("normal")`。

### 改动 4：撤销交互（空 textarea 上 Backspace）

**What/Why**：符合主流交互——当 textarea 为空且存在胶囊时，按 Backspace 删除胶囊。

**How**：在 `handlePromptKeyDown`（line ~293）slash 菜单未打开的分支中，若 `event.key === "Backspace" && props.prompt === "" && activeSlashCommand`，则 `event.preventDefault()` + `clearActiveSlashCommand()` 并 return。

### 改动 5：发送时合并胶囊与 textarea 文本

**What/Why**：把胶囊语义正确注入发送流程，且区分 mode 类 vs skill 类（见后端约束）。

**How**（核心，最小改动地对接现有 `props.onSend`）：
- 现状：`props.onSend` 直接触发 `App.sendPrompt`，读 `props.prompt` 与 `composerMode`。
- `/plan`（mode 类）：胶囊已通过 `onComposerModeChange("plan")` 设置了 `composerMode`，`sendPrompt` 已会带 `mode:"plan"`，prompt 就是 textarea 文本——**无需额外合并**。发送后 `App.sendPrompt` 里 `setComposerMode("normal")`；AgentWorkspace 需在发送后 `clearActiveSlashCommand()`（见下）。
- skill 类：需要把 `/xxx ` 前缀拼到 prompt 前再发送。做法：在 AgentWorkspace 内包一层发送处理 `handleSend()`：
  ```ts
  function handleSend() {
    if (activeSlashCommand?.kind === "skill") {
      const merged = `${activeSlashCommand.invocation} ${props.prompt}`.trimEnd();
      // 先把合并串写回受控 prompt，再在下一 tick 触发发送
      pendingSendRef.current = true;
      props.onPromptChange(merged);
    } else {
      props.onSend();
    }
  }
  ```
  用一个 `useEffect` 监听 `props.prompt`，当 `pendingSendRef.current` 为真时清标记并调用 `props.onSend()`，确保受控值已更新后再发送。发送后 `setActiveSlashCommand(undefined)`。
  - **替代（更简单、更稳）方案**：新增可选回调 `onSubmitPrompt?(text: string)`，由 AgentWorkspace 直接把合并后的完整字符串交给 App，App 用它覆盖 `sendPrompt` 的取值来源。但这会改动 App/agent-layout 的 props 链。**优先采用上面「写回受控值 + pending ref」的方案**，避免跨三层改 props；若时序在测试中不稳，再退化为 `onSubmitPrompt`。
- 发送成功/失败后清空胶囊：因 `props.prompt` 在发送后被 `App` 置空，可用一个 `useEffect`：当 `props.prompt === ""` 且非 pending 且此前有输入时，若 `activeSlashCommand` 存在则清空。更稳妥：在 `handleSend` 成功路径后直接 `setActiveSlashCommand(undefined)`（mode 类在调用 `props.onSend()` 后立即清；skill 类在 pending 发送触发后清）。

- 发送按钮 `disabled` 条件（line 692）与回车发送条件需考虑：**存在胶囊但 textarea 为空时应允许发送**（如 skill 无参数、或 `/plan` 无补充）。将 `disabled` 从 `!props.prompt.trim() && images===0` 调整为 `!props.prompt.trim() && images===0 && !activeSlashCommand`。回车路径同理（`handlePromptKeyDown` 里放行）。
  - 注意：skill 无参数时合并串是 `/xxx`，后端可解析（argumentsText 为空）；`/plan` 无参数时 prompt 为空但带 `mode:"plan"`，需确认 `App.sendPrompt` 的空 prompt 拦截（line 312 `if (!content && attachments.length===0) return`）——**`/plan` 无补充文本时不应发送空 turn**。因此对 `/plan`：若 textarea 为空则发送按钮/回车不触发（保持 disabled），即 `/plan` 必须有补充文本才发送。仅 skill 类允许空参数发送。据此细化 disabled 条件：`activeSlashCommand?.kind === "skill"` 才在空文本时放行。

### 改动 6：调整受影响的现有测试

**What/Why**：胶囊化改变了 skill 选择后的 DOM 反馈，需同步测试。

**How**（[App.test.tsx](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/__test__/App.test.tsx)）：
- line 156-192 skill 测试：把 `expect(input).toHaveValue("/agent-browser ")` 改为断言胶囊出现（`screen.getByTestId("active-slash-command")` 含 `/agent-browser`）且 `input` 为空。可再补：输入参数文本回车后，`fixture.start` 以 `prompt: "/agent-browser <参数>"` 调用。
- line 208-229 plan 测试：新增断言胶囊出现（`active-slash-command` 含 `/plan`）；保留 "Plan" chip 与 `start` 调用断言（`prompt: "Investigate the runtime", mode: "plan"`）。
- `/timer`、`/compact` 测试不变。

### 改动 7（新增测试）

- 新增：选中 `/plan` 后按 `✕` 或空框 Backspace，胶囊消失且 mode 复位（可断言底部 chip 从 "Plan" 回 "Agent"）。
- 新增：skill 胶囊存在、textarea 为空时可直接回车发送 `prompt: "/agent-browser"`。

## Assumptions & Decisions（假设与决策）

- `/plan` 归为「mode 类」：不入 prompt，仅设 `composerMode`；必须有补充文本才发送（避免空 turn）。
- skill 归为「skill 类」：`/xxx` 前缀入 prompt，允许无参数发送。
- 导航/即时类（`/timer`/`/compact`/`/models`/`/skills`/`/settings`）行为完全不变，不留胶囊。
- 不引入 contenteditable；不改后端解析、IPC、事件、`TurnMode`。
- 胶囊状态放在 `AgentWorkspace` 本地（与 `slashRange`/`slashSkills` 同层），不上提到 App，避免跨三层改 props；发送合并优先用「写回受控 prompt + pending ref」实现，退化选项为新增 `onSubmitPrompt`。
- 同一时刻仅一个激活胶囊（不支持多命令叠加），符合当前单命令交互。

## Verification（验证步骤）

1. `corepack pnpm --filter @story-forge/desktop typecheck` 通过。
2. `corepack pnpm --filter @story-forge/desktop test -- src/renderer/__test__/App.test.tsx` 通过（含改动/新增用例）。
3. `corepack pnpm --filter @story-forge/desktop test` 全量通过。
4. 手动（Electron 窗口）验证：
   - 输入 `/plan` 回车 → 输入框出现 `/plan` 胶囊、底部 chip 变 "Plan"、textarea 清空并聚焦；输入补充文本回车 → 以 plan 模式发起、胶囊消失、chip 回 "Agent"。
   - 输入 `/`+skill 名回车 → 出现该 skill 胶囊；补充参数回车 → 以 `/xxx 参数` 发送；空参数直接回车 → 以 `/xxx` 发送；均无 `Skill not found` 报错。
   - 胶囊上按 `✕` 或空框 Backspace → 胶囊消失（`/plan` 同时复位 mode）。
   - `/timer`、`/compact`、`/models`、`/skills`、`/settings` 行为不变、不留胶囊。

## 影响文件清单

- 修改：[apps/desktop/src/renderer/components/agent-workspace.tsx](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/components/agent-workspace.tsx)（状态、类型、selectSlashCommand、胶囊渲染、Backspace、发送合并、disabled 条件）。
- 修改：[apps/desktop/src/renderer/__test__/App.test.tsx](file:///Users/bytedance/Desktop/code/story-forge/apps/desktop/src/renderer/__test__/App.test.tsx)（调整 skill/plan 用例 + 新增撤销/空参数用例）。
- 预计**无需**改 `App.tsx` / `agent-layout.tsx`（采用受控 prompt 写回方案时）；若退化为 `onSubmitPrompt` 才需在这两层加透传。
