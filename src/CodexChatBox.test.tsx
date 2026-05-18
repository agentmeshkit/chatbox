import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CodexChatBox } from './CodexChatBox.js';
import type { ChatBoxSubmitPayload } from './types.js';

function getTextarea() {
  return screen.getByLabelText('Message Codex') as HTMLTextAreaElement;
}

describe('CodexChatBox', () => {
  it('keeps the stylesheet available through the package export map', () => {
    const packageJsonPath = resolve(process.cwd(), 'package.json');
    const stylesPath = resolve(process.cwd(), 'src/styles.css');
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, 'utf8'),
    ) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports['./styles.css']).toBe('./dist/styles.css');
    expect(existsSync(stylesPath)).toBe(true);
    const stylesheet = readFileSync(stylesPath, 'utf8');
    expect(stylesheet).toContain('.amk-chatbox');
    expect(stylesheet).not.toContain(':root');
    expect(stylesheet).toContain(".amk-chatbox[data-theme='light']");
    expect(stylesheet).toContain(".amk-chatbox[data-theme='auto']");
    expect(stylesheet).toContain('.amk-chatbox .amk-chatbox__textarea:focus');
    expect(stylesheet).toContain('box-shadow: none;');
  });

  it('sets the theme on the chatbox root', () => {
    render(<CodexChatBox onSubmit={vi.fn()} theme="light" />);

    expect(screen.getByRole('form', { name: 'Composer' }).getAttribute('data-theme')).toBe(
      'light',
    );
  });

  it('supports auto theme selection on the chatbox root', () => {
    render(<CodexChatBox onSubmit={vi.fn()} theme="auto" />);

    expect(screen.getByRole('form', { name: 'Composer' }).getAttribute('data-theme')).toBe(
      'auto',
    );
  });

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
      rawText: 'hello agent',
      files: [],
      attachments: [],
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
    await user.click(screen.getByRole('button', { name: 'Send' }));

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

  it('exposes submit state to a custom sendButton slot', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <CodexChatBox
        onSubmit={onSubmit}
        slots={{
          sendButton: ({ submit, canSubmit, text }) => (
            <button type="button" disabled={!canSubmit} onClick={submit}>
              {canSubmit ? `Send ${text.trim()}` : 'Cannot send'}
            </button>
          ),
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cannot send' })).toHaveProperty(
      'disabled',
      true,
    );

    await user.type(getTextarea(), 'hello slot');
    await user.click(screen.getByRole('button', { name: 'Send hello slot' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello slot' }));
  });

  it('blocks controls and submission while disabled', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <CodexChatBox
        defaultValue="blocked"
        disabled
        modelOptions={[{ value: 'gpt-5', label: 'GPT-5' }]}
        onSubmit={onSubmit}
      />,
    );

    const root = screen.getByRole('form', { name: 'Composer' });
    expect(root.getAttribute('data-disabled')).toBe('');
    expect(root.getAttribute('aria-disabled')).toBe('true');
    expect(getTextarea()).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Attach file' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.keyDown(getTextarea(), { key: 'Enter', metaKey: true });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('marks loading as busy and prevents submission', () => {
    const onSubmit = vi.fn();

    render(<CodexChatBox defaultValue="wait" loading onSubmit={onSubmit} />);

    const root = screen.getByRole('form', { name: 'Composer' });
    expect(root.getAttribute('data-loading')).toBe('');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(getTextarea().getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect(screen.getByRole('button', { name: 'Attach file' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.keyDown(getTextarea(), { key: 'Enter', metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('marks streaming as busy and prevents submission', () => {
    const onSubmit = vi.fn();

    render(<CodexChatBox defaultValue="wait" streaming onSubmit={onSubmit} />);

    const root = screen.getByRole('form', { name: 'Composer' });
    expect(root.getAttribute('data-streaming')).toBe('');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Streaming');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.keyDown(getTextarea(), { key: 'Enter', metaKey: true });
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

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const payload = onSubmit.mock.calls[0][0] as ChatBoxSubmitPayload;
    expect(payload.text).toBe('with files');
    expect(payload.files).toEqual([keep]);
  });

  it('calls file removal hooks for controlled files', async () => {
    const user = userEvent.setup();
    const removed = vi.fn();
    const onFilesChange = vi.fn();
    const keep = new File(['keep'], 'keep.txt', { type: 'text/plain' });
    const remove = new File(['remove'], 'remove.txt', { type: 'text/plain' });

    function ControlledFiles() {
      const [files, setFiles] = useState([keep, remove]);
      return (
        <CodexChatBox
          files={files}
          onFilesChange={(nextFiles) => {
            onFilesChange(nextFiles);
            setFiles(nextFiles);
          }}
          onFileRemove={removed}
          onSubmit={vi.fn()}
        />
      );
    }

    render(<ControlledFiles />);

    await user.click(screen.getByRole('button', { name: 'Remove remove.txt' }));

    expect(removed).toHaveBeenCalledWith(remove, 1);
    expect(onFilesChange).toHaveBeenCalledWith([keep]);
    expect(screen.queryByText('remove.txt')).toBeNull();
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

  it('opens an attachment menu from the plus button', async () => {
    const user = userEvent.setup();
    render(<CodexChatBox onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Attach file' }));

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Add files or photos' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Add folder' })).toBeTruthy();
  });

  it('routes attachment menu actions to file and folder pickers', async () => {
    const user = userEvent.setup();
    render(<CodexChatBox onSubmit={vi.fn()} />);

    const inputs = Array.from(
      document.querySelectorAll('input[type="file"]'),
    ) as HTMLInputElement[];
    const [fileInput, folderInput] = inputs;
    const fileClick = vi.spyOn(fileInput, 'click');
    const folderClick = vi.spyOn(folderInput, 'click');

    expect(folderInput.hasAttribute('webkitdirectory')).toBe(true);
    expect(folderInput.hasAttribute('directory')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Attach file' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add files or photos' }));
    expect(fileClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Attach file' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add folder' }));
    expect(folderClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
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
