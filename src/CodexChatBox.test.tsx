import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CodexChatBox } from './CodexChatBox.js';
import type { ChatBoxSubmitPayload } from './types.js';

function getTextarea() {
  return screen.getByLabelText('Message') as HTMLTextAreaElement;
}

describe('CodexChatBox', () => {
  it('submits uncontrolled text with Cmd/Ctrl+Enter and clears after submit', () => {
    const onSubmit = vi.fn();
    render(
      <CodexChatBox
        defaultValue="hello agent"
        model="gpt-5"
        accessMode="full-access"
        metadata={{ source: 'test' }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.keyDown(getTextarea(), { key: 'Enter', metaKey: true });

    expect(onSubmit).toHaveBeenCalledWith({
      text: 'hello agent',
      files: [],
      model: 'gpt-5',
      accessMode: 'full-access',
      metadata: { source: 'test' },
    });
    expect(getTextarea().value).toBe('');
  });

  it('supports controlled text', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    function Controlled() {
      const [text, setText] = useState('start');
      return <CodexChatBox value={text} onChange={setText} onSubmit={onSubmit} />;
    }

    render(<Controlled />);
    const textarea = getTextarea();
    await user.clear(textarea);
    await user.type(textarea, 'controlled value');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'controlled value' }),
    );
    expect(textarea.value).toBe('');
  });

  it('does not submit while composing text with an IME', () => {
    const onSubmit = vi.fn();
    render(<CodexChatBox defaultValue="正在输入" onSubmit={onSubmit} />);

    const textarea = getTextarea();
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('lets Shift+Enter create a newline without submitting', () => {
    const onSubmit = vi.fn();
    render(<CodexChatBox defaultValue="line one" onSubmit={onSubmit} />);

    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders attachment chips, removes files, and submits remaining files', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const removed = vi.fn();
    const keep = new File(['keep'], 'keep.txt', { type: 'text/plain' });
    const remove = new File(['remove'], 'remove.txt', { type: 'text/plain' });

    render(
      <CodexChatBox
        defaultValue="with files"
        defaultFiles={[keep, remove]}
        onFileRemove={removed}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove remove.txt' }));
    expect(removed).toHaveBeenCalledWith(remove, 1);

    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const payload = onSubmit.mock.calls[0][0] as ChatBoxSubmitPayload;
    expect(payload.text).toBe('with files');
    expect(payload.files).toEqual([keep]);
  });

  it('adds files selected from the picker without uploading them', async () => {
    const user = userEvent.setup();
    const onFilesSelected = vi.fn();
    const onFilesChange = vi.fn();
    const file = new File(['content'], 'local.md', { type: 'text/markdown' });

    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        onFilesSelected={onFilesSelected}
        onFilesChange={onFilesChange}
      />,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
    expect(onFilesChange).toHaveBeenCalledWith([file]);
    expect(screen.getByText('local.md')).toBeTruthy();
  });

  it('renders slot controls with state and actions', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    const slotRender = render(
      <CodexChatBox
        defaultValue="slot text"
        onSubmit={onSubmit}
        slots={{
          leftTools: <button type="button">Tool</button>,
          modelSelector: ({ model }) => <span>model:{model}</span>,
          accessModeSelector: ({ accessMode }) => <span>access:{accessMode}</span>,
          voiceButton: <button type="button">Voice</button>,
          loadingIndicator: <span>Working</span>,
          sendButton: ({ submit, canSubmit }) => (
            <button type="button" disabled={!canSubmit} onClick={submit}>
              Custom send
            </button>
          ),
        }}
        loading
        model="gpt-5"
        accessMode="read-only"
      />,
    );

    expect(screen.getByText('Tool')).toBeTruthy();
    expect(screen.getByText('model:gpt-5')).toBeTruthy();
    expect(screen.getByText('access:read-only')).toBeTruthy();
    expect(screen.getByText('Voice')).toBeTruthy();
    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Custom send' })).toHaveProperty(
      'disabled',
      true,
    );

    slotRender.unmount();
    render(
      <CodexChatBox
        defaultValue="slot text"
        onSubmit={onSubmit}
        slots={{
          sendButton: ({ submit }) => (
            <button type="button" onClick={submit}>
              Custom submit
            </button>
          ),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Custom submit' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ text: 'slot text' }));
  });
});
