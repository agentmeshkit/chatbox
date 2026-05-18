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
import {
  CodexChatBox,
  type ChatBoxSubmitPayload,
} from '@agentmeshkit/chatbox';
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

`onSubmit` can be async. By default, `clearOnSubmit={true}` clears text/files
after a successful submit; rejected submissions keep the draft and can be
observed with `onSubmitError`. Set `clearOnSubmit="immediate"` to restore
fire-and-forget clearing, or `false` / `"never"` to keep drafts after submit.

For a compact guide intended to be pasted into AI agent context, see
[`docs/AI_AGENT_INTEGRATION.md`](docs/AI_AGENT_INTEGRATION.md).

## Public Contract

The package exports the component, its AgentWeb-compatible alias, label
dictionaries, and TypeScript helper types:

```tsx
import {
  AgentChatBox,
  CodexChatBox,
  DEFAULT_LABELS_EN,
  DEFAULT_LABELS_ZH,
  type AttachmentEntry,
  type ChatBoxSubmitPayload,
  type ChatBoxTheme,
  type CodexChatBoxProps,
  type UploadedAttachment,
  type UploadHandler,
} from '@agentmeshkit/chatbox';
import '@agentmeshkit/chatbox/styles.css';
```

`onSubmit(payload)` receives:

- `text`: final text. If uploaded attachments exist and
  `attachmentTextTemplate` is set, this is the rendered template output.
- `rawText`: original trimmed textarea text, before attachment templating.
- `files`: selected local `File[]` when `uploadHandler` is not used.
- `attachments`: uploaded attachment metadata when `uploadHandler` is used.
  Always present; empty when there are no uploaded attachments.
- `model`, `accessMode`, `metadata`: host-provided routing context.

`accessMode` is display and routing metadata. Treat permissions, sandboxing,
and execution policy as backend decisions rather than trusting the UI value.

## Slots

Slots accept either React nodes or render functions. Render functions receive
state and actions such as `submit`, `focus`, `openFilePicker`, `removeFile`,
`clearText`, `clearFiles`, `stop`, `submitting`, `pendingAttachmentCount`, and
`canStop`.

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
the submit payload. Without `uploadHandler`, it does not upload files or make
network requests; the host owns persistence and backend handoff.

The built-in `+` control opens an attachment menu with:

- `Add files or photos`: opens the regular file picker.
- `Add folder`: opens a directory picker in browsers that support
  `webkitdirectory`; selected files are passed through the same attachment
  pipeline as regular files.

Dragging files over the chatbox shows a drop target and dropping files uses the
same validation and upload path as the picker. Pasted images are also attached
from the textarea.

```tsx
<CodexChatBox
  defaultFiles={initialFiles}
  onFilesSelected={(files) => queueLocalPreviews(files)}
  onFilesChange={(files) => setPendingFiles(files)}
  onSubmit={({ text, files }) => sendTurnWithFiles(text, files)}
/>
```

## Voice Input

Set `enableVoiceInput` to show the built-in microphone button. When the browser
supports the Web Speech API, recognized speech is appended to the textarea and
emitted through `onChange`.

```tsx
<CodexChatBox
  enableVoiceInput
  voiceLanguage="en-US"
  onVoiceTranscript={(transcript, nextText) => {
    console.log(transcript, nextText);
  }}
  onVoiceError={(error) => console.warn(error.message)}
  onSubmit={sendTurn}
/>
```

Voice input is optional because browser support and permissions vary. Hosts can
replace the built-in microphone through `slots.voiceButton`; slot render
functions receive `voiceListening`, `canUseVoiceInput`, `startVoiceInput`, and
`stopVoiceInput`.

## Managed Upload

Provide an `uploadHandler` and the chatbox runs the upload state machine
itself: it queues files, calls the handler with concurrency `<=
maxConcurrentUploads`, surfaces `queued | uploading | uploaded | error` chip
state, and exposes a retry button on failed entries. The host receives the
uploaded payload via `attachments` on submit.

```tsx
<CodexChatBox
  onSubmit={({ text, attachments }) => sendTurn(text, attachments)}
  uploadHandler={async (file, { signal, reportProgress }) => {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: file,
      signal,
    });
    reportProgress?.(1);
    const data = (await res.json()) as { relPath: string; url: string };
    return {
      name: file.name,
      size: file.size,
      mimeType: file.type,
      relPath: data.relPath,
      url: data.url,
    };
  }}
/>
```

In managed-upload mode, newly selected, dropped, or pasted files move through
`AttachmentEntry` states. Only entries with `status === 'uploaded'` are included
in `payload.attachments` on submit; pending and failed entries remain visible
for the user to wait, remove, or retry.

By default, submit is disabled while any managed attachment is `queued` or
`uploading`; this prevents prompts from being sent without their intended
attachments. Set `allowSubmitWithPendingUploads` only when the host explicitly
wants to submit text while uploads continue.

Aborts (`AbortError`) drop the entry silently. Other errors flip the chip to
`error`, fire `onAttachmentError`, and expose a retry button that re-runs the
handler with the originally selected `File`.

## Drag & Drop / Paste

The root element accepts file drops and the textarea accepts image pastes.
Both pipelines route through the same code path as the file picker, so
`uploadHandler` (if provided) is invoked for dropped and pasted files too.

```tsx
<CodexChatBox
  onSubmit={sendTurn}
  uploadHandler={uploadFile}
/>
// Drag a PNG over the box -> chip appears; paste a screenshot in the textarea
// -> chip appears.
```

