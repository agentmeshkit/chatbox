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

`AgentChatBox` is exported as an alias of `CodexChatBox`.
