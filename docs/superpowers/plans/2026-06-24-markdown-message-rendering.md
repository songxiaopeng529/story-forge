# Markdown Message Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the assistant main message card as polished, real-time Markdown using Streamdown, replacing the current `whitespace-pre-wrap` plain-text output.

**Architecture:** Renderer-only change in `@story-forge/desktop`. Add `streamdown` + `@streamdown/code`, register Streamdown's `dist` in the Tailwind v3 `content` array, inject a minimal shadcn design-token CSS variable set mapped to the `forge-*` palette, and swap `AssistantMessage` from `useTypewriterText` + pre-wrap to `<Streamdown mode="streaming" plugins={{ code }} isAnimating={smooth}>`.

**Tech Stack:** React 19, Tailwind v3, Vite (electron-vite), Vitest + jsdom, TypeScript strict.

**Design reference:** `docs/superpowers/specs/2026-06-24-markdown-message-rendering-design.md`

**Scope guardrails:**
- Only the assistant main message is Markdown-rendered. User messages, `ReasoningBlock`, and `SummaryBlock` stay plain text this milestone.
- No `settings` theme switcher. No Mermaid/Math/CJK plugins. No dark mode. No Tailwind v4 migration. No IPC / `AgentEvent` / streaming-pipeline changes.

---

## Files

- Modify: `apps/desktop/package.json` to add `streamdown` and `@streamdown/code`.
- Modify: `apps/desktop/tailwind.config.ts` to add Streamdown `dist` paths to `content`.
- Modify: `apps/desktop/src/renderer/styles.css` to inject shadcn design-token CSS variables mapped to `forge-*`.
- Modify: `apps/desktop/src/renderer/components/conversation-timeline.tsx` to render `AssistantMessage` via `Streamdown`.
- Modify (conditional): `apps/desktop/src/renderer/use-typewriter-text.ts` — delete only if no remaining callers.
- Modify (conditional): `apps/desktop/src/renderer/use-typewriter-text.test.ts` — delete with the hook if removed.
- Create: a renderer test (extend `apps/desktop/src/renderer/timeline.test.ts` or add a `conversation-timeline.test.tsx`) for Markdown rendering output.
- Modify: `docs/superpowers/plans/2026-06-24-markdown-message-rendering.md` as tasks complete.

## Task 1: Add Dependencies

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install Streamdown and the code plugin**

Run (from repo root, pnpm per `packageManager`):

```bash
corepack pnpm --filter @story-forge/desktop add streamdown @streamdown/code
```

Use the latest published versions. Do not add `@streamdown/math`, `@streamdown/mermaid`, or `@streamdown/cjk`.

- [ ] **Step 2: Confirm React peer compatibility**

Verify the installed `streamdown` peer range accepts React 19.2.x (desktop uses `react@^19.2.7`). If pnpm reports a peer warning, record it; do not downgrade React.

- [ ] **Step 3: Locate the resolved package path**

Determine where pnpm hoists the packages so Task 2 can use the correct relative path:

```bash
node -e "console.log(require.resolve('streamdown/package.json'))"
```

Expected: a path under the workspace root `node_modules/.pnpm/...` with a `streamdown` entry. Note the `dist` location for the Tailwind `content` glob.

## Task 2: Tailwind v3 + CSS Variables

**Files:**
- Modify: `apps/desktop/tailwind.config.ts`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Register Streamdown dist in Tailwind content**

In `apps/desktop/tailwind.config.ts`, add Streamdown's `dist` JS to `content` so Tailwind generates the utility classes Streamdown emits. Use the relative path verified in Task 1 Step 3 (monorepo paths resolve to the workspace root `node_modules`):

```ts
content: [
  "./index.html",
  "./src/**/*.{ts,tsx}",
  "../../node_modules/streamdown/dist/*.js",
  "../../node_modules/@streamdown/code/dist/*.js",
],
```

Adjust the `../` depth and glob to match the actual resolved location. If the package resolves under `node_modules/.pnpm/`, use the real-path that Tailwind can glob (resolve the symlink target if needed).

- [ ] **Step 2: Inject shadcn design tokens mapped to the forge palette**

In `apps/desktop/src/renderer/styles.css`, after the `@tailwind` directives, add a `:root` block with the minimal token set from the design doc, mapped to the `forge-*` colors:

```css
:root {
  --background: #ffffff;
  --foreground: #1d1d1f;
  --card: #ffffff;
  --card-foreground: #1d1d1f;
  --muted: #f5f5f7;
  --muted-foreground: #6e6e73;
  --border: #d2d2d7;
  --input: #d2d2d7;
  --primary: #1d1d1f;
  --primary-foreground: #ffffff;
  --radius: 0.625rem;
}
```

Only light-mode values are added (the app has no dark mode).

- [ ] **Step 3: Verify the dev build picks up the classes**

Start the app (`corepack pnpm dev`) once Task 3 is in place, or temporarily render a code block, and confirm code-block/table backgrounds and borders are visible (not unstyled). This is finalized in Task 4 manual verification; here just confirm Tailwind compiles without errors after the config change.

## Task 3: Swap AssistantMessage to Streamdown

**Files:**
- Modify: `apps/desktop/src/renderer/components/conversation-timeline.tsx`

- [ ] **Step 1: Replace the AssistantMessage body**

In `conversation-timeline.tsx`, import Streamdown and the code plugin at the top:

