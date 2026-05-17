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
- Provide documentation that is clear for both human host-app authors and AI
  agents performing integrations.

## Non-Goals

- No transcript rendering.
- No backend upload implementation.
- No Codex-specific runtime behavior.
- No mandatory TipTap dependency in the core API.

## MVP Scope

- `CodexChatBox` React component, plus `AgentChatBox` alias.
- `ChatBoxSubmitPayload` type with text, files, model, access mode, and metadata.
- Attachment chip rendering and file picker callbacks. Uploading remains a host-app
  responsibility.
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

## Implemented API

The package exports:

- `CodexChatBox`
- `AgentChatBox`
- `DEFAULT_LABELS_EN`
- `DEFAULT_LABELS_ZH`
- `resolveLabels`
- `ChatBoxSubmitPayload`
- `CodexChatBoxProps`
- attachment, upload, slot, label, locale, and option helper types

Text can be controlled with `value` / `onChange` or uncontrolled with
`defaultValue`. Attachments can be controlled with `files` / `onFilesChange` or
uncontrolled with `defaultFiles`. Managed-upload entries can be controlled with
`attachments` / `onAttachmentsChange` or uncontrolled with
`defaultAttachments`.

Submit payload shape:

```ts
interface ChatBoxSubmitPayload {
  /** Final text, template-rendered when uploaded attachments are present. */
  text: string;
  /** Raw textarea text, unaffected by attachmentTextTemplate. */
  rawText: string;
  files: File[];
  attachments: UploadedAttachment[];
  model?: string;
  accessMode?: string;
  metadata?: Record<string, unknown>;
}
```

`rawText` and `attachments` are always present. Consumers that only read `text`
and `files` remain compatible.

Slots:

- `leftTools`
- `modelSelector`
- `accessModeSelector`
- `voiceButton`
- `sendButton`
- `loadingIndicator`

Each slot may be a React node or a render function receiving component state
and actions such as `submit`, `focus`, `openFilePicker`, `removeFile`,
`clearText`, and `clearFiles`.

## Implementation Notes

- The component uses a native textarea and reads `textareaRef.current.value` at
  submit time. Controlled mode is still supported, but submit does not depend
  only on React `onChange` state.
- IME composition is tracked explicitly. `Cmd+Enter` / `Ctrl+Enter` is ignored
  while composition is active.
- `Shift+Enter` is left to the native textarea and creates a newline.
- `disabled`, `loading`, and `streaming` prevent built-in submit and file-picker
  actions. Slot render functions receive the same state so host controls can
  mirror the behavior.
- The component makes no network requests. File selection only updates chip
  state and emits callbacks with `File[]` unless the host supplies
  `uploadHandler`; then the component calls only that host callback and surfaces
  queue/progress/retry state.
- Styles are distributed as `@agentmeshkit/chatbox/styles.css` and use
  `--amk-chatbox-*` variables for theming.
- README.md is the caller-facing integration contract. `docs/AI_AGENT_INTEGRATION.md`
  is the compact agent-facing contract for automated integrations and should
  stay aligned with exported types.

## Acceptance Criteria

- Component renders cleanly on desktop and mobile widths.
- Submit works with mouse and keyboard without losing IME text.
- Host apps can fully control model/access-mode UI through props or slots.
- No network calls are made by the component itself.
- React Testing Library/Vitest coverage includes controlled/uncontrolled text,
  keyboard submit, IME guard, attachment chips, file picker callbacks, and slots.
- Visual fixtures for empty, filled, uploading, disabled, and streaming states
  remain a post-MVP follow-up.

## Milestones

1. Build controlled/uncontrolled textarea MVP. Done.
2. Add slot architecture and attachment chips. Done.
3. Add React Testing Library/Vitest behavior tests. Done.
4. Add browser/Playwright visual tests. Follow-up.
5. Publish `0.1.0`.

## v0.1 Enhancements

The following capabilities were added on top of the MVP. They are
all additive: hosts not opting in (no `uploadHandler`, no `locale`, no
template, no validation caps) keep the original MVP behavior, and the
existing `files` / `onFilesSelected` / `onSubmit({ text, files })` contract
continues to work.

### Managed Upload

- `uploadHandler(file, { signal, reportProgress })` runs uploads inside the
  chatbox.
- Entries flow `queued` -> `uploading` -> `uploaded`, or `error` on rejection.
- Per-entry `AbortController`; removing a chip or unmounting aborts.
- Concurrency capped at `maxConcurrentUploads` (default 4).
- `AbortError` rejections drop the entry silently. Other errors fire
  `onAttachmentError` and surface a `Retry upload` button.
- `attachments` / `defaultAttachments` / `onAttachmentsChange` mirror the
  controlled/uncontrolled split used for text and files.

### Drag-and-Drop and Paste

- The root element listens for `dragover` / `dragleave` / `drop` with file
  payloads and forwards them through the same pipeline as the picker.
- The textarea handles image pastes (`clipboardData.items` with
  `kind === 'file'` and `type.startsWith('image/')`).
- `data-amk-dragover="true"` is set during a file drag, available for CSS.

### Attachment Text Template

- `attachmentTextTemplate?: string | (attachments, text) => string`.
- String placeholders: `{paths}`, `{names}`, `{count}`, `{text}`.
- Template renders only when there is at least one uploaded attachment.

### Image Preview / Type Badge

- Chips with `mimeType.startsWith('image/')` render a 24x24 thumbnail (using
  the uploaded `url` when present, falling back to `URL.createObjectURL`).
- Non-image chips show a text badge derived from the MIME type or file
  extension (e.g. `PDF`, `ZIP`, `TXT`, `FILE`).
- Object URLs are tracked and revoked on chip removal / unmount.

### i18n Locale

- `locale: 'en' | 'zh'` selects a built-in dictionary.
- `labels` are shallow-merged on top of the selected locale.
- `DEFAULT_LABELS_EN` / `DEFAULT_LABELS_ZH` are exported for reuse.

### Client-Side Validation

- `maxFileSize` rejects oversized files before they enter the queue.
- `maxFiles` caps the total number of entries (queued + uploading + uploaded).
- Rejections call `onAttachmentError(syntheticEntry, error)` and surface an
  inline toast that auto-clears after about 3 seconds.

### Updated Payload Shape

```ts
interface ChatBoxSubmitPayload {
  /** Final text, template-rendered when attachments are present. */
  text: string;
  /** Raw textarea text, unaffected by attachmentTextTemplate. */
  rawText: string;
  files: File[];
  attachments: UploadedAttachment[];
  model?: string;
  accessMode?: string;
  metadata?: Record<string, unknown>;
}
```

The `rawText` and `attachments` fields are always present (`attachments` is
an empty array when none are uploaded). Consumers that only read `text` and
`files` remain compatible.
