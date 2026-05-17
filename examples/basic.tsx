import { useMemo, useState } from 'react';
import {
  CodexChatBox,
  type ChatBoxSubmitPayload,
  type UploadHandler,
} from '@agentmeshkit/chatbox';
import '@agentmeshkit/chatbox/styles.css';

export function BasicChatBoxExample() {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastPayload, setLastPayload] = useState<ChatBoxSubmitPayload | null>(null);

  const metadata = useMemo(
    () => ({
      host: 'example',
      surface: 'basic-chatbox',
    }),
    [],
  );

  const submit = async (payload: ChatBoxSubmitPayload) => {
    setBusy(true);
    setLastPayload(payload);
    await Promise.resolve();
    setBusy(false);
  };

  return (
    <section aria-label="Basic chatbox example">
      <CodexChatBox
        value={text}
        onChange={setText}
        files={files}
        onFilesChange={setFiles}
        onFileRemove={(file) => {
          console.info('Removed file', file.name);
        }}
        onSubmit={submit}
        loading={busy}
        modelOptions={[
          { value: 'gpt-5', label: 'GPT-5' },
          { value: 'gpt-5-mini', label: 'GPT-5 mini' },
        ]}
        defaultModel="gpt-5"
        accessModeOptions={[
          { value: 'read-only', label: 'Read only' },
          { value: 'workspace-write', label: 'Workspace write' },
        ]}
        defaultAccessMode="read-only"
        metadata={metadata}
        slots={{
          sendButton: ({ submit: submitFromSlot, canSubmit }) => (
            <button type="button" disabled={!canSubmit} onClick={submitFromSlot}>
              Send
            </button>
          ),
        }}
      />
      {lastPayload && (
        <output aria-label="Last submitted message">
          {lastPayload.text || `${lastPayload.files.length} file(s)`}
        </output>
      )}
    </section>
  );
}

// Demonstrates the managed-upload pipeline plus the attachment text template.
// The chatbox handles queueing, status, abort, and retry on its own; the host
// only implements `uploadFile` and renders the resulting payload.
export function ManagedUploadChatBoxExample() {
  const [last, setLast] = useState<ChatBoxSubmitPayload | null>(null);

  const uploadFile: UploadHandler = async (file, { signal, reportProgress }) => {
    // Pretend the server is at /api/attachments. Real impl would `await fetch(...)`.
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/attachments', { method: 'POST', body, signal });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = (await res.json()) as { relPath: string; url?: string };
    reportProgress?.(1);
    return {
      name: file.name,
      size: file.size,
      mimeType: file.type,
      relPath: data.relPath,
      url: data.url,
    };
  };

  return (
    <section aria-label="Managed upload chatbox example">
      <CodexChatBox
        onSubmit={async (payload) => setLast(payload)}
        uploadHandler={uploadFile}
        maxFileSize={20 * 1024 * 1024}
        maxFiles={6}
        attachmentTextTemplate="[attachments: {paths}]\n{text}"
        locale="en"
        modelOptions={[
          { value: 'gpt-5', label: 'GPT-5' },
          { value: 'gpt-5-mini', label: 'GPT-5 mini' },
        ]}
        defaultModel="gpt-5"
      />
      {last && (
        <pre aria-label="Last submitted payload">
          {JSON.stringify(
            {
              text: last.text,
              rawText: last.rawText,
              attachments: last.attachments.map((a) => a.relPath ?? a.name),
            },
            null,
            2,
          )}
        </pre>
      )}
    </section>
  );
}
