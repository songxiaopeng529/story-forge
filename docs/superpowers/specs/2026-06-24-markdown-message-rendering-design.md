# Markdown Message Rendering Design

## Goal

Render assistant chat output as polished, real-time Markdown instead of raw
pre-wrapped text. Today the assistant message card prints the model response with
a single `whitespace-pre-wrap` div, so Markdown syntax (`#` headings, `**bold**`,
lists, tables, fenced code blocks) is shown verbatim. The goal is a refined,
readable rendering of assistant messages that:

- Parses GitHub-flavored Markdown (tables, task lists, strikethrough).
- Highlights fenced code blocks.
- Renders **incrementally while streaming** (full real-time Markdown), gracefully
  handling unterminated/half-streamed Markdown blocks.

Theming/skinning (a `settings` option to switch Markdown styles) is explicitly
**out of scope for this milestone**. The renderer is chosen so that theming can be
layered on later without re-architecting.

## Background

The current rendering path:

- `ConversationTimeline` (`apps/desktop/src/renderer/components/conversation-timeline.tsx`)
  renders each `TimelineItem`. The assistant branch delegates to
  `AssistantMessage`, which calls `useTypewriterText(content, smooth)` and prints
  `<div className="whitespace-pre-wrap">{visibleText}</div>`.
- `useTypewriterText` (`apps/desktop/src/renderer/use-typewriter-text.ts`) reveals
  the text character-by-character via `setInterval` when `smooth` is true; when
  false it shows the full text immediately. `smooth` is set by
  `Boolean(item.streaming) && item.delivery === "smooth"` in the timeline item.
- The repository currently has **no Markdown rendering dependency** (no
  `react-markdown`, `marked`, `markdown-it`, `shiki`, `streamdown`, etc.).
- Styling stack: React 19 + **Tailwind v3** (`apps/desktop/tailwind.config.ts`
  uses a `content` array, not the Tailwind v4 `@source` directive) + Semi UI. The
  global stylesheet is `apps/desktop/src/renderer/styles.css` with
  `@tailwind base/components/utilities`. No `@tailwindcss/typography` plugin and no
  shadcn/ui CSS variables are present.

The assistant card style to preserve is the outer wrapper:

```tsx
<article className="flex justify-start">
  <div className="max-w-full rounded-xl border border-forge-line bg-white px-3.5 py-3 text-[13px] leading-5 text-forge-ink">
    {/* content goes here */}
  </div>
</article>
```

## Renderer Research

Three viable approaches were considered for the React ecosystem.

### 1. `react-markdown` + `remark-gfm` + a highlighter

- Component-based rendering, does not use `dangerouslySetInnerHTML` by default, so
  it is XSS-safe. Every node can be replaced with a custom Tailwind/Semi component
  via the `components` prop.
- Needs `remark-gfm` for tables/task lists/strikethrough and a separate highlighter
  (`rehype-pretty-code`/Shiki or `react-syntax-highlighter`/Prism).
- Downside: each streamed token re-parses the whole string (mitigated by memoizing),
  and unterminated fenced blocks flicker while streaming. The streaming-safety work
  would be hand-rolled.

### 2. `streamdown` (Vercel) — chosen

- A drop-in replacement for `react-markdown` purpose-built for **AI streaming**. It
  handles incomplete/unterminated Markdown blocks (unclosed code fences, bold,
  links) gracefully, which is exactly the real-time-streaming requirement.
- Built-in: GFM (tables/task lists/strikethrough), Shiki code highlighting (via the
  `@streamdown/code` plugin), KaTeX math, Mermaid diagrams, CJK-friendly parsing,
  and security hardening (`rehype-harden`). It also ships pre-styled typography, so
  `@tailwindcss/typography`/`prose` is **not** required.
- `mode="streaming"` plus `isAnimating` replaces the hand-written
  `useTypewriterText` while rendering Markdown live.
- Requirements: React >= 19.1.1 (we satisfy it) and Tailwind. For **Tailwind v3**,
  Streamdown's `dist` must be added to the `content` array so its utility classes
  are generated.

### 3. `marked` / `markdown-it`

- Fast, lightweight parsers that emit an HTML string. They require
  `dangerouslySetInnerHTML` plus DOMPurify for safety and are the most awkward to
  style/customize inside React. Not recommended unless raw throughput is the
  priority.

### Decision

Use **streamdown + `@streamdown/code`**. It solves the streaming-flicker problem
out of the box (the largest risk of real-time Markdown) and removes the need for a
pile of remark/rehype plugins and a separate highlighter. `react-markdown` remains
a fallback option with the same styling strategy if Streamdown proves unsuitable.

