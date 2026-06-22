# AGENTS.md

Guidance for AI coding agents working in the StoryForge repository.

## What this project is

StoryForge is a desktop-first coding agent platform built around a self-authored
native Agent Runtime. It is a pnpm + Turborepo monorepo: shared logic lives in
`packages/*`, and the shippable product is the Electron app in `apps/desktop`.

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
| Dev (desktop app) | `pnpm dev` | `predev` builds desktop deps first |
| Build all | `pnpm build` | `turbo run build`, respects `^build` order |
| Test all | `pnpm test` | `turbo run test` → `vitest run` per package |
| Typecheck all | `pnpm typecheck` | `tsc --noEmit` per package |
| Lint all | `pnpm lint` | **`lint` is just `tsc --noEmit`** — there is no separate linter |

Per-package: `cd` into the package and run `pnpm test` / `pnpm typecheck`, or use
`pnpm --filter @story-forge/<pkg> <script>`. Always run `pnpm typecheck` and the
relevant `pnpm test` before considering a change complete.

## Repository layout

```
packages/
  shared/         @story-forge/shared        Typed runtime events, settings types
  model-gateway/  @story-forge/model-gateway Provider contracts + OpenAI-compatible & Anthropic providers
  tools/          @story-forge/tools         ToolRegistry, workspace sandbox, built-in tools
  memory/         @story-forge/memory        Memory store contract
  skills/         @story-forge/skills        Skill manifest parser
  mcp/            @story-forge/mcp           MCP package boundary (not wired into runtime registry)
  agent-core/     @story-forge/agent-core    AgentLoop + native runtime
apps/
  desktop/        @story-forge/desktop       Electron app (main / preload / renderer)
```

Internal imports use the `@story-forge/*` aliases declared in `tsconfig.base.json`.

## Electron app architecture (apps/desktop)

Three processes with a strict boundary. Respect this layering:

- `src/shared/story-forge-api.ts` — the **contract**: `StoryForgeApi` type + `IPC_CHANNELS` string constants.
- `src/preload/index.ts` — implements the API as thin `ipcRenderer.invoke(channel, input)` forwarders, exposed via `contextBridge` as `window.storyForge`. Must `satisfies StoryForgeApi`.
- `src/main/ipc-handlers.ts` — registers `ipcMain.handle` for each channel. **Every handler validates its payload with a Zod schema via the `handle()` helper**, which throws `Invalid IPC payload` on failure. Handlers delegate to services/stores (e.g. `AgentCoordinator`, `*Store`, `*Service`, `*Repository`).
- `src/renderer/` — React 19 UI (Semi UI / Tailwind), calls `window.storyForge.*`.

Adding a renderer→main call means touching all three: add the channel constant +
API type in `shared`, the forwarder in `preload`, and the Zod-validated handler in `main`.

## Agent runtime (the core)

- `AgentCoordinator` (`apps/desktop/src/main/agent-coordinator.ts`) is the real entry
  point: `start()` → `executeTurn()` assembles the system prompt, skills, history,
  builds a `ToolRegistry`, and runs `AgentLoop`.
- `AgentLoop` (`packages/agent-core/src/agent-loop.ts`) is the main loop. It trims
  context with `trimMessagesToContext`, checks `getStopReason` before each iteration
  and before each tool call, and executes tool calls **serially** (`for` + `await` —
  never in parallel) to allow repeat-call detection, consecutive-failure counting, and stop checks.
- `NativeAgentRuntime` (`packages/agent-core`) is a simplified fallback path using
  `ContextManager.buildMessages`; it is **not** on the desktop production path.

## Tools

- A tool is a `ToolDefinition` (`packages/tools/src/tool-registry.ts`): `{ name, description, parameters, execute }`.
- `parameters` is a **raw JSON Schema object** (not Zod). Validate inputs inside
  `execute` by hand and `throw new Error(...)` on bad input. Honor `context.signal`.
- `ToolRegistry` dispatches by name; `schemas()` is what the model sees. Built-in tools:
  file ops (`workspace.readFile/listDirectory/writeFile/replaceText`), command
  execution (`workspace.runCommand`, gated by `command-policy.ts` modes
  `sentinel|cruise|unleashed`), and `automation.proposeCreate`.
- To add a tool: create it in `packages/tools/src`, export from that package's
  `index.ts`, and register it in the `new ToolRegistry([...])` array in
  `agent-coordinator.ts`. No changes to `ToolRegistry`/`AgentLoop`/providers are needed.
- **Tools ≠ Skills.** Skills are Markdown prompt documents injected as system messages
  (user-invoked via `/`), not model-callable functions.

## Network & secrets conventions

- No `axios`/`node-fetch`. Use native `globalThis.fetch`, injected as a `FetchFunction`
  option defaulting to `globalThis.fetch.bind(globalThis)` for testability; pass
  `signal` through for cancellation (see `packages/model-gateway/src/*`).
- API keys are encrypted at rest via `CredentialCrypto` and stored by
  `ProviderConfigStore` (`secrets.json`, mode `0600`). Reuse this for any new credential.

## Conventions

- All time values transmitted/stored are **second-level Unix timestamps**.
- Validate at boundaries (IPC payloads via Zod, tool inputs by hand); trust internal code.
- For not-yet-shipped features, prefer changing types/IDL directly over back-compat shims.
- Follow existing file/test naming: co-locate tests as `*.test.ts(x)` next to source.

## Testing

- Vitest. Desktop tests run under the `node` or `jsdom` environment (see the
  `// @vitest-environment` pragma at the top of each test file and `vitest.config.ts`).
- Run `pnpm test` (all) or filter to a package; write/extend tests for any change to
  tools, IPC handlers, the agent loop, or stores.
