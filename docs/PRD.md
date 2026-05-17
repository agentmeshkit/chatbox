# PRD: AgentMeshKit ChatBox

## Summary

`@agentmeshkit/chatbox` is a standalone React input/composer package for
AI coding-agent interfaces. It covers the bottom input area: text entry,
submission, attachments, model/access-mode affordances, voice slots, and
loading/disabled states.

## Problem

AgentWeb needs a reusable composer similar to modern Codex/ChatGPT input boxes.
Other projects will need the same behavior, but the component should not live
inside a transcript renderer package or inside AgentWeb business logic.

## Users

- App authors building agent chat UIs.
- Design systems that need a polished agent composer.
- Products that pair any transcript renderer with a reusable input surface.

## Goals

- Provide a polished, responsive chat input component.
- Support controlled and uncontrolled usage.
- Expose slots for left tools, access mode, model selector, voice, and send.
- Handle keyboard shortcuts, IME-safe submit, disabled/streaming states, and
  attachment chips.
- Theme through CSS variables.

## Non-Goals

- No transcript rendering.
- No backend upload implementation.
- No Codex-specific runtime behavior.
- No mandatory TipTap dependency in the core API.

## MVP Scope

- `CodexChatBox` React component.
- `ChatBoxSubmitPayload` type with text, files, model, access mode, and metadata.
- Attachment chip rendering and file picker callbacks.
- Send button states and keyboard shortcuts.
- CSS variable theme contract.
- Accessibility labels and focus management.

## Public API Sketch

```tsx
<CodexChatBox
  value={text}
  onChange={setText}
  onSubmit={(payload) => sendTurn(payload)}
  model="gpt-5.5"
  accessMode="full-access"
  disabled={streaming}
  slots={{ modelSelector: <ModelSelector /> }}
/>
```

## Acceptance Criteria

- Component renders cleanly on desktop and mobile widths.
- Submit works with mouse and keyboard without losing IME text.
- Host apps can fully control model/access-mode UI through props or slots.
- No network calls are made by the component itself.
- Visual fixtures cover empty, filled, uploading, disabled, and streaming states.

## Milestones

1. Build controlled textarea MVP.
2. Add slot architecture and attachment chips.
3. Add browser/Playwright visual tests.
4. Publish `0.1.0`.