User-confirmed decisions:

- Renderer: **streamdown**.
- Streaming strategy: **full real-time Markdown** (render Markdown during streaming,
  not only after completion).
- Theming: **rendering only this milestone, no skin switching**.

## Non-Goals

- No `settings` theme/skin selector for Markdown styles in this version. (Streamdown
  supports CSS-variable theming and `shikiTheme`; a future milestone can add a
  `markdownTheme` setting modeled on the existing `responseMode` / `commandExecutionMode`
  pattern.)
- No Mermaid, KaTeX math, or CJK plugins in this version. Only `@streamdown/code`
  for syntax highlighting is installed. (`@streamdown/math`, `@streamdown/mermaid`,
  `@streamdown/cjk` can be added later, each behind its own dependency + Tailwind
  `content` entry.)
- No change to user message rendering. The user request bubble stays plain text
  (`whitespace-pre-wrap`); only the assistant output is Markdown-rendered.
- No change to the streaming/delivery pipeline, IPC, or `AgentEvent` shapes. This is
  a renderer-only change.
- No migration to Tailwind v4.

## Tailwind v3 + CSS Variable Integration

Streamdown's components are authored as Tailwind utility classes and assume a small
set of shadcn/ui design tokens (CSS custom properties). Two integration steps are
required because we are on Tailwind v3 and do not use shadcn/ui:

1. **Generate Streamdown's utility classes.** Add Streamdown's `dist` to the
   `content` array in `apps/desktop/tailwind.config.ts`. Because this is a
   pnpm/Turbo monorepo with hoisted dependencies, the path points at the workspace
   root `node_modules` (e.g. `../../node_modules/streamdown/dist/*.js`, and the same
   for any installed plugin such as `@streamdown/code`). The exact number of `../`
   segments is verified during implementation against where the package actually
   resolves.
2. **Provide the design-token CSS variables.** Streamdown reads `--background`,
   `--foreground`, `--muted`, `--muted-foreground`, `--border`, `--card`,
   `--card-foreground`, `--primary`, `--primary-foreground`, `--radius` (and a few
   related tokens). Without them, code blocks/tables render with missing
   backgrounds/borders. We inject a minimal token set into
   `apps/desktop/src/renderer/styles.css`, mapped to the existing `forge-*` palette
   so Markdown surfaces (code block background, table borders, blockquote rule)
   visually match the current UI.

   Token mapping (light only this milestone; the app has no dark mode yet):

   | Token | Source value | Notes |
   |---|---|---|
   | `--background` | `#ffffff` (`forge-surface`) | message card surface |
   | `--foreground` | `#1d1d1f` (`forge-ink`) | body text |
   | `--card` | `#ffffff` | code block / table surface |
   | `--card-foreground` | `#1d1d1f` | |
   | `--muted` | `#f5f5f7` (`forge-canvas`) | code block background |
   | `--muted-foreground` | `#6e6e73` (`forge-muted`) | captions, inline code |
   | `--border` | `#d2d2d7` (`forge-line`) | table / code borders |
   | `--primary` | `#1d1d1f` (`forge-ink`) | links / accents |
   | `--primary-foreground` | `#ffffff` | |
   | `--radius` | `0.625rem` | matches `rounded-xl` family |

If a plugin's animation CSS (`streamdown/styles.css`) is needed for a caret/word
animation, it is imported once at the renderer entry. The plain real-time render
does not require it.

## Renderer Integration

### AssistantMessage

Replace the body of `AssistantMessage` in
`apps/desktop/src/renderer/components/conversation-timeline.tsx`:

- Remove the `useTypewriterText` call and the `whitespace-pre-wrap` div.
- Render:

  ```tsx
  import { Streamdown } from "streamdown";
  import { code } from "@streamdown/code";

  function AssistantMessage(props: { content: string; smooth: boolean }) {
    return (
      <article className="flex justify-start">
        <div className="max-w-full rounded-xl border border-forge-line bg-white px-3.5 py-3 text-[13px] leading-5 text-forge-ink">
          <Streamdown
            mode="streaming"
            plugins={{ code }}
            isAnimating={props.smooth}
          >
            {props.content}
          </Streamdown>
        </div>
      </article>
    );
  }
  ```

- The `smooth` prop (already derived from `streaming && delivery === "smooth"`) maps
  to Streamdown's `isAnimating` so the streaming indicator only shows for the active,
  smoothly-delivered message. Live (`delivery === "live"`) messages render Markdown
  as content arrives without the typewriter behavior, which matches the previous
  `useTypewriterText(text, false)` semantics (full content shown immediately,
  now Markdown-formatted).

