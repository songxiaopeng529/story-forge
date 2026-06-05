# StoryForge

StoryForge is a desktop-first coding agent platform built around a self-authored native Agent Runtime.

## Development

Install dependencies:

```bash
pnpm install
```

Run tests:

```bash
pnpm test
```

Run type checks:

```bash
pnpm typecheck
```

Build packages and the desktop app:

```bash
pnpm build
```

Start the desktop app:

```bash
pnpm dev
```

## Phase 1 Packages

- `@story-forge/shared` provides typed runtime events.
- `@story-forge/model-gateway` provides model provider contracts and an OpenAI-compatible provider.
- `@story-forge/tools` provides the tool registry and workspace sandbox.
- `@story-forge/memory` provides the first memory store contract.
- `@story-forge/skills` provides the first skill manifest parser.
- `@story-forge/mcp` provides the first MCP package boundary.
- `@story-forge/agent-core` provides the native Agent Runtime.
- `@story-forge/desktop` provides the Electron desktop app.
