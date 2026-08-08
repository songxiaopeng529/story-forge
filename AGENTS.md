# AGENTS.md

Guidance for AI coding agents working in the StoryForge repository.

## What this project is

StoryForge is a desktop-first coding agent platform built on Electron. It wraps
the [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
npm package — which supplies the core agent loop, LLM provider adapters, tool
execution framework, and session persistence primitives — with a StoryForge
desktop UI, curated built-in tools, automation scheduling, MCP integration, and
workspace guardrails. The repo is a pnpm + Turborepo monorepo: reusable logic
lives in `packages/*`, and the shippable product is the Electron app in
`apps/desktop`.

## Environment

- Package manager: **pnpm 10.11.0** (pinned via `packageManager`). Use `corepack` / `pnpm`, never `npm` or `yarn`.
- Node: **>=22.12.0** (see `engines`). Multiple Node installs on a machine can cause
  PATH conflicts and Corepack signature errors — verify `node -v` is >= 22.12 before running scripts.
- ESM only (`"type": "module"`), TypeScript `strict` with `noUncheckedIndexedAccess`
  and `exactOptionalPropertyTypes` enabled (see `tsconfig.base.json`).

## Commands (run from repo root)

| Task | Command | Notes |
|---|---|---|
| Install | `pnpm install` | |
| Dev (desktop app) | `pnpm dev` | `predev` builds package deps first |
| Build all | `pnpm build` | `turbo run build`, respects `^build` dependency order |
| Test all | `pnpm test` | `turbo run test` → `vitest run` per package |
| Typecheck all | `pnpm typecheck` | `tsc --noEmit` per package |
| Lint all | `pnpm lint` | **`lint` is `tsc --noEmit`** — there is no separate linter |

Per-package: `cd` into the package and run `pnpm test` / `pnpm typecheck`, or use
`pnpm --filter @story-forge/<pkg> <script>`. Always run `pnpm typecheck` and the
relevant `pnpm test` before considering a change complete.

After editing files inside `packages/shared/`, run `pnpm --filter @story-forge/shared build`
before typechecking/testing dependent packages, because `@story-forge/shared` is
consumed via its built `dist/` entry (the other packages use source-level
references through tsup/electron-vite and do not need an explicit build step
during local dev).

## Repository layout

```
packages/
  shared/         @story-forge/shared
                     Cross-cutting TypeScript types, event contracts,
                     settings/model/session/task types, and small shared
                     utility helpers (records, errors, ids, strings, numbers).
                     Has NO Node.js / fs / Electron / zod dependencies — safe
                     to import from any layer including the renderer.

  agent/          @story-forge/agent
                     Adapter/harness layer over @earendil-works/pi-coding-agent.
                     Owns: StoryForgeAgentHarness (the runtime orchestrator —
                     wraps PI's SessionManager and exposes an EventEmitter over
                     StoryForge typed events), PiModelService (provider config
                     + credential encryption), SessionRepository (atomic JSON
                     persistence of session history + metadata), PiSessionAdapter
                     (message/tool-call mapping between PI and StoryForge
                     shapes), PiTodoAdapter, event-mapper, atomic JSON I/O,
                     and StoryForge path resolution (storyforge-home).

  extensions/     @story-forge/extensions
                     Built-in tool implementations and runtime helpers shipped
                     with StoryForge:
                       - web/         web_search (Tavily/SerpAPI), web_fetch,
                                      web URL policy (SSRF guard, public-URL
                                      enforcement)
                       - workspace/   path guard that blocks file tools from
                                      escaping the active workspace root
                       - permissions/ command-policy engine (sentinel | cruise |
                                      unleashed) + shell command parsing
                       - automation/  automation proposal tool + cron schedule
                                      validation + next-run preview
                       - tasks/       todo/task list tool (phases + working-on)
                       - mcp/         MCP stdio client + config parsing
                       - environment/ current_time tool + timezone helpers
                       - todo/        @pi9/todo wrapper for PI's todo UI
                     Exports a unified ToolDefinition type used by both PI and
                     StoryForge surfaces.

apps/
  desktop/        @story-forge/desktop
                     The Electron app. Split into four source roots with a
                     strict layering boundary — see next section.
```

Internal imports use the `@story-forge/*` aliases declared in `tsconfig.base.json`.

**Key package dependency direction (imports flow downward):**

```
apps/desktop/renderer  →  apps/desktop/shared  →  @story-forge/shared
apps/desktop/preload   →  apps/desktop/shared  →  @story-forge/shared
apps/desktop/main      →  @story-forge/agent   →  @story-forge/extensions  →  @story-forge/shared
```

- `packages/shared` must not import from any other workspace package and must
  not depend on Node.js built-ins or Electron.
- `apps/desktop/src/renderer` and `apps/desktop/src/preload` must not import
  from `packages/agent`, `packages/extensions`, or `apps/desktop/src/main` —
  they only share `@story-forge/shared` and the local `src/shared` IPC contract.

## Electron app architecture (apps/desktop)

Four source roots with a strict boundary. Respect this layering:

- `src/shared/story-forge-api.ts` — the **contract**: `StoryForgeApi` TypeScript
  interface + `IPC_CHANNELS` string constants + TypeScript types for every IPC
  request/response. Imports only from `@story-forge/shared`. No Node/Electron
  imports here.
- `src/preload/index.ts` — implements the API as thin `ipcRenderer.invoke(channel, input)`
  forwarders, exposed via `contextBridge` as `window.storyForge`. Must
  `satisfies StoryForgeApi`. No business logic, no direct Node/Electron API
  access beyond `ipcRenderer`/`contextBridge`.
- `src/main/` — the Electron **main process**. Owns:
    - `main.ts`: app lifecycle, window creation
    - `ipc-handlers.ts`: registers `ipcMain.handle` for each channel. **Every
      handler validates its payload with a Zod schema via the `handle()`
      helper**, which throws `Invalid IPC payload` on failure. Handlers delegate
      to services/stores (e.g. `AutomationService`, `AutomationScheduler`,
      `AutomationRepository`, `AppSettingsStore`, `WorkspaceRepository`,
      `McpConfigService`, `ProviderConfigStore` via `PiModelService`,
      `SkillService`, and the `StoryForgeAgentHarness` exposed as
      `AgentCoordinator`).
    - `atomic-json.ts` is **no longer in main** — main imports `readJson` /
      `writeJsonAtomic` / `isNodeError` from `@story-forge/agent`.
    - `env-loader.ts`: credential loading from environment variables.
- `src/renderer/` — React 19 UI (Tailwind + Semi UI), calls `window.storyForge.*`.
  Renderer code must not import Node.js built-ins, Electron, or anything from
  `src/main/` / `packages/agent` / `packages/extensions`.

Adding a renderer→main IPC call means touching all four layers: add the channel
constant + API type in `src/shared`, add the `window.storyForge` method in
`src/preload`, add the Zod-validated handler in `src/main/ipc-handlers.ts`, and
consume it from the renderer.

## Agent runtime (the core)

StoryForge's agent orchestration is `StoryForgeAgentHarness` (re-exported as
`AgentCoordinator`) in `packages/agent/src/storyforge-agent-harness.ts`.

