import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CodexChatBox } from './CodexChatBox.js';
import type {
  AttachmentEntry,
  ChatBoxSubmitPayload,
  UploadedAttachment,
  UploadHandler,
} from './types.js';

function getTextarea(label = 'Message Codex') {
  return screen.getByLabelText(label) as HTMLTextAreaElement;
}

// Polyfill URL.createObjectURL for jsdom so chip thumbnails do not throw. The
// returned string is enough for src= assertions.
beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') {
    let counter = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: () => `blob:mock-${counter++}`,
    });
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CodexChatBox managed upload', () => {
  it('walks an entry from queued -> uploading -> uploaded', async () => {
    let resolveUpload: ((value: UploadedAttachment) => void) | null = null;
    const uploadHandler = vi.fn<UploadHandler>(() =>
      new Promise<UploadedAttachment>((resolve) => {
        resolveUpload = resolve;
      }),
    );

    render(
      <CodexChatBox onSubmit={vi.fn()} uploadHandler={uploadHandler} />,
    );

    const file = new File(['hi'], 'note.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });

    await waitFor(() => {
      expect(uploadHandler).toHaveBeenCalledTimes(1);
    });
    // Chip should reflect uploading state.
    const chip = screen.getByTestId('chatbox-attachment-0');
    expect(chip.getAttribute('data-status')).toBe('uploading');

    await act(async () => {
      resolveUpload?.({
        name: 'note.txt',
        size: 2,
        relPath: 'attachments/note.txt',
        mimeType: 'text/plain',
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      const updated = screen.getByTestId('chatbox-attachment-0');
      expect(updated.getAttribute('data-status')).toBe('uploaded');
    });
  });

  it('marks entry as error and invokes onAttachmentError on rejection', async () => {
    const uploadHandler = vi.fn<UploadHandler>(() =>
      Promise.reject(new Error('boom')),
    );
    const onAttachmentError = vi.fn();

    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        uploadHandler={uploadHandler}
        onAttachmentError={onAttachmentError}
      />,
    );

    const file = new File(['x'], 'broken.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });

    await waitFor(() => {
      const chip = screen.getByTestId('chatbox-attachment-0');
      expect(chip.getAttribute('data-status')).toBe('error');
    });
    expect(onAttachmentError).toHaveBeenCalledTimes(1);
    const [entry, error] = onAttachmentError.mock.calls[0] as [
      AttachmentEntry,
      Error,
    ];
    expect(entry.status).toBe('error');
    expect(entry.error).toBe('boom');
    expect(error.message).toBe('boom');
  });

  it('aborts the upload AbortSignal when the chip is removed', async () => {
    let observedSignal: AbortSignal | null = null;
    const uploadHandler = vi.fn<UploadHandler>(
      (_file, ctx) =>
        new Promise<UploadedAttachment>((_resolve, reject) => {
          observedSignal = ctx.signal;
          ctx.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    render(
      <CodexChatBox onSubmit={vi.fn()} uploadHandler={uploadHandler} />,
    );

    const file = new File(['x'], 'aborted.bin');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });

    await waitFor(() => {
      expect(screen.getByTestId('chatbox-attachment-0')).toBeTruthy();
    });

    const removeButton = screen.getByRole('button', { name: /Remove aborted.bin/ });
    await act(async () => {
      await userEvent.click(removeButton);
      await Promise.resolve();
    });

    expect(observedSignal?.aborted).toBe(true);
    expect(screen.queryByTestId('chatbox-attachment-0')).toBeNull();
  });

  it('retries a failed upload by re-invoking uploadHandler', async () => {
    const uploadHandler = vi
      .fn<UploadHandler>()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValue({
        name: 'retry.txt',
        size: 4,
        relPath: 'attachments/retry.txt',
      });

    render(
      <CodexChatBox onSubmit={vi.fn()} uploadHandler={uploadHandler} />,
    );

    const file = new File(['data'], 'retry.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });

    await waitFor(() => {
      const chip = screen.getByTestId('chatbox-attachment-0');
      expect(chip.getAttribute('data-status')).toBe('error');
    });

    const retry = screen.getByRole('button', { name: /Retry upload/ });
    await act(async () => {
      await userEvent.click(retry);
    });

    await waitFor(() => {
      const chip = screen.getByTestId('chatbox-attachment-0');
      expect(chip.getAttribute('data-status')).toBe('uploaded');
    });
    expect(uploadHandler).toHaveBeenCalledTimes(2);
  });

  it('renders chips for externally controlled attachments', async () => {
    const uploadHandler = vi.fn<UploadHandler>();
    function Controlled() {
      const [entries, setEntries] = useState<AttachmentEntry[]>([]);
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setEntries([
                {
                  id: 'ext-1',
                  status: 'uploaded',
                  uploaded: {
                    id: 'ext-1',
                    name: 'remote.pdf',
                    size: 100,
                    relPath: 'attachments/remote.pdf',
                    mimeType: 'application/pdf',
                  },
                  createdAt: Date.now(),
                },
              ])
            }
          >
            inject
          </button>
          <CodexChatBox
            onSubmit={vi.fn()}
            uploadHandler={uploadHandler}
            attachments={entries}
            onAttachmentsChange={setEntries}
          />
        </>
      );
    }
    render(<Controlled />);

    expect(screen.queryByText('remote.pdf')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'inject' }));
    expect(screen.getByText('remote.pdf')).toBeTruthy();
  });
});

