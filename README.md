# @agentmeshkit/chatbox

Standalone React composer for coding-agent products. It provides the dark,
rounded ChatGPT/Codex-style input surface without depending on CodexView or
AgentWeb internals.

## Install

```bash
pnpm add @agentmeshkit/chatbox
```

```tsx
import { CodexChatBox } from '@agentmeshkit/chatbox';
import '@agentmeshkit/chatbox/styles.css';
```

## Basic Usage

```tsx
import { useState } from 'react';
import { CodexChatBox, type ChatBoxSubmitPayload } from '@agentmeshkit/chatbox';
import '@agentmeshkit/chatbox/styles.css';

export function ChatInput() {
  const [text, setText] = useState('');

  const submitTurn = (payload: ChatBoxSubmitPayload) => {
    console.log(payload.text, payload.files, payload.model, payload.accessMode);
  };

  return (
    <CodexChatBox
      value={text}
      onChange={setText}
      onSubmit={submitTurn}
      model="gpt-5"
      accessMode="full-access"
      metadata={{ surface: 'demo' }}
    />
  );
}
```

Uncontrolled usage is also supported:

```tsx
<CodexChatBox defaultValue="" onSubmit={(payload) => sendTurn(payload)} />
```

See `examples/basic.tsx` for a small controlled fixture with files, selectors,
metadata, loading state, and a custom send button. It is a source example only
and does not require a dev server.

Submit uses the current textarea DOM value, not only React state. This keeps
uncontrolled usage resilient to IME composition and the textarea `onChange`
loss mode seen in earlier AgentWeb composer implementations.

## Slots

Slots accept either React nodes or render functions. Render functions receive
state and actions such as `submit`, `focus`, `openFilePicker`, `removeFile`,
`clearText`, and `clearFiles`.

```tsx
<CodexChatBox
  onSubmit={sendTurn}
  slots={{
    leftTools: ({ openFilePicker }) => (
      <button type="button" onClick={openFilePicker}>Attach</button>
    ),
    modelSelector: <ModelSelector />,
    accessModeSelector: <AccessModeSelector />,
    voiceButton: <VoiceButton />,
    loadingIndicator: <Spinner />,
    sendButton: ({ submit, canSubmit }) => (
      <button type="button" disabled={!canSubmit} onClick={submit}>
        Send
      </button>
    ),
  }}
/>
```

Built-in selectors can be used with options:

```tsx
<CodexChatBox
  onSubmit={sendTurn}
  defaultModel="gpt-5"
  modelOptions={[
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5-mini', label: 'GPT-5 mini' },
  ]}
  defaultAccessMode="read-only"
  accessModeOptions={[
    { value: 'read-only', label: 'Read only' },
    { value: 'full-access', label: 'Full access' },
  ]}
/>
```

## Attachments

The component renders attachment chips and exposes selected `File` objects in
the submit payload. It does not upload files or make network requests.

```tsx
<CodexChatBox
  defaultFiles={initialFiles}
  onFilesSelected={(files) => queueLocalPreviews(files)}
  onFilesChange={(files) => setPendingFiles(files)}
  onSubmit={({ text, files }) => sendTurnWithFiles(text, files)}
/>
```

## AgentWeb Usage

AgentWeb can replace its local composer shell with this package while keeping
workspace-specific upload and mention behavior outside the component:

```tsx
<CodexChatBox
  value={draft}
  onChange={setDraft}
  files={pendingFiles}
  onFilesChange={setPendingFiles}
  disabled={sessionBusy}
  loading={uploading}
  streaming={streaming}
  model={selectedModel}
  accessMode={accessMode}
  metadata={{ sessionId }}
  slots={{
    leftTools: <WorkspaceMentionButton sessionId={sessionId} />,
    modelSelector: <AgentWebModelSelector />,
    accessModeSelector: <AgentWebAccessModeSelector />,
  }}
  onSubmit={({ text, files, model, accessMode, metadata }) => {
    sendAgentTurn({ text, files, model, accessMode, sessionId: metadata?.sessionId });
  }}
/>
```

For AgentWeb uploads, perform the upload in the host app before or after submit
and pass the resulting local `File` list/chip state through `files` and
`onFilesChange`.

## Keyboard Behavior

- `Cmd+Enter` / `Ctrl+Enter`: submit.
- `Shift+Enter`: newline, handled by the native textarea.
- IME composition: submit shortcuts are ignored while composition is active.

## Accessibility

- The root has `role="form"` and a configurable accessible name through
  `labels.root`.
- The textarea is labelled by a visually hidden label. Override
  `labels.textarea` when the host surface needs a more specific label.
- Attachment and send controls use `aria-label` / `title` values from
  `labels.attach`, `labels.removeFile`, and `labels.send`.
- `loading` and `streaming` mark the root and textarea busy, render a polite
  `role="status"` indicator, and disable submit/attachment/select controls.
- `disabled` disables the textarea and controls and sets `aria-disabled` on the
  root.

## Theming

Import `@agentmeshkit/chatbox/styles.css`, then override CSS variables:

```css
.my-chatbox {
  --amk-chatbox-bg: #101014;
  --amk-chatbox-border: rgba(255, 255, 255, 0.18);
  --amk-chatbox-accent: #ffffff;
  --amk-chatbox-radius: 24px;
}
```

## CSS Variable Contract

The stylesheet export is part of the package contract:

```tsx
import '@agentmeshkit/chatbox/styles.css';
```

Hosts may override these variables on `.amk-chatbox` or an ancestor:

- `--amk-chatbox-bg`
- `--amk-chatbox-bg-elevated`
- `--amk-chatbox-bg-control`
- `--amk-chatbox-bg-control-hover`
- `--amk-chatbox-border`
- `--amk-chatbox-border-focus`
- `--amk-chatbox-text`
- `--amk-chatbox-text-muted`
- `--amk-chatbox-text-subtle`
- `--amk-chatbox-accent`
- `--amk-chatbox-accent-text`
- `--amk-chatbox-danger`
- `--amk-chatbox-radius`
- `--amk-chatbox-control-radius`
- `--amk-chatbox-shadow`
- `--amk-chatbox-font`
- `--amk-chatbox-textarea-max-height`

Class names are intentionally stable enough for layout wrapping and smoke
tests, but prefer CSS variables over targeting internal elements when changing
colors, radii, font, or shadow.

## Testing Notes

Before publishing or wiring into a host app, run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` copies `src/styles.css` to `dist/styles.css`; the package export
map exposes it as `@agentmeshkit/chatbox/styles.css`.

`AgentChatBox` is exported as an alias of `CodexChatBox`.
