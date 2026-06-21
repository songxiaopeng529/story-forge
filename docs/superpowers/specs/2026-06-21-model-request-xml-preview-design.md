# Model Request XML Preview Design

## Goal

Improve the developer-mode model request inspector so structured system prompts are readable. The current raw JSON view is still required, but XML prompt content should have a dedicated preview that wraps and formats content instead of forcing horizontal scrolling through a JSON string.

## Design

- Keep the existing request overview and message list.
- Keep raw JSON as a first-class view for exact outbound payload debugging.
- When a specific message is selected, show a two-mode detail area:
  - `Content Preview`: renders `message.content` directly.
  - `Raw JSON`: renders the exact selected message JSON.
- Default message selections to `Content Preview`; keep the overview on raw JSON.
- If content looks like XML, format it with indentation before rendering.
- Render preview text with wrapping so long content does not require horizontal scrolling.
- Keep `Copy JSON` copying raw JSON for the selected overview/message, regardless of the visible detail mode.

## Scope

This first version does not parse XML into collapsible sections. It only adds a readable preview layer. A later pass can turn StoryForge sections such as `<main>`, `<skills>`, `<mcp>`, `<project-info>`, and `<soul>` into collapsible navigation blocks.

## Testing

- Component test for selecting a system XML message and seeing formatted, wrapped content preview.
- Component test that `Copy JSON` still copies the exact raw JSON for the selected message.
