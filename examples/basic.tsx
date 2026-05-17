import { useMemo, useState } from 'react';
import {
  CodexChatBox,
  type ChatBoxSubmitPayload,
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