describe('CodexChatBox attachment template', () => {
  it('renders placeholders {paths}, {names}, {count}, {text}', async () => {
    const onSubmit = vi.fn();
    const uploadHandler = vi.fn<UploadHandler>(async (file) => ({
      name: file.name,
      size: file.size,
      relPath: `uploads/${file.name}`,
      mimeType: file.type,
    }));

    render(
      <CodexChatBox
        onSubmit={onSubmit}
        uploadHandler={uploadHandler}
        defaultValue="hello"
        attachmentTextTemplate="[files: {paths} | names: {names} | count: {count}] {text}"
      />,
    );

    const file = new File(['ok'], 'a.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('chatbox-attachment-0').getAttribute('data-status'),
      ).toBe('uploaded');
    });

    fireEvent.keyDown(getTextarea(), { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0] as ChatBoxSubmitPayload;
    expect(payload.text).toBe(
      '[files: uploads/a.png | names: a.png | count: 1] hello',
    );
    expect(payload.rawText).toBe('hello');
    expect(payload.attachments).toHaveLength(1);
  });

  it('passes (attachments, text) to template function', async () => {
    const onSubmit = vi.fn();
    const template = vi.fn(
      (atts: UploadedAttachment[], text: string) =>
        `${atts.map((a) => a.name).join(',')}::${text}`,
    );
    const uploadHandler: UploadHandler = async (file) => ({
      name: file.name,
      size: file.size,
      mimeType: file.type,
    });

    render(
      <CodexChatBox
        onSubmit={onSubmit}
        uploadHandler={uploadHandler}
        defaultValue="hi"
        attachmentTextTemplate={template}
      />,
    );

    const file = new File(['ok'], 'fn.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('chatbox-attachment-0').getAttribute('data-status'),
      ).toBe('uploaded');
    });

    fireEvent.keyDown(getTextarea(), { key: 'Enter', metaKey: true });
    expect(template).toHaveBeenCalledTimes(1);
    const callArgs = template.mock.calls[0];
    expect(callArgs[0]).toHaveLength(1);
    expect(callArgs[0][0].name).toBe('fn.txt');
    expect(callArgs[1]).toBe('hi');
    const payload = onSubmit.mock.calls[0][0] as ChatBoxSubmitPayload;
    expect(payload.text).toBe('fn.txt::hi');
  });

  it('does not apply the template when no attachments are present', () => {
    const onSubmit = vi.fn();
    render(
      <CodexChatBox
        onSubmit={onSubmit}
        defaultValue="plain text"
        attachmentTextTemplate="[wrap] {text}"
      />,
    );
    fireEvent.keyDown(getTextarea(), { key: 'Enter', metaKey: true });
    const payload = onSubmit.mock.calls[0][0] as ChatBoxSubmitPayload;
    expect(payload.text).toBe('plain text');
    expect(payload.rawText).toBe('plain text');
    expect(payload.attachments).toEqual([]);
  });
});

