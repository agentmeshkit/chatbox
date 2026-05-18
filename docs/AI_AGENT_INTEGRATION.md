# AI Agent Integration

Compact integration contract for AI agents wiring `@agentmeshkit/chatbox`.
Keep host-specific runtime, upload, sandbox, and permission decisions outside
the component.

## Import

```tsx
import {
  CodexChatBox,
  type ChatBoxSubmitPayload,
} from '@agentmeshkit/chatbox';
import '@agentmeshkit/chatbox/styles.css';
```

Requires React 18+. Always import the stylesheet; the package export map exposes
it as `@agentmeshkit/chatbox/styles.css`. The default dark palette is scoped to
the chatbox root and does not write variables to `:root`.

## Basic Controlled Use

```tsx
const [text, setText] = useState('');

<CodexChatBox
  value={text}
  onChange={setText}
  onSubmit={(payload) => sendTurn(payload)}
  model="gpt-5.4"
  accessMode="read-only"
/>
```

Use `AgentChatBox` only when a host expects that alias; it is the same component
as `CodexChatBox`. Uncontrolled text is also supported:

```tsx
<CodexChatBox defaultValue="" onSubmit={sendTurn} />
```

## Theme

Use the built-in theme prop instead of hand-picking every CSS variable:

```tsx
<CodexChatBox theme="light" onSubmit={sendTurn} />
<CodexChatBox theme="auto" onSubmit={sendTurn} />
```

`theme="auto"` follows the user's light color-scheme preference through the
bundled stylesheet. Custom palettes should set `--amk-chatbox-*` variables on a
class passed through `className`, with host CSS loaded after the package styles.

## Submit Payload

`onSubmit(payload)` receives:

- `payload.text`: final text, after `attachmentTextTemplate` if attachments exist.
- `payload.rawText`: original textarea text.
- `payload.files`: selected local `File[]`.
- `payload.attachments`: uploaded attachment metadata, if `uploadHandler` is used.
- `payload.model`: current model value.
- `payload.accessMode`: current access-mode value.
- `payload.metadata`: host metadata.

Do not treat `accessMode` as a permission decision by itself. Map it explicitly
in the backend, for example to a `codex-runner` `sandbox` value.

`metadata` can be an object or a function returning an object at submit time.
Use it for routing context such as `sessionId`, `workspaceId`, or surface name.

## Attachments

Without `uploadHandler`, files stay local and are returned as `payload.files`.
The component does not persist bytes or create URLs.

The built-in `+` control opens an attachment menu. `Add files or photos` uses
the normal file picker; `Add folder` uses a browser directory picker when
supported. Both paths flow into the same selected-file pipeline.
Dragging files over the root shows a drop target and dropping them uses the
same validation/upload path. Pasted images from the textarea are attached too.

## Voice Input

Use `enableVoiceInput` when the host wants the built-in browser speech-to-text
button:

```tsx
<CodexChatBox
  enableVoiceInput
  voiceLanguage="en-US"
  onVoiceError={(error) => reportVoiceIssue(error.message)}
  onSubmit={sendTurn}
/>
```

The implementation uses browser `SpeechRecognition` / `webkitSpeechRecognition`
when available, appends recognized text to the textarea, and reports unsupported
browsers or permission failures through `onVoiceError`. For custom voice
providers, keep `enableVoiceInput` off and supply `slots.voiceButton`; the slot
context exposes `startVoiceInput`, `stopVoiceInput`, and `voiceListening`.

With `uploadHandler`, chatbox manages queueing, progress, retry, and uploaded
metadata:

```tsx
<CodexChatBox
  onSubmit={({ text, attachments }) => sendTurn({ text, attachments })}
  uploadHandler={async (file, { signal, reportProgress }) => {
    const response = await uploadFile(file, { signal, onProgress: reportProgress });
    return {
      name: file.name,
      size: file.size,
      relPath: response.relPath,
      url: response.url,
      mimeType: file.type,
    };
  }}
  maxFiles={4}
  maxFileSize={10 * 1024 * 1024}
/>
```

Use `onAttachmentError(entry, error)` for rejected files and upload failures.
Only uploaded entries are submitted in `payload.attachments`; queued,
uploading, and failed entries remain in the UI. `AbortError` from an upload
removes the entry without surfacing a failure.

Submit is disabled while managed attachments are queued/uploading unless
`allowSubmitWithPendingUploads` is set. Use the default for agent prompts that
must include attached files.

If attachments should be embedded into the final prompt, set
`attachmentTextTemplate`. String templates support `{paths}`, `{names}`,
`{count}`, and `{text}`. `payload.rawText` remains the user's original text.

## Slots

Slots accept a React node or a render function. Render functions receive
state and actions such as `submit`, `focus`, `clearText`, `clearFiles`,
`openFilePicker`, `removeFile`, `removeAttachment`, `retryAttachment`,
`submitting`, `pendingAttachmentCount`, `canStop`, and `stop`.

```tsx
<CodexChatBox
  onSubmit={sendTurn}
  slots={{
    sendButton: ({ submit, canSubmit }) => (
      <button type="button" disabled={!canSubmit} onClick={submit}>
        Send
      </button>
    ),
  }}
/>
```

## Operational Rules

- Always import `@agentmeshkit/chatbox/styles.css`.
- Use `theme="light"` for light host surfaces or `theme="auto"` to honor a
  system light preference.
- `onSubmit` may be async. With the default `clearOnSubmit={true}`, the
  component clears only after successful completion and keeps the draft on
  rejection. Use `onSubmitError(error, payload)` for failed submits.
- Submit reads the current textarea DOM value, so uncontrolled and IME input are
  supported.
- The package does not persist files, upload bytes, start Codex, or grant
  permissions. Host code owns those decisions.
- If `uploadHandler` is not set, the host must handle `payload.files`.
- If `uploadHandler` is set, prefer backend `relPath` values in
  `payload.attachments`.
- `disabled`, `loading`, and `streaming` block built-in submit and attachment
  actions. Mirror these states in custom slot controls.
- If `streaming` and `onStop` are set, the built-in send button becomes a stop
  button. Custom send slots should call `stop` when `canStop` is true.
- `clearOnSubmit` defaults to `true` (clear after success); set it to
  `"immediate"` for fire-and-forget clearing or `false` / `"never"` when the
  host wants to keep draft text/files after submit.
