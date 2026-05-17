import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type {
  ChatBoxRenderContext,
  ChatBoxSlot,
  CodexChatBoxProps,
} from './types.js';

const DEFAULT_PLACEHOLDER = 'Message Codex';
const DEFAULT_MAX_TEXTAREA_HEIGHT = 220;

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
  labels,
  id,
  rows = 2,
  style,
  onKeyDown,
  ...textareaProps
}: CodexChatBoxProps) {
  const generatedId = useId();
  const textareaId = id ?? `amk-chatbox-${generatedId}`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);

  const isTextControlled = value !== undefined;
  const [internalText, setInternalText] = useState(defaultValue);
  const renderedText = isTextControlled ? value : internalText;
  const [domText, setDomText] = useState(renderedText);

  const areFilesControlled = files !== undefined;
  const [internalFiles, setInternalFiles] = useState<File[]>(defaultFiles);
  const currentFiles = areFilesControlled ? files : internalFiles;

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

  const isBusy = disabled || loading || streaming;
  const hasText = domText.trim().length > 0;
  const canSubmit = !isBusy && (hasText || currentFiles.length > 0);

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
  }, [setFileList]);

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

  const openFilePicker = useCallback(() => {
    if (isBusy || !allowAttachments) return;
    fileInputRef.current?.click();
  }, [allowAttachments, isBusy]);

  const resolveMetadata = useCallback(() => {
    if (typeof metadata === 'function') return metadata();
    return metadata;
  }, [metadata]);

  const submit = useCallback(() => {
    if (isBusy) return;

    const rawText = textareaRef.current?.value ?? renderedText;
    const text = rawText.trim();
    if (!text && currentFiles.length === 0) return;

    void onSubmit({
      text,
      files: [...currentFiles],
      model: currentModel,
      accessMode: currentAccessMode,
      metadata: resolveMetadata(),
    });

    if (clearOnSubmit) {
      if (textareaRef.current) textareaRef.current.value = '';
      setDomText('');
      setText('');
      setFileList([]);
    }
  }, [
    clearOnSubmit,
    currentAccessMode,
    currentFiles,
    currentModel,
    isBusy,
    onSubmit,
    renderedText,
    resolveMetadata,
    setFileList,
    setText,
  ]);

  const context = useMemo<ChatBoxRenderContext>(
    () => ({
      text: domText,
      files: currentFiles,
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
    }),
    [
      domText,
      currentFiles,
      currentModel,
      currentAccessMode,
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

    const nextSelectedFiles = multiple ? selectedFiles : selectedFiles.slice(0, 1);
    onFilesSelected?.(nextSelectedFiles);
    setFileList(multiple ? [...currentFiles, ...nextSelectedFiles] : nextSelectedFiles);
  };

  const showLoadingIndicator = loading || streaming;
  const loadingLabel = loading ? 'Loading' : streaming ? 'Streaming' : undefined;
  const textareaStyle = {
    ...style,
    '--amk-chatbox-textarea-max-height': `${maxTextareaHeight}px`,
  } as CSSProperties;

  return (
    <div
      className={cx('amk-chatbox', className)}
      data-disabled={disabled ? '' : undefined}
      data-loading={loading ? '' : undefined}
      data-streaming={streaming ? '' : undefined}
      role="form"
      aria-label={labels?.root ?? 'Chat input'}
      aria-disabled={disabled ? true : undefined}
      aria-busy={loading || streaming ? true : undefined}
    >
      {currentFiles.length > 0 && (
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
                aria-label={labels?.removeFile?.(file) ?? `Remove ${file.name}`}
                onClick={() => removeFile(index)}
                disabled={isBusy}
              >
                <span aria-hidden="true">x</span>
              </button>
            </span>
          ))}
        </div>
      )}

      <label className="amk-chatbox__sr-only" htmlFor={textareaId}>
        {labels?.textarea ?? 'Message'}
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
                aria-label={labels?.attach ?? 'Attach files'}
                title={labels?.attach ?? 'Attach files'}
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
                aria-label={labels?.model ?? 'Model'}
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
                aria-label={labels?.accessMode ?? 'Access mode'}
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
              aria-label={labels?.send ?? 'Send message'}
              title={labels?.send ?? 'Send message'}
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