describe('CodexChatBox drag-drop and paste', () => {
  it('accepts files dropped on the root and routes them through the picker pipeline', async () => {
    const onFilesSelected = vi.fn();
    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        onFilesSelected={onFilesSelected}
      />,
    );

    const root = screen.getByRole('form', { name: 'Composer' });
    const file = new File(['drop'], 'dropped.txt', { type: 'text/plain' });
    const data = {
      files: [file],
      items: [],
      types: ['Files'],
    } as unknown as DataTransfer;

    fireEvent.dragOver(root, { dataTransfer: data });
    expect(root.getAttribute('data-amk-dragover')).toBe('true');
    expect(screen.getByText('Drop files to attach')).toBeTruthy();
    fireEvent.drop(root, { dataTransfer: data });

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
    expect(screen.getByText('dropped.txt')).toBeTruthy();
    expect(root.getAttribute('data-amk-dragover')).toBeNull();
    expect(screen.queryByText('Drop files to attach')).toBeNull();
  });

  it('recursively expands a dropped folder before routing files through the pipeline', async () => {
    const onFilesSelected = vi.fn();
    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        onFilesSelected={onFilesSelected}
      />,
    );

    const pdf = new File(['pdf'], 'guide.pdf', { type: 'application/pdf' });
    const python = new File(['print(1)'], 'tool.py', { type: 'text/x-python' });
    const fileEntry = (file: File) => ({
      isFile: true,
      isDirectory: false,
      file: (success: (value: File) => void) => success(file),
    });
    const directoryEntry = (batches: unknown[][]) => ({
      isFile: false,
      isDirectory: true,
      createReader: () => {
        let index = 0;
        return {
          readEntries: (success: (entries: unknown[]) => void) => {
            success(batches[index++] ?? []);
          },
        };
      },
    });
    const nested = directoryEntry([[fileEntry(python)], []]);
    const rootFolder = directoryEntry([[fileEntry(pdf), nested], []]);
    const data = {
      files: [],
      items: [{
        kind: 'file',
        webkitGetAsEntry: () => rootFolder,
      }],
      types: ['Files'],
    } as unknown as DataTransfer;

    fireEvent.drop(screen.getByRole('form', { name: 'Composer' }), {
      dataTransfer: data,
    });

    await waitFor(() => expect(onFilesSelected).toHaveBeenCalledWith([pdf, python]));
    expect(screen.getByText('guide.pdf')).toBeTruthy();
    expect(screen.getByText('tool.py')).toBeTruthy();
  });

  it('clears drag-over state after repeated dragover events leave the root', () => {
    render(<CodexChatBox onSubmit={vi.fn()} onFilesSelected={vi.fn()} />);

    const root = screen.getByRole('form', { name: 'Composer' });
    const file = new File(['drop'], 'dropped.txt', { type: 'text/plain' });
    const data = {
      files: [file],
      items: [],
      types: ['Files'],
    } as unknown as DataTransfer;

    fireEvent.dragEnter(root, { dataTransfer: data });
    fireEvent.dragOver(root, { dataTransfer: data });
    fireEvent.dragOver(root, { dataTransfer: data });
    expect(root.getAttribute('data-amk-dragover')).toBe('true');

    fireEvent.dragLeave(root, { dataTransfer: data });
    expect(root.getAttribute('data-amk-dragover')).toBeNull();
  });

  it('ignores drag events that do not carry files', () => {
    render(<CodexChatBox onSubmit={vi.fn()} onFilesSelected={vi.fn()} />);
    const root = screen.getByRole('form', { name: 'Composer' });
    fireEvent.dragOver(root, {
      dataTransfer: { types: ['text/plain'], files: [] } as unknown as DataTransfer,
    });
    expect(root.getAttribute('data-amk-dragover')).toBeNull();
  });

  it('auto-attaches pasted image files', async () => {
    const onFilesSelected = vi.fn();
    render(
      <CodexChatBox onSubmit={vi.fn()} onFilesSelected={onFilesSelected} />,
    );
    const file = new File(['png'], 'paste.png', { type: 'image/png' });
    const clipboardData = {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => file,
        },
      ],
      types: ['Files'],
      files: [file],
    } as unknown as DataTransfer;
    fireEvent.paste(getTextarea(), { clipboardData });
    expect(onFilesSelected).toHaveBeenCalledWith([file]);
    expect(screen.getByText('paste.png')).toBeTruthy();
  });
});