```ts
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
```

Rewrite `AssistantMessage` to keep the existing outer card and render content with Streamdown:

```tsx
function AssistantMessage(props: { content: string; smooth: boolean }) {
  return (
    <article className="flex justify-start">
      <div className="max-w-full rounded-xl border border-forge-line bg-white px-3.5 py-3 text-[13px] leading-5 text-forge-ink">
        <Streamdown mode="streaming" plugins={{ code }} isAnimating={props.smooth}>
          {props.content}
        </Streamdown>
      </div>
    </article>
  );
}
```

Remove the `useTypewriterText` call from this component. Do not change the
`AssistantMessage` call site (it already passes `content` and `smooth`).

- [ ] **Step 2: Confirm reasoning/summary/user branches are untouched**

Leave `ReasoningBlock`, `SummaryBlock`, the user-message branch, and `ToolStep`
exactly as they are (they keep `whitespace-pre-wrap`). Only `AssistantMessage`
changes.

- [ ] **Step 3: Resolve the now-possibly-unused typewriter hook**

Grep for remaining `useTypewriterText` usages:

```bash
```

Run a content search for `useTypewriterText` across `apps/desktop/src`. If
`AssistantMessage` was the only caller, delete `use-typewriter-text.ts` and its
test `use-typewriter-text.test.ts`, and remove the now-dead import. If any other
caller exists, keep the hook and only remove the import from
`conversation-timeline.tsx`.

- [ ] **Step 4: Desktop typecheck**

Run: `corepack pnpm --filter @story-forge/desktop typecheck`

Expected: pass. Fix any type issues from Streamdown's prop types (e.g. `children`
must be a string; `props.content` already is).

## Task 4: Tests and Verification

**Files:**
- Modify or Create: a renderer test for Markdown output.

- [ ] **Step 1: Add a Markdown rendering test**

Add a renderer test (jsdom env) that renders `ConversationTimeline` (or
`AssistantMessage` directly) with an assistant item whose content includes a
heading, bold, a fenced code block, and a GFM table. Assert structural output
rather than raw syntax, for example:

- `**bold**` produces a `<strong>` (no literal `**` in the DOM text).
- A fenced block produces a `<pre>`/`<code>`.
- A GFM table produces a `<table>`.

If Shiki async highlighting is flaky under jsdom/Vitest, either assert on the
synchronous pre-highlight structure or mock `@streamdown/code` to a passthrough
code renderer. Do not assert on exact Shiki token markup.

- [ ] **Step 2: Add a streaming-safety test**

Render an assistant item with `streaming: true`, `delivery: "smooth"`, and content
ending in an unterminated code fence (e.g. ```` ```ts\nconst a = ````). Assert the
render does not throw and produces output (the streaming-safe path).

- [ ] **Step 3: Guard user-message plain text**

Assert a user-message item containing `**not bold**` renders the literal text (user
input is not Markdown-processed).

- [ ] **Step 4: Run renderer tests**

Run: `corepack pnpm --filter @story-forge/desktop test -- src/renderer`

Expected: pass, including existing `timeline.test.ts` and `App.test.tsx`.

- [ ] **Step 5: Full desktop test + typecheck**

Run:

```bash
corepack pnpm --filter @story-forge/desktop test
corepack pnpm --filter @story-forge/desktop typecheck
```

Expected: all pass.

- [ ] **Step 6: Manual UI verification**

Start the app (`corepack pnpm dev`). In a session, prompt for a response that
contains headings, bold/italic, a bullet list, a GFM table, inline code, and a
fenced code block in a real language. Verify:

- Markdown renders live as the response streams (no raw `#`/`**`).
- Code blocks are syntax-highlighted with visible background/border.
- Tables and lists are styled and match the surrounding UI.
- No layout overflow inside the assistant card.
- The user bubble, reasoning block, and summary block are unchanged.

## Task 5: Final Verification and Commit

**Files:**
- Modify: files changed by earlier tasks only.

- [ ] **Step 1: Repo-wide typecheck**

Run: `corepack pnpm typecheck`

Expected: pass.

- [ ] **Step 2: Review git status**

Run: `git status --short --branch`

Expected: changes limited to `apps/desktop/package.json`, `pnpm-lock.yaml`,
`apps/desktop/tailwind.config.ts`, `apps/desktop/src/renderer/styles.css`,
`apps/desktop/src/renderer/components/conversation-timeline.tsx`, the new/updated
test, the optional typewriter-hook deletion, and this plan.

- [ ] **Step 3: Commit**

Stage only the intended files and commit:

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/tailwind.config.ts apps/desktop/src/renderer docs/superpowers/plans/2026-06-24-markdown-message-rendering.md docs/superpowers/specs/2026-06-24-markdown-message-rendering-design.md
git commit -m "feat: render assistant messages as markdown"
```

## Self-Review

- Spec coverage: dependency install, Tailwind v3 `content` wiring, CSS-variable
  injection, `AssistantMessage` swap to streaming Markdown, conditional typewriter
  removal, security (rehype-harden default), tests (Markdown output, streaming
  safety, user-text guard), and manual verification are all covered.
- Scope discipline: user/reasoning/summary blocks and the streaming pipeline are
  explicitly untouched; no theming, no extra plugins.
- Risk notes: Tailwind `content` path depth and jsdom/Shiki test behavior are the
  two implementation-time unknowns; both have explicit verification/fallback steps.
