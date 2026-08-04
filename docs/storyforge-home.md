# StoryForge Home

StoryForge stores durable application and PI Coding Agent data under one home directory.
The default is `~/.story-forge`. Set `STORYFORGE_HOME` before starting an app to use a
different location.

```text
~/.story-forge/
  settings.json
  workspaces.json
  mcp.json
  agent/
    auth.json
    settings.json
    models.json
    models-store.json
    storyforge-provider-overrides.json
    extensions/
    prompts/
    skills/
    themes/
  sessions/
    metadata/
    transcripts/<workspace-id>/
  automations/
    automations.json
    runs/
  skills/
  migrations/
```

`agent/` is passed to PI as its `agentDir`. StoryForge also supplies explicit model,
settings, resource, and session managers, so the desktop runtime does not use the
standalone PI CLI home at `~/.pi/agent`.

Electron browser state such as caches, cookies, and GPU data remains in Electron's
platform-specific `userData` directory. It is runtime state rather than portable
StoryForge configuration.

## Migration

On first startup, Desktop copies durable data from its legacy Electron `userData`
directory into StoryForge Home. Existing destination files win, the old directory is
left intact, and absolute PI session and installed-skill paths are rewritten. A marker
under `migrations/` makes subsequent startups idempotent.

## Project Configuration

PI project resources under `<workspace>/.pi/` remain supported. They are local to a
workspace and are separate from both the StoryForge global home and the standalone PI
CLI home.