describe('CodexChatBox i18n', () => {
  it('renders Chinese labels when locale="zh"', () => {
    render(<CodexChatBox onSubmit={vi.fn()} locale="zh" />);
    expect(screen.getByRole('form', { name: '消息输入区' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '上传附件' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '发送消息' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('说点什么…')).toBeTruthy();
  });

  it('shallow-merges labels overrides on top of the chosen locale', () => {
    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        locale="zh"
        labels={{ send: '提交' }}
      />,
    );
    expect(screen.getByRole('button', { name: '提交' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '上传附件' })).toBeTruthy();
  });
});

describe('CodexChatBox validation', () => {
  it('rejects files exceeding maxFileSize and triggers onAttachmentError', async () => {
    const onAttachmentError = vi.fn();
    const uploadHandler = vi.fn<UploadHandler>();
    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        uploadHandler={uploadHandler}
        maxFileSize={4}
        onAttachmentError={onAttachmentError}
      />,
    );

    const tooBig = new File(['1234567890'], 'big.bin');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, tooBig);
    });

    expect(uploadHandler).not.toHaveBeenCalled();
    expect(onAttachmentError).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('chatbox-attachment-0')).toBeNull();
    expect(screen.getByTestId('chatbox-validation-toast').textContent).toContain(
      'File too large',
    );
  });

  it('rejects files exceeding maxFiles cap', async () => {
    const onAttachmentError = vi.fn();
    const uploadHandler = vi.fn<UploadHandler>(async (file) => ({
      name: file.name,
      size: file.size,
    }));
    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        uploadHandler={uploadHandler}
        maxFiles={1}
        onAttachmentError={onAttachmentError}
      />,
    );

    const a = new File(['a'], 'a.txt');
    const b = new File(['b'], 'b.txt');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, [a, b]);
    });

    await waitFor(() => {
      expect(onAttachmentError).toHaveBeenCalled();
    });
    expect(uploadHandler).toHaveBeenCalledTimes(1);
    expect(uploadHandler.mock.calls[0][0]).toBe(a);
    expect(screen.queryByText('b.txt')).toBeNull();
  });

  it('applies maxFileSize validation to local files without uploadHandler', async () => {
    const onAttachmentError = vi.fn();
    const onFilesChange = vi.fn();
    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        maxFileSize={3}
        onFilesChange={onFilesChange}
        onAttachmentError={onAttachmentError}
      />,
    );

    const tooBig = new File(['1234'], 'local-big.txt', { type: 'text/plain' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, tooBig);
    });

    expect(onFilesChange).not.toHaveBeenCalled();
    expect(onAttachmentError).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('local-big.txt')).toBeNull();
    expect(screen.getByTestId('chatbox-validation-toast').textContent).toContain(
      'File too large',
    );
  });

  it('applies accept validation to dropped files', () => {
    const onFilesChange = vi.fn();
    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        accept=".png"
        onFilesChange={onFilesChange}
      />,
    );

    const root = screen.getByRole('form', { name: 'Composer' });
    const file = new File(['txt'], 'notes.txt', { type: 'text/plain' });
    const data = {
      files: [file],
      items: [],
      types: ['Files'],
    } as unknown as DataTransfer;

    fireEvent.drop(root, { dataTransfer: data });

    expect(onFilesChange).not.toHaveBeenCalled();
    expect(screen.queryByText('notes.txt')).toBeNull();
    expect(screen.getByTestId('chatbox-validation-toast').textContent).toContain(
      'File type not accepted',
    );
  });
});

