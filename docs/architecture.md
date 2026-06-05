# StoryForge Architecture

StoryForge separates the product shell from the agent engine.

## Runtime Protocol

The desktop app consumes `AgentEvent` values from `@story-forge/shared`. This keeps renderer UI independent from the internal implementation of the native runtime and leaves room for future runtime adapters.

## Native Agent Runtime

The Phase 1 runtime performs one model request per turn. It builds context, exposes tool schemas, executes model-requested tool calls, and emits structured events.

## Tool System

Tools are registered through `ToolRegistry`. Workspace file tools use `WorkspaceSandbox` so file access stays inside the selected root. Internal tool names remain StoryForge-readable, while provider adapters map names to API-safe function names when needed.

## Model Gateway

The first provider targets OpenAI-compatible chat completions APIs through configurable `apiKey`, `baseUrl`, and `model` fields. It validates response shape before tool calls reach the runtime.

## Memory, Skills, and MCP

Memory, Skills, and MCP are package boundaries in Phase 1. Each has a concrete minimal behavior and tests so future expansion can happen behind existing interfaces.

## Desktop App

The Electron main process owns runtime creation. The renderer calls it through a preload bridge and renders the returned event stream.