### Typewriter hook

`useTypewriterText` becomes unused by the assistant path. Search for any other
callers before removing it; if it is only used by `AssistantMessage`, delete the
hook and its test. If it has other consumers, leave it in place. (This is decided
during implementation by a usage grep, not assumed here.)

### Reasoning and summary blocks

`ReasoningBlock` and `SummaryBlock` also use `whitespace-pre-wrap`. Whether to
Markdown-render them is an open product choice:

- **Default for this milestone:** leave them as plain `whitespace-pre-wrap`. They
  are secondary, collapsible blocks and rendering them as Markdown is not required by
  the request ("主消息卡片" = the main assistant message card).
- If desired, they can reuse the same `Streamdown` with `mode="static"` (no
  streaming) in a follow-up. This is noted but not implemented here.

### User message

Unchanged. The user bubble in `TimelineItemView` keeps `whitespace-pre-wrap` and the
image-attachment grid.

## Security

Streamdown renders through `rehype-harden`, filtering raw HTML and sanitizing URLs
by default, so assistant-authored content cannot inject script or dangerous markup.
This is at least as safe as the current plain-text rendering and avoids the
`dangerouslySetInnerHTML` risk that the `marked`/`markdown-it` approach would carry.
No additional sanitization layer is added. Link-safety prompts (Streamdown's default
`linkSafety`) are left at their default.

## Performance

- Streamdown memoizes its rendering internally, so we do **not** wrap
  `AssistantMessage` in additional memoization or keep the `MemoizedReactMarkdown`
  pattern.
- During streaming, content updates arrive as growing strings (same as today).
  Streamdown is built for exactly this token-by-token growth; the previous
  per-character `setInterval` is removed, reducing render churn.
- Shiki (via `@streamdown/code`) lazy-loads grammars; only languages that appear in
  code fences are tokenized.

## Testing

Markdown rendering is a presentational, third-party-driven change, so testing focuses
on integration boundaries rather than re-testing Streamdown internals.

### Renderer (`apps/desktop`)

- `conversation-timeline` renders an assistant message containing Markdown
  (heading + bold + a fenced code block + a table) and asserts the structural output
  (e.g. a `<pre>`/`<code>` for the fence, a `<table>` for the table, a `<strong>` for
  bold) rather than raw `**` characters.
- A streaming assistant message (`streaming: true`, `delivery: "smooth"`) renders
  without throwing on a half-open code fence (e.g. content ending in
  ```` ```ts\nconst a = ````), proving the streaming-safe path.
- A `live`-delivery assistant message renders its full Markdown immediately.
- The user message bubble still renders as plain text (no Markdown processing),
  guarding against accidentally Markdown-rendering user input.
- Existing `timeline.test.ts` item-construction tests remain green (no change to
  `TimelineItem` shapes).

### Test environment note

Streamdown + Shiki run under the jsdom test environment used by renderer tests. If
Shiki's async highlight or ESM transform causes issues under Vitest/jsdom, the test
either (a) asserts on the pre-highlight structure that Streamdown emits synchronously,
or (b) mocks `@streamdown/code` to a passthrough code block. The implementation plan
verifies which is needed; tests must not depend on exact Shiki token markup.

## Rollout Plan

A single pass is sufficient because this is renderer-only and additive.

1. Add dependencies (`streamdown`, `@streamdown/code`) to `@story-forge/desktop`.
2. Wire Tailwind `content` + inject CSS variables in `styles.css`.
3. Swap `AssistantMessage` to `Streamdown`; remove `useTypewriterText` if now unused.
4. Add/adjust renderer tests; run desktop typecheck + tests; manually verify
   streaming, code blocks, tables, and lists in the running app.

## Open Decisions Resolved

- Renderer: **streamdown** (with `@streamdown/code`); `react-markdown` is the
  documented fallback.
- Streaming: **full real-time Markdown** via `mode="streaming"` + `isAnimating`.
- Theming: **out of scope** this milestone; CSS-variable mapping is added so a future
  `markdownTheme` setting can be layered on.
- Tailwind: stay on **v3**; register Streamdown's `dist` in the `content` array.
- CSS tokens: inject a **minimal shadcn token set mapped to the `forge-*` palette**.
- Scope: only the **assistant main message** is Markdown-rendered; user messages,
  reasoning, and summary blocks stay plain text this milestone.
- No Mermaid/Math/CJK plugins, no dark mode, no `streamdown/styles.css` animation
  import unless a caret animation is later requested.