describe('CodexChatBox submit lifecycle', () => {
  it('keeps the draft and reports onSubmitError when async submit rejects', async () => {
    const user = userEvent.setup();
    let rejectSubmit: ((error: Error) => void) | null = null;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSubmit = reject;
        }),
    );
    const onSubmitError = vi.fn();

    render(
      <CodexChatBox
        defaultValue="do not lose this"
        onSubmit={onSubmit}
        onSubmitError={onSubmitError}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Send' }));
    const root = screen.getByRole('form', { name: 'Composer' });
    expect(root.getAttribute('data-submitting')).toBe('');
    expect(getTextarea()).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toContain('Submitting');

    await act(async () => {
      rejectSubmit?.(new Error('network down'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onSubmitError).toHaveBeenCalledTimes(1);
    });
    expect(onSubmitError.mock.calls[0][0].message).toBe('network down');
    expect(getTextarea().value).toBe('do not lose this');
    expect(getTextarea()).toHaveProperty('disabled', false);
  });

  it('blocks submit while managed attachments are still uploading', async () => {
    const onSubmit = vi.fn();
    const uploadHandler: UploadHandler = () =>
      new Promise<UploadedAttachment>(() => undefined);

    render(
      <CodexChatBox
        defaultValue="use the screenshot"
        onSubmit={onSubmit}
        uploadHandler={uploadHandler}
      />,
    );

    const file = new File(['png'], 'pending.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('chatbox-attachment-0').getAttribute('data-status'),
      ).toBe('uploading');
    });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.keyDown(getTextarea(), { key: 'Enter', metaKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('chatbox-validation-toast').textContent).toContain(
      'Wait for 1 attachment',
    );
  });

  it('can render a stop button while streaming', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();

    render(
      <CodexChatBox
        defaultValue="running"
        streaming
        onStop={onStop}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe('CodexChatBox backward compatibility', () => {
  it('keeps legacy files + onFilesSelected pipeline when no uploadHandler is provided', async () => {
    const onFilesSelected = vi.fn();
    const onFilesChange = vi.fn();
    const file = new File(['legacy'], 'legacy.md', { type: 'text/markdown' });

    render(
      <CodexChatBox
        onSubmit={vi.fn()}
        onFilesSelected={onFilesSelected}
        onFilesChange={onFilesChange}
      />,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
    expect(onFilesChange).toHaveBeenCalledWith([file]);
    expect(screen.getByText('legacy.md')).toBeTruthy();
    // No managed-attachment chip should exist (no uploadHandler).
    expect(screen.queryByTestId('chatbox-attachment-0')).toBeNull();
  });
});

describe('CodexChatBox image preview', () => {
  it('caches local image object URLs across rerenders', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:preview-cache');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const uploadHandler: UploadHandler = () =>
      new Promise<UploadedAttachment>(() => undefined);

    render(<CodexChatBox onSubmit={vi.fn()} uploadHandler={uploadHandler} />);
    const file = new File(['png'], 'cached.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });

    await waitFor(() => {
      const chip = screen.getByTestId('chatbox-attachment-0');
      const img = chip.querySelector('img.amk-chatbox__chip-thumb');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(img?.getAttribute('src')).toBe('blob:preview-cache');
    });

    fireEvent.change(getTextarea(), { target: { value: 'same attachment' } });

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('releases cached local image object URLs when the attachment is removed', async () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:preview-release');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const uploadHandler: UploadHandler = (_file, ctx) =>
      new Promise<UploadedAttachment>((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });

    render(<CodexChatBox onSubmit={vi.fn()} uploadHandler={uploadHandler} />);
    const file = new File(['png'], 'remove.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /Remove remove.png/ }),
      );
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-release');
    expect(screen.queryByTestId('chatbox-attachment-0')).toBeNull();
  });

  it('renders an <img> thumbnail for image-typed managed entries', async () => {
    const uploadHandler: UploadHandler = async (file) => ({
      name: file.name,
      size: file.size,
      mimeType: file.type,
      url: 'https://example.com/img.png',
    });

    render(<CodexChatBox onSubmit={vi.fn()} uploadHandler={uploadHandler} />);
    const file = new File(['png'], 'pic.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('chatbox-attachment-0').getAttribute('data-status'),
      ).toBe('uploaded');
    });
    const chip = screen.getByTestId('chatbox-attachment-0');
    const img = chip.querySelector('img.amk-chatbox__chip-thumb');
    expect(img).toBeTruthy();
    expect((img as HTMLImageElement).src).toBe('https://example.com/img.png');
  });

  it('renders an extension badge for non-image entries', async () => {
    const uploadHandler: UploadHandler = async (file) => ({
      name: file.name,
      size: file.size,
      mimeType: file.type,
    });
    render(<CodexChatBox onSubmit={vi.fn()} uploadHandler={uploadHandler} />);
    const file = new File(['x'], 'docs.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(input, file);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('chatbox-attachment-0').getAttribute('data-status'),
      ).toBe('uploaded');
    });
    const chip = screen.getByTestId('chatbox-attachment-0');
    expect(chip.querySelector('.amk-chatbox__chip-badge')?.textContent).toBe('PDF');
  });
});