- Construction accepts a `PiModelService`, a `SessionRepository`, workspace
  roots, skill directories, extension paths, and a command policy mode.
- `startSession(sessionId)` → boots the PI `SessionManager` for that session,
  registers built-in StoryForge tools (current_time, web_search/web_fetch,
  MCP tools, file tools guarded by workspace policy, command tools gated by
  `command-policy`, automation.proposeCreate, and the PI todo UI), wires up
  event forwarding through `event-mapper.ts`, and emits typed
  `AgentEvent`s over its `EventEmitter`.
- User turns flow through `submitTurn()` → PI's session runner. PI is
  responsible for the actual LLM call loop, tool dispatch, retry/stop logic,
  and context-window management.
- StoryForge intercepts commands and file tools to enforce workspace path
  guards, command execution policy (sentinel/cruise/unleashed), and
  permission-request flows. It also intercepts automation proposal tool calls
  to round-trip through the UI for confirmation.
- Session state is persisted atomically via `SessionRepository` (JSON files
  under `<storyforge_home>/sessions/<sanitized-id>/`), using
  `writeJsonAtomic` (write-to-tmp + rename) and `readJsonOrQuarantine`
  (rename-corrupt-on-parse-failure) from `packages/agent/src/atomic-json.ts`.
- Model credentials are encrypted at rest by `PiModelService` using Electron's
  `safeStorage` API (when available), stored in `secrets.json` (mode `0600`),
  with a legacy migration path from plaintext env/config files.

There is **no separate in-repo AgentLoop** — the loop lives in
`@earendil-works/pi-coding-agent`. `NativeAgentRuntime`-style abstractions from
older iterations of this repo no longer exist.

## Tools

- A tool is a `ToolDefinition` (`packages/extensions/src/tool-definition.ts`):
  `{ name, description, parameters, execute }`. This same shape is used for
  PI-registered tools, MCP tools, and StoryForge-builtin tools.
- `parameters` is a **raw JSON Schema object** (not Zod). Validate inputs inside
  `execute` by hand (typically via `readStringField` / `readOptionalStringField`
  from `@story-forge/shared`) and `throw new Error(...)` on bad input. Tools
  receive a `context` with `signal: AbortSignal`; honor it for long-running
  work (fetch, commands) so turn cancellation propagates.
