# StoryForge Coding Agent Models and Sessions Design

## Purpose

This change turns the existing single-turn desktop shell into a persistent,
multi-session coding agent. It fixes prompt submission, adds local model
provider configuration, persists conversations by workspace, and introduces a
bounded multi-step tool loop with workspace-scoped file and command tools.

## Confirmed Scope

- Pressing Enter sends the prompt.
- Pressing Shift+Enter inserts a newline.
- Enter does not send while an IME composition is active.
- OpenAI, Anthropic Claude, OpenRouter, Volcano Engine, and DeepSeek are
  configurable providers.
- DeepSeek is the default provider for initial testing.
- Provider model selection offers recommended models and accepts a custom
  model ID.
- API keys are encrypted locally and never returned to the renderer.
- Workspaces can contain multiple independent sessions.
- Sessions, messages, and tool activity survive application restarts.
- The agent can read, list, create, and modify files inside the active
  workspace.
- Approved development commands run automatically inside the active workspace.
- The agent can perform up to 1000 model/tool steps in a single turn, subject
  to additional stop conditions and a two-hour wall-clock limit.

## User Interface

### Provider Settings

The Models navigation item opens a master-detail settings page.

The left side lists:

- DeepSeek
- OpenAI
- Anthropic Claude
- OpenRouter
- Volcano Engine

Each item shows whether it is configured and whether it is the default. The
right side edits the selected provider:

- API key
- API base URL
- Recommended model selection
- Custom model ID
- Provider-specific options
- Save
- Test connection
- Set as default

The API key field displays a placeholder when a secret already exists. Saving
an unchanged placeholder preserves the existing key. The renderer can query
only whether a provider has a stored secret.

DeepSeek starts as the default provider. The implementation must query the
official DeepSeek models endpoint using the configured account before choosing
the exact V4 model ID. An unverified V4 model identifier must not be hardcoded.

### Workspace and Session Navigation

The Coding Agent sidebar groups sessions by workspace. Workspaces are
collapsible and can contain any number of sessions.

Supported actions:

- Open a workspace using the system folder picker
- Create a session inside a workspace
- Switch sessions
- Rename a session
- Delete a session
- Remove a workspace after checking for associated sessions

The active session header displays its title, workspace, provider, and model.
Each session retains its own provider and model selection. Changing the global
default affects new sessions only.

### Prompt Interaction

The prompt control follows these rules:

- Enter sends a non-empty prompt.
- Shift+Enter inserts a newline.
- Enter during IME composition does nothing.
- Sending is disabled while the prompt is empty.
- Repeated submission is disabled while the current turn is running.
- A Stop action is visible while a turn is running.

Messages render as a conversation rather than raw event JSON. Tool calls,
command output, stop reasons, and errors appear as expandable activity items.

## Architecture

### Renderer

The renderer owns presentation state only. It sends identifiers and user
intent through the preload bridge:

- `providerId`
- `workspaceId`
- `sessionId`
- prompt text
- settings updates containing a newly entered key only

The renderer never receives decrypted secrets and never constructs a provider
client.

### Preload and IPC

The preload exposes typed APIs for:

- Listing and updating provider settings
- Testing a provider connection
- Setting the default provider
- Opening and listing workspaces
- Creating, listing, renaming, and deleting sessions
- Loading session messages
- Starting and stopping an agent turn

IPC responses use redacted provider views. Error payloads must not include
authorization headers, request bodies containing secrets, or decrypted keys.

### Electron Main Process

The main process owns four services:

1. `ProviderConfigStore`
   Stores public provider settings and encrypted credentials.
2. `SessionRepository`
   Persists workspaces, sessions, messages, tool calls, and stop reasons.
3. `ProviderRegistry`
   Resolves a provider configuration into the correct model adapter.
4. `AgentCoordinator`
   Loads session history, runs the bounded tool loop, emits progress, supports
   cancellation, and persists each state transition.

Service boundaries must remain testable without starting Electron. Electron
APIs such as `safeStorage`, `app.getPath`, and folder dialogs are supplied
through small adapters.

## Provider Design

### OpenAI-Compatible Adapter

The existing OpenAI-compatible adapter is reused and extended for:

- OpenAI
- OpenRouter
- Volcano Engine
- DeepSeek

Provider presets supply default API URLs, recommended models, required
headers, and capability flags. Users can override the API URL and model ID.

### Anthropic Adapter

Anthropic Claude uses a native Anthropic Messages API adapter. It maps
StoryForge messages and tool schemas to Anthropic request and response shapes
without relying on an OpenAI compatibility layer.

### Provider Discovery and Validation

Connection testing validates:

- The secret can authenticate.
- The configured base URL is reachable.
- The configured model exists or accepts a minimal request.
- Required tool-calling behavior is supported when the provider exposes it.

DeepSeek V4 discovery uses the official models endpoint. If no V4 model is
returned, the UI reports that result and requires the user to choose an
available model rather than silently substituting an unrelated model.

## Local Storage

All application data is under Electron's `app.getPath("userData")`:

```text
providers.json
secrets.json
workspaces.json
sessions/
  <session-id>.json
```

### Provider Files

`providers.json` contains non-secret data:

- Provider ID and type
- Display name
- Base URL
- Selected model ID
- Provider options
- Default status
- Last connection-test status and timestamp

`secrets.json` contains only encrypted API key payloads. Encryption and
decryption use Electron `safeStorage`. Plaintext keys exist only in main
process memory while saving a secret or making a provider request.

### Workspace Index