## Attachment Text Template

When attachments are present, the host can shape the final `text` sent to the
agent via `attachmentTextTemplate`.

```tsx
<CodexChatBox
  onSubmit={sendTurn}
  uploadHandler={uploadFile}
  attachmentTextTemplate="[attachments: {paths}]\n{text}"
/>
```

Available placeholders: `{paths}` (comma-joined `relPath` or `name`),
`{names}`, `{count}`, `{text}`. For full control, pass a function:

```tsx
attachmentTextTemplate={(attachments, text) =>
  `<<files>>${attachments.map((a) => a.relPath).join(',')}<<end>>\n${text}`
}
```

The user's original text is always preserved in `payload.rawText`. When the
attachments array is empty, `payload.text` equals `payload.rawText` regardless
of the template.

## i18n

Set `locale="zh"` for the bundled Chinese labels, or stay on the default
English. Both can be partially overridden via `labels`.

```tsx
<CodexChatBox locale="zh" labels={{ send: '提交' }} onSubmit={sendTurn} />
```

The exported `DEFAULT_LABELS_EN` and `DEFAULT_LABELS_ZH` dictionaries are
available for hosts that want to extend or reuse them.

## Validation

Reject files that exceed a size or count cap before they enter the queue:

```tsx
<CodexChatBox
  onSubmit={sendTurn}
  uploadHandler={uploadFile}
  maxFileSize={10 * 1024 * 1024}
  maxFiles={4}
  onAttachmentError={(entry, error) => console.warn(entry.id, error.message)}
/>
```

Rejected files surface through `onAttachmentError` and a brief inline toast
visible to the user (auto-clears after ~3 seconds).
The same validation path applies to local files without `uploadHandler`, managed
uploads, drag-and-drop, and pasted images. `accept` is also enforced for dropped
and pasted files.

## Stop / Cancel

When `streaming` and `onStop` are provided, the built-in send button becomes a
stop button. Custom send slots can use `canStop` and `stop` from the render
context.

```tsx
<CodexChatBox
  streaming={isRunning}
  onStop={() => cancelTurn()}
  onSubmit={sendTurn}
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
- Attachment menu: `ArrowDown` / `ArrowUp` opens and navigates, `Escape` closes.

## Accessibility

- The root has `role="form"` and a configurable accessible name through
  `labels.root`.
- The textarea is labelled by a visually hidden label. Override
  `labels.textarea` when the host surface needs a more specific label.
- Attachment and send controls use `aria-label` / `title` values from
  `labels.attach`, `labels.removeFile`, and `labels.send`.
- The attachment menu follows the menu button pattern with `aria-haspopup`,
  `aria-expanded`, `aria-controls`, `role="menu"`, and `role="menuitem"`.
- `loading` and `streaming` mark the root and textarea busy, render a polite
  `role="status"` indicator, and disable submit/attachment/select controls.
- Internal async submission marks the root busy with `data-submitting`, renders
  a polite submitting status, and disables the textarea until the submit settles.
- `disabled` disables the textarea and controls and sets `aria-disabled` on the
  root.

## Theming

Import `@agentmeshkit/chatbox/styles.css`. The default dark palette is scoped to
the `.amk-chatbox` root so it does not write variables to `:root`.

Use the built-in light or system-aware themes when the host surface is light:

```tsx
<CodexChatBox theme="light" onSubmit={sendTurn} />
<CodexChatBox theme="auto" onSubmit={sendTurn} />
```

The light preset is also available as a root class when hosts prefer to route
theme state through `className`:

```tsx
<CodexChatBox className="amk-chatbox--light" onSubmit={sendTurn} />
```

For custom themes, override CSS variables on the chatbox root class. Load host
CSS after `@agentmeshkit/chatbox/styles.css`:

```css
.my-chatbox {
  --amk-chatbox-bg: #101014;
  --amk-chatbox-border: rgba(255, 255, 255, 0.18);
  --amk-chatbox-accent: #ffffff;
  --amk-chatbox-radius: 24px;
}
```

Copy-paste light palette:

```css
.amk-chatbox--light {
  --amk-chatbox-bg: #ffffff;
  --amk-chatbox-bg-elevated: #f5f5f4;
  --amk-chatbox-bg-control: #ecebe9;
  --amk-chatbox-bg-control-hover: #dad8d4;
  --amk-chatbox-border: rgba(0, 0, 0, 0.08);
  --amk-chatbox-border-focus: rgba(0, 0, 0, 0.2);
  --amk-chatbox-text: #1a1a1a;
  --amk-chatbox-text-muted: #57534e;
  --amk-chatbox-text-subtle: #78716c;
  --amk-chatbox-accent: #18181b;
  --amk-chatbox-accent-hover: #27272a;
  --amk-chatbox-accent-text: #ffffff;
  --amk-chatbox-danger: #b91c1c;
  --amk-chatbox-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  --amk-chatbox-spinner-track: rgba(0, 0, 0, 0.16);
}
```

## CSS Variable Contract

The stylesheet export is part of the package contract:

```tsx
import '@agentmeshkit/chatbox/styles.css';
```

Hosts may override these variables on the chatbox root class, such as a custom
class passed through `className`, or a more specific selector loaded after the
package stylesheet:

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
- `--amk-chatbox-accent-hover`
- `--amk-chatbox-accent-text`
- `--amk-chatbox-danger`
- `--amk-chatbox-radius`
- `--amk-chatbox-control-radius`
- `--amk-chatbox-shadow`
- `--amk-chatbox-spinner-track`
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