- Built-in StoryForge tools are registered by `StoryForgeAgentHarness.registerBuiltinTools()`
  in `storyforge-agent-harness.ts` — add new entries there after creating the
  tool in `packages/extensions/`.
- The `workspace.runCommand` tool is gated by `CommandPolicy`
  (`packages/extensions/src/permissions/command-policy.ts`). Modes:
    - `sentinel`: block everything; require per-command approval (default for untrusted workspaces)
    - `cruise`: block a known-dangerous command list; allow others
    - `unleashed`: allow everything
- File tools (`workspace.readFile/writeFile/replaceText/listDirectory`, and
  grep/find/ls equivalents exposed through PI) are additionally guarded by
  `checkWorkspaceToolCall()` in `packages/extensions/src/workspace/guard.ts` to
  prevent path-traversal outside the active workspace root.
- **Tools ≠ Skills.** Skills are Markdown prompt documents injected as system
  messages (user-invoked via `/` slash commands, resolved from the configured
  skill directories by `SkillService`), not model-callable functions.

## Network & secrets conventions

- No `axios`/`node-fetch`. Use native `globalThis.fetch`, injected as a
  `fetch?: FetchLike` option defaulting to `globalThis.fetch.bind(globalThis)`
  for testability; pass `signal` through for cancellation (see
  `packages/extensions/src/web/web-search-providers.ts` for the canonical pattern).
- Web fetching is routed through the SSRF-aware `assertPublicWebUrl()` guard in
  `packages/extensions/src/web/web-url-policy.ts` — private IPs, link-local,
  and non-HTTP(S) schemes are blocked when doing model-driven fetches.
- API keys are encrypted at rest via Electron `safeStorage` through
  `PiModelService` and stored as `secrets.json` (mode `0600`) under the
  StoryForge home directory. Reuse this for any new credential; never write a
  raw secret into a JSON file in the repo or home directory without encrypting.
- When running outside Electron (tests/CI), `PiModelService` falls back to a
  `LegacyCredentialCrypto` passthrough and can also read credentials from
  environment variables via `readEnvSecret` / `env-loader.ts`.

## Conventions

- All time values transmitted across IPC and stored on disk are **ISO-8601
  strings** (UI-facing timestamps such as `retrievedAt`, `createdAt`) or
  **second-level Unix timestamps** (internal unixTime fields in runtime env).
  The `current_time` tool returns both. Prefer ISO-8601 for new persisted
  fields; use unix seconds only when required by an existing contract.
- ID strings are generated via `createId(prefix)` from `@story-forge/shared`
  and follow the `sf_<prefix>_<base36entropy>` shape (e.g. `sf_turn_abc123`,
  `sf_permission_xyz789`). New IDs should go through this helper.
- Validate at trust boundaries: IPC payloads via Zod schemas in
  `ipc-handlers.ts`, tool inputs via `readStringField`/`readOptionalStringField`
  from `@story-forge/shared`, and file JSON via atomic-json Zod parsing. Trust
  internal calls between packages; do not double-validate.
- For not-yet-shipped features, prefer changing types/IDL directly over
  back-compat shims — this is a pre-1.0 desktop app with no external consumers.
- File writes go through `writeJsonAtomic` (write to `.tmp-<pid>-<ts>`, then
  rename) to avoid corrupting JSON on crash; never `writeFile` directly for
  settings/session/credential files.
- Follow existing file/test naming: co-locate tests as `*.test.ts(x)` next to
  source. Use `// @vitest-environment jsdom` at the top of renderer tests;
  main-process and package tests default to the `node` environment.
- Shared, dependency-free utility helpers belong in `packages/shared/src/utils/`.
  Before adding a new local `function toRecord(...)` / `function formatError(...)`
  etc., check if it already exists there.

## Testing

- Vitest. Desktop tests run under the `node` or `jsdom` environment (see the
  `// @vitest-environment` pragma at the top of each test file and
  `vitest.config.ts`).
- Mock network via the `fetch: FetchLike` injection point on tools — see
  `web-tools.test.ts` for the pattern using a local `executeTool()` helper and
  injected `fetch` stubs. Do not hit real Tavily/SerpAPI from tests.
- File-persisted stores/services should use `tmpdir()` + per-test temp
  directories; see `session-repository.test.ts`, `app-settings-store.test.ts`,
  and `automation-service.test.ts` for the pattern with `afterEach` cleanup.
- Run `pnpm test` (all) or filter to a package; write/extend tests for any
  change to tools, IPC handlers, the agent harness, or stores/repositories.
