import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { AttachmentChip } from './AttachmentChip.js';
import { resolveLabels } from './labels.js';
import {
  applyAttachmentTemplate,
  createEntryId,
  entriesEqual,
  makeQueuedEntry,
} from './upload-state.js';
import { useUploadRunner } from './useUploadRunner.js';
import type {
  AttachmentEntry,
  ChatBoxRenderContext,
  ChatBoxSlot,
  CodexChatBoxProps,
  UploadedAttachment,
} from './types.js';

const DEFAULT_PLACEHOLDER = 'Message Codex';
const DEFAULT_MAX_TEXTAREA_HEIGHT = 220;
const DEFAULT_MAX_CONCURRENT_UPLOADS = 4;
const ERROR_TOAST_LIFETIME_MS = 3000;

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKey(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function renderSlot(slot: ChatBoxSlot | undefined, context: ChatBoxRenderContext) {
  if (typeof slot === 'function') return slot(context);
  return slot;
}

export function CodexChatBox({
  value,
  defaultValue = '',
  onChange,
  onSubmit,
  files,
  defaultFiles = [],
  onFilesChange,
  onFilesSelected,
  onFileRemove,
  attachments,
  defaultAttachments = [],
  onAttachmentsChange,
  onAttachmentError,
  uploadHandler,
  maxConcurrentUploads = DEFAULT_MAX_CONCURRENT_UPLOADS,
  maxFileSize,
  maxFiles,
  attachmentTextTemplate,
  model,
  defaultModel,
  modelOptions,
  onModelChange,
  accessMode,
  defaultAccessMode,
  accessModeOptions,
  onAccessModeChange,
  metadata,
  slots,
  disabled = false,
  loading = false,
  streaming = false,
  className,
  textareaClassName,
  placeholder = DEFAULT_PLACEHOLDER,
  accept,
  multiple = true,
  allowAttachments = true,
  clearOnSubmit = true,
  autoResize = true,
  maxTextareaHeight = DEFAULT_MAX_TEXTAREA_HEIGHT,
  locale,
  labels,
  id,
  rows = 2,
  style,
  onKeyDown,
  ...textareaProps
}: CodexChatBoxProps) {
  const resolvedLabels = useMemo(() => resolveLabels(locale, labels), [locale, labels]);
  const generatedId = useId();
  const textareaId = id ?? `amk-chatbox-${generatedId}`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);

  const isTextControlled = value !== undefined;
  const [internalText, setInternalText] = useState(defaultValue);
  const renderedText = isTextControlled ? value : internalText;
  const [domText, setDomText] = useState(renderedText);

  const areFilesControlled = files !== undefined;
  const [internalFiles, setInternalFiles] = useState<File[]>(defaultFiles);
  const currentFiles = areFilesControlled ? files : internalFiles;

  const isUploadManaged = Boolean(uploadHandler);
  const areAttachmentsControlled = attachments !== undefined;
  const [internalAttachments, setInternalAttachments] =
    useState<AttachmentEntry[]>(defaultAttachments);
  const currentAttachments = areAttachmentsControlled ? attachments : internalAttachments;

  const isModelControlled = model !== undefined;
  const [internalModel, setInternalModel] = useState(
    defaultModel ?? modelOptions?.[0]?.value,
  );
  const currentModel = isModelControlled ? model : internalModel;

  const isAccessModeControlled = accessMode !== undefined;
  const [internalAccessMode, setInternalAccessMode] = useState(
    defaultAccessMode ?? accessModeOptions?.[0]?.value,
  );
  const currentAccessMode = isAccessModeControlled ? accessMode : internalAccessMode;

  const [validationError, setValidationError] = useState<string | null>(null);
  const validationToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashValidationError = useCallback((message: string) => {
    setValidationError(message);
    if (validationToastTimer.current) {
      clearTimeout(validationToastTimer.current);
    }
    validationToastTimer.current = setTimeout(() => {
      setValidationError(null);
      validationToastTimer.current = null;
    }, ERROR_TOAST_LIFETIME_MS);
  }, []);
  useEffect(
    () => () => {
      if (validationToastTimer.current) {
        clearTimeout(validationToastTimer.current);
      }
    },
    [],
  );

  // Track AbortControllers and thumbnail object URLs by entry id. These refs
  // are intentionally not React state because they are bookkeeping only.
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const objectUrlsRef = useRef(new Map<string, string>());

  // Mirror entries to a ref so async upload runners can read the current
  // state without re-binding callbacks on every render.
  const attachmentsRef = useRef<AttachmentEntry[]>(currentAttachments);
  useEffect(() => {
    attachmentsRef.current = currentAttachments;
  }, [currentAttachments]);

  const isBusy = disabled || loading || streaming;
  const hasText = domText.trim().length > 0;
  const hasUploadedAttachment = currentAttachments.some(
    (entry) => entry.status === 'uploaded',
  );
  const canSubmit =
    !isBusy &&
    (hasText || currentFiles.length > 0 || hasUploadedAttachment);

  const syncTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !autoResize) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxTextareaHeight)}px`;
  }, [autoResize, maxTextareaHeight]);

  useLayoutEffect(() => {
    syncTextareaHeight();
  }, [renderedText, syncTextareaHeight]);

  useEffect(() => {
    setDomText(renderedText);
  }, [renderedText]);

  useEffect(() => {
    if (!isModelControlled && !internalModel && modelOptions?.[0]) {
      setInternalModel(modelOptions[0].value);
    }
  }, [internalModel, isModelControlled, modelOptions]);

  useEffect(() => {
    if (!isAccessModeControlled && !internalAccessMode && accessModeOptions?.[0]) {
      setInternalAccessMode(accessModeOptions[0].value);
    }
  }, [accessModeOptions, internalAccessMode, isAccessModeControlled]);

  const setText = useCallback(
    (nextText: string, event?: ChangeEvent<HTMLTextAreaElement>) => {
      if (!isTextControlled) setInternalText(nextText);
      onChange?.(nextText, event);
    },
    [isTextControlled, onChange],
  );

  const setFileList = useCallback(
    (nextFiles: File[]) => {
      if (!areFilesControlled) setInternalFiles(nextFiles);
      onFilesChange?.(nextFiles);
    },
    [areFilesControlled, onFilesChange],
  );

  const setAttachmentList = useCallback(
    (
      updater:
        | AttachmentEntry[]
        | ((prev: AttachmentEntry[]) => AttachmentEntry[]),
    ) => {
      const prev = attachmentsRef.current;
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (entriesEqual(prev, next)) return;
      attachmentsRef.current = next;
      if (!areAttachmentsControlled) setInternalAttachments(next);
      onAttachmentsChange?.(next);
    },
    [areAttachmentsControlled, onAttachmentsChange],
  );

  const setSelectedModel = useCallback(
    (nextModel: string) => {
      if (!isModelControlled) setInternalModel(nextModel);
      onModelChange?.(nextModel);
    },
    [isModelControlled, onModelChange],
  );

  const setSelectedAccessMode = useCallback(
    (nextAccessMode: string) => {
      if (!isAccessModeControlled) setInternalAccessMode(nextAccessMode);
      onAccessModeChange?.(nextAccessMode);
    },
    [isAccessModeControlled, onAccessModeChange],
  );

  const focus = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const clearText = useCallback(() => {
    if (textareaRef.current) textareaRef.current.value = '';
    setDomText('');
    setText('');
  }, [setText]);

  const clearFiles = useCallback(() => {
    setFileList([]);
    setAttachmentList([]);
  }, [setFileList, setAttachmentList]);

  const removeFile = useCallback(
    (index: number) => {
      const file = currentFiles[index];
      if (!file) return;
      const nextFiles = currentFiles.filter((_, i) => i !== index);
      setFileList(nextFiles);
      onFileRemove?.(file, index);
    },
    [currentFiles, onFileRemove, setFileList],
  );

  const releaseObjectUrl = useCallback((id: string) => {
    const url = objectUrlsRef.current.get(id);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // jsdom may not implement revokeObjectURL; ignore.
      }
      objectUrlsRef.current.delete(id);
    }
  }, []);

  const abortEntry = useCallback((id: string) => {
    const controller = abortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(id);
    }
  }, []);

  const removeAttachment = useCallback(
    (entryId: string) => {
      const target = attachmentsRef.current.find((entry) => entry.id === entryId);
      if (!target) return;
      abortEntry(entryId);
      releaseObjectUrl(entryId);
      setAttachmentList((prev) => prev.filter((entry) => entry.id !== entryId));
    },
    [abortEntry, releaseObjectUrl, setAttachmentList],
  );

  const retryAttachment = useCallback(
    (entryId: string) => {
      setAttachmentList((prev) =>
        prev.map((entry) =>
          entry.id === entryId && entry.status === 'error' && entry.file
            ? {
                ...entry,
                status: 'queued' as const,
                error: undefined,
                progress: undefined,
              }
            : entry,
        ),
      );
    },
    [setAttachmentList],
  );

  /**
   * Push a list of File objects through the managed-upload pipeline. Enforces
   * per-file size limit and the total cap, surfaces rejections through
   * onAttachmentError, and seeds queued entries that the runner will pick up
   * on the next render.
   */
  const enqueueFiles = useCallback(
    (incoming: File[]): AttachmentEntry[] => {
      if (incoming.length === 0) return [];
      const accepted: AttachmentEntry[] = [];
      const existingCount = attachmentsRef.current.length;
      let remainingSlots =
        typeof maxFiles === 'number'
          ? Math.max(0, maxFiles - existingCount)
          : Number.POSITIVE_INFINITY;

      for (const file of incoming) {
        if (typeof maxFileSize === 'number' && file.size > maxFileSize) {
          const reject: AttachmentEntry = {
            id: createEntryId(),
            status: 'error',
            file,
            error: `File too large: ${file.name}`,
            createdAt: Date.now(),
          };
          onAttachmentError?.(reject, new Error(reject.error ?? 'File too large'));
          flashValidationError(reject.error ?? 'File too large');
          continue;
        }
        if (remainingSlots <= 0) {
          const reject: AttachmentEntry = {
            id: createEntryId(),
            status: 'error',
            file,
            error: `Too many files: ${file.name}`,
            createdAt: Date.now(),
          };
          onAttachmentError?.(reject, new Error(reject.error ?? 'Too many files'));
          flashValidationError(reject.error ?? 'Too many files');
          continue;
        }
        remainingSlots -= 1;
        accepted.push(makeQueuedEntry(file));
      }

      if (accepted.length > 0) {
        setAttachmentList((prev) => [...prev, ...accepted]);
      }
      return accepted;
    },
    [
      flashValidationError,
      maxFileSize,
      maxFiles,
      onAttachmentError,
      setAttachmentList,
    ],
  );

  useUploadRunner({
    isUploadManaged,
    uploadHandler,
    maxConcurrentUploads,
    attachments: currentAttachments,
    setAttachmentList,
    onAttachmentError,
    refs: {
      abortControllers: abortControllersRef,
      objectUrls: objectUrlsRef,
      attachmentsRef,
    },
  });

  // Abort all in-flight uploads and release object URLs on unmount.
  useEffect(() => {
    const controllers = abortControllersRef.current;
    const urls = objectUrlsRef.current;
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      urls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      });
      urls.clear();
    };
  }, []);

  const openFilePicker = useCallback(() => {
    if (isBusy || !allowAttachments) return;
    fileInputRef.current?.click();
  }, [allowAttachments, isBusy]);

  const resolveMetadata = useCallback(() => {
    if (typeof metadata === 'function') return metadata();
    return metadata;
  }, [metadata]);

  /** Funnel newly-picked / dropped / pasted files into the right pipeline. */
  const ingestFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      const trimmed = multiple ? incoming : incoming.slice(0, 1);
      onFilesSelected?.(trimmed);
      if (isUploadManaged) {
        enqueueFiles(trimmed);
      } else {
        setFileList(multiple ? [...currentFiles, ...trimmed] : trimmed);
      }
    },
    [
      currentFiles,
      enqueueFiles,
      isUploadManaged,
      multiple,
      onFilesSelected,
      setFileList,
    ],
  );

  const submit = useCallback(() => {
    if (isBusy) return;

    const rawTextValue = textareaRef.current?.value ?? renderedText;
    const trimmedRaw = rawTextValue.trim();
    const uploadedAttachments: UploadedAttachment[] = currentAttachments
      .filter((entry) => entry.status === 'uploaded' && entry.uploaded)
      .map((entry) => entry.uploaded as UploadedAttachment);

    if (
      !trimmedRaw &&
      currentFiles.length === 0 &&
      uploadedAttachments.length === 0
    ) {
      return;
    }

    const finalText = applyAttachmentTemplate(
      attachmentTextTemplate,
      uploadedAttachments,
      trimmedRaw,
    );

    void onSubmit({
      text: finalText,
      rawText: trimmedRaw,
      files: [...currentFiles],
      attachments: uploadedAttachments,
      model: currentModel,
      accessMode: currentAccessMode,
      metadata: resolveMetadata(),
    });

    if (clearOnSubmit) {
      if (textareaRef.current) textareaRef.current.value = '';
      setDomText('');
      setText('');
      setFileList([]);
      // Only drop uploaded entries; keep failures / in-flight for the user.
      const uploadedIds = new Set(
        currentAttachments
          .filter((entry) => entry.status === 'uploaded')
          .map((entry) => entry.id),
      );
      if (uploadedIds.size > 0) {
        uploadedIds.forEach(releaseObjectUrl);
        setAttachmentList((prev) =>
          prev.filter((entry) => !uploadedIds.has(entry.id)),
        );
      }
    }
  }, [
    attachmentTextTemplate,
    clearOnSubmit,
    currentAccessMode,
    currentAttachments,
    currentFiles,
    currentModel,
    isBusy,
    onSubmit,
    releaseObjectUrl,
    renderedText,
    resolveMetadata,
    setAttachmentList,
    setFileList,
    setText,
  ]);

  const context = useMemo<ChatBoxRenderContext>(
    () => ({
      text: domText,
      files: currentFiles,
      attachments: currentAttachments,
      model: currentModel,
      accessMode: currentAccessMode,
      disabled,
      loading,
      streaming,
      canSubmit,
      submit,
      focus,
      clearText,
      clearFiles,
      openFilePicker,
      removeFile,
      removeAttachment,
      retryAttachment,
    }),
    [
      accessMode,
      canSubmit,
      clearFiles,
      clearText,
      currentAccessMode,
      currentAttachments,
      currentFiles,
      currentModel,
      disabled,
      domText,
      focus,
      loading,
      openFilePicker,
      removeAttachment,
      removeFile,
      retryAttachment,
      streaming,
      submit,
    ],
  );

  useEffect(() => {
    if (!isTextControlled || !textareaRef.current) return;
    textareaRef.current.value = value;
  }, [isTextControlled, value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDomText(event.currentTarget.value);
    setText(event.currentTarget.value, event);
    syncTextareaHeight();
  };

  const handleCompositionStart = (_event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    setDomText(event.currentTarget.value);
    setText(event.currentTarget.value);
    syncTextareaHeight();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    const nativeEvent = event.nativeEvent as KeyboardEvent<HTMLTextAreaElement>['nativeEvent'] & {
      isComposing?: boolean;
    };
    if (composingRef.current || nativeEvent.isComposing) return;

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  const refreshDomText = () => {
    if (textareaRef.current) setDomText(textareaRef.current.value);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (selectedFiles.length === 0) return;
    ingestFiles(selectedFiles);
  };

  const dataTransferHasFiles = (transfer: DataTransfer | null): boolean => {
    if (!transfer) return false;
    const types = transfer.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i += 1) {
      if (types[i] === 'Files') return true;
    }
    return false;
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!allowAttachments || isBusy) return;
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (dragDepthRef.current === 0) {
      rootRef.current?.setAttribute('data-amk-dragover', 'true');
    }
    dragDepthRef.current += 1;
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!allowAttachments || isBusy) return;
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      rootRef.current?.removeAttribute('data-amk-dragover');
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!allowAttachments || isBusy) return;
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    rootRef.current?.removeAttribute('data-amk-dragover');
    const dropped = Array.from(event.dataTransfer?.files ?? []);
    if (dropped.length > 0) ingestFiles(dropped);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!allowAttachments || isBusy) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const pasted: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) pasted.push(file);
      }
    }
    if (pasted.length > 0) {
      event.preventDefault();
      ingestFiles(pasted);
    }
  };

  const showLoadingIndicator = loading || streaming;
  const loadingLabel = loading ? 'Loading' : streaming ? 'Streaming' : undefined;
  const textareaStyle = {
    ...style,
    '--amk-chatbox-textarea-max-height': `${maxTextareaHeight}px`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={cx('amk-chatbox', className)}
      data-disabled={disabled ? '' : undefined}
      data-loading={loading ? '' : undefined}
      data-streaming={streaming ? '' : undefined}
      role="form"
      aria-label={resolvedLabels.root}
      aria-disabled={disabled ? true : undefined}
      aria-busy={loading || streaming ? true : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {(currentFiles.length > 0 || currentAttachments.length > 0) && (
        <div className="amk-chatbox__attachments" data-testid="chatbox-attachments">
          {currentFiles.map((file, index) => (
            <span className="amk-chatbox__chip" key={fileKey(file, index)}>
              <span className="amk-chatbox__chip-name" title={file.name}>
                {file.name}
              </span>
              <span className="amk-chatbox__chip-size">{formatBytes(file.size)}</span>
              <button
                className="amk-chatbox__chip-remove"
                type="button"
                aria-label={resolvedLabels.removeFile(file)}
                onClick={() => removeFile(index)}
                disabled={isBusy}
              >
                <span aria-hidden="true">x</span>
              </button>
            </span>
          ))}
          {currentAttachments.map((entry, index) => (
            <AttachmentChip
              key={entry.id}
              entry={entry}
              index={index}
              disabled={isBusy}
              labels={resolvedLabels}
              objectUrls={objectUrlsRef.current}
              onRetry={retryAttachment}
              onRemove={removeAttachment}
            />
          ))}
        </div>
      )}

      {validationError && (
        <div
          className="amk-chatbox__validation"
          role="alert"
          data-testid="chatbox-validation-toast"
        >
          {validationError}
        </div>
      )}

      <label className="amk-chatbox__sr-only" htmlFor={textareaId}>
        {resolvedLabels.textarea}
      </label>
      <textarea
        {...textareaProps}
        ref={textareaRef}
        id={textareaId}
        className={cx('amk-chatbox__textarea', textareaClassName)}
        value={isTextControlled ? value : undefined}
        defaultValue={isTextControlled ? undefined : defaultValue}
        placeholder={placeholder}
        rows={rows}
        style={textareaStyle}
        disabled={disabled}
        aria-busy={loading || streaming ? true : undefined}
        onChange={handleChange}
        onInput={refreshDomText}
        onKeyUp={refreshDomText}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />

      <div className="amk-chatbox__toolbar">
        <div className="amk-chatbox__toolbar-left">
          {allowAttachments && (
            <>
              <input
                ref={fileInputRef}
                className="amk-chatbox__file-input"
                type="file"
                accept={accept}
                multiple={multiple}
                tabIndex={-1}
                aria-hidden="true"
                onChange={handleFileChange}
              />
              <button
                className="amk-chatbox__icon-button"
                type="button"
                aria-label={resolvedLabels.attach}
                title={resolvedLabels.attach}
                onClick={openFilePicker}
                disabled={isBusy}
              >
                <span aria-hidden="true">+</span>
              </button>
            </>
          )}
          {renderSlot(slots?.leftTools, context)}
        </div>

        <div className="amk-chatbox__toolbar-right">
          {showLoadingIndicator && (
            <div className="amk-chatbox__loading" role="status" aria-live="polite">
              {renderSlot(slots?.loadingIndicator, context) ?? (
                <>
                  <span className="amk-chatbox__spinner" aria-hidden="true" />
                  <span>{loadingLabel}</span>
                </>
              )}
            </div>
          )}

          {renderSlot(slots?.modelSelector, context) ??
            (modelOptions && modelOptions.length > 0 ? (
              <select
                className="amk-chatbox__select"
                aria-label={resolvedLabels.model}
                value={currentModel ?? ''}
                disabled={isBusy}
                onChange={(event) => setSelectedModel(event.currentTarget.value)}
              >
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : currentModel ? (
              <span className="amk-chatbox__pill">{currentModel}</span>
            ) : null)}

          {renderSlot(slots?.accessModeSelector, context) ??
            (accessModeOptions && accessModeOptions.length > 0 ? (
              <select
                className="amk-chatbox__select"
                aria-label={resolvedLabels.accessMode}
                value={currentAccessMode ?? ''}
                disabled={isBusy}
                onChange={(event) => setSelectedAccessMode(event.currentTarget.value)}
              >
                {accessModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : currentAccessMode ? (
              <span className="amk-chatbox__pill">{currentAccessMode}</span>
            ) : null)}

          {renderSlot(slots?.voiceButton, context)}

          {renderSlot(slots?.sendButton, context) ?? (
            <button
              className="amk-chatbox__send"
              type="button"
              aria-label={resolvedLabels.send}
              title={resolvedLabels.send}
              disabled={!canSubmit}
              onClick={submit}
            >
              <span aria-hidden="true">↑</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const AgentChatBox = CodexChatBox;