`workspaces.json` contains stable workspace IDs, canonical paths, display
names, creation timestamps, and last-opened timestamps.

A canonical path maps to one workspace record. A workspace can own multiple
sessions.

### Session Files

Each session JSON file contains:

- Session ID
- Workspace ID
- Title
- Provider ID and model ID
- Creation and update timestamps
- Conversation messages
- Tool calls and results
- Command output summaries
- Turn status and stop reason

Session JSON is intentionally plaintext for backup, migration, and debugging.
It must never contain API keys, authorization headers, or encrypted provider
payloads.

Writes use a temporary file followed by an atomic rename to reduce corruption
risk. Every user message, assistant message, tool transition, and stop
transition is persisted before the next external action.

## Agent Execution

### Persistent Conversation

Starting a turn loads the selected session's full conversation history. The
new user message is appended and persisted before the first model call.

The coordinator repeatedly:

1. Builds model context from persisted session messages.
2. Calls the selected model.
3. Persists assistant content and requested tool calls.
4. Executes allowed tools.
5. Persists tool results.
6. Sends the updated context back to the model.
7. Stops when the model produces a final response or a stop condition fires.

The runtime protocol must support assistant tool-call messages and tool-result
messages so provider adapters receive valid multi-step history.

### Stop Conditions

A turn stops on the first matching condition:

- The model returns a final response with no tool call.
- The user selects Stop.
- 1000 model/tool steps are reached.
- Two hours of wall-clock execution are reached.
- The same tool with identical arguments is requested three consecutive times.
- Five consecutive tool executions fail.
- A non-recoverable provider, storage, or policy error occurs.

Cancellation aborts the active provider request and terminates an active child
process. The current progress and explicit stop reason are persisted.

An interrupted or incomplete turn remains visible after restart but never
resumes automatically.

## Tool Safety

### File Tools

Tools include:

- Read text file
- List directory
- Create or replace text file
- Apply a bounded text edit

Every path is resolved against the canonical workspace root. Symlink and
parent-directory escapes are rejected. Writes occur automatically when the
request passes policy checks.

### Command Tool

Commands execute with:

- Working directory constrained to the active workspace
- Default per-command timeout of 120 seconds
- Output size limits
- Captured stdout, stderr, exit code, duration, and timeout state
- Cancellation support

Automatically allowed categories include:

- Tests
- Builds
- Type checks
- Formatting and linting
- Package-manager inspection and project scripts
- Git read-only commands

The policy rejects destructive or privilege-escalating commands, including:

- `sudo`
- Recursive destructive deletion
- Commands targeting paths outside the workspace
- Forced Git reset or checkout that discards changes
- Destructive Git clean operations
- Disk, process, or system management commands outside normal development use

Policy evaluation uses parsed command structure and explicit allow/deny rules,
not substring matching alone. Rejected commands are recorded with a clear
reason.

## Error Handling

- Provider errors become persisted assistant error entries with sanitized
  details.
- Invalid model IDs direct the user back to provider settings.
- Storage failures stop the turn before additional external actions occur.
- Tool policy failures are returned to the model as failed tool results and
  count toward the consecutive-failure limit.
- Corrupt JSON files are preserved for recovery and reported without
  overwriting them.
- Secret decryption failures require re-entering the key.

Logs redact API keys, authorization headers, and secret payloads.

## Testing

### Renderer Tests

- Enter sends once.
- Shift+Enter inserts a newline.
- IME composition prevents sending.
- Empty prompts and duplicate sends are blocked.
- Stop is shown and invoked for a running turn.
- Provider settings never display or receive plaintext stored keys.
- Workspace groups and persistent sessions render correctly.

### Storage and Security Tests

- Provider public settings and secrets are stored separately.
- `safeStorage` encrypt/decrypt adapters are used correctly.
- IPC responses never contain plaintext keys.
- Session files round-trip messages, tools, status, and stop reasons.
- Atomic writes preserve the previous file on failure.
- API keys never appear in session files or logs.

### Runtime Tests

- Multi-turn history is included in later model calls.
- Tool calls loop back into the model until a final answer.
- User cancellation aborts model and command execution.
- The 1000-step and two-hour limits stop execution.
- Duplicate tool calls and consecutive tool failures stop execution.
- Interrupted sessions remain persisted and do not auto-resume.

### Tool Policy Tests

- Read and write operations work inside the workspace.
- Parent paths and symlink escapes are rejected.
- Approved development commands execute.
- Dangerous commands and destructive Git operations are rejected.
- Timeouts, cancellation, and output limits are enforced.

### Provider Tests

- OpenAI-compatible presets produce correct URLs, headers, and model IDs.
- Anthropic request and tool-call mapping is correct.
- Recommended and custom model IDs are accepted.
- Connection tests return sanitized status.
- DeepSeek model discovery does not assume an unverified V4 model ID.

## Delivery Sequence

1. Add typed provider definitions, provider registry, and secure stores.
2. Add provider settings IPC and the master-detail Models page.
3. Add workspace and session repositories with grouped navigation.
4. Change the runtime protocol to preserve multi-turn tool history.
5. Implement the bounded multi-step coordinator and cancellation.
6. Add workspace-scoped write tools and command policy.
7. Replace raw event rendering with persistent conversation and activity UI.
8. Configure the local DeepSeek secret and validate the available V4 model
   through the provider API.

The local DeepSeek API key configuration is an operational step, not a source
change. It must not be included in Git commits, test fixtures, screenshots, or
design documents.
