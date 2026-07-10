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
  isImageEntry,
  makeQueuedEntry,
} from './upload-state.js';
import { useUploadRunner } from './useUploadRunner.js';
import type {
  AttachmentEntry,
  ChatBoxRenderContext,
  ChatBoxSlot,
  ChatBoxSubmitPayload,
  CodexChatBoxProps,
  UploadedAttachment,
} from './types.js';

const DEFAULT_PLACEHOLDER = 'Message Codex';
const DEFAULT_MAX_TEXTAREA_HEIGHT = 220;
const DEFAULT_MAX_CONCURRENT_UPLOADS = 4;
const ERROR_TOAST_LIFETIME_MS = 3000;

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error?: string;
  readonly message?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
}

interface SpeechRecognitionWindowLike extends Window {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
}

interface DroppedFileEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (
    success: (file: File) => void,
    error?: (error: DOMException) => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: DroppedFileEntry[]) => void,
      error?: (error: DOMException) => void,
    ) => void;
  };
}

function droppedEntries(transfer: DataTransfer): DroppedFileEntry[] {
  const entries: DroppedFileEntry[] = [];
  for (let index = 0; index < transfer.items.length; index += 1) {
    const item = transfer.items[index] as DataTransferItem & {
      webkitGetAsEntry?: () => DroppedFileEntry | null;
    };
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return entries;
}

function readDroppedFile(entry: DroppedFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error('Dropped file entry is unreadable'));
      return;
    }
    entry.file(resolve, reject);
  });
}

function readDirectoryBatch(
  reader: ReturnType<NonNullable<DroppedFileEntry['createReader']>>,
): Promise<DroppedFileEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function collectDroppedEntryFiles(
  entry: DroppedFileEntry,
  files: File[],
): Promise<void> {
  if (entry.isFile) {
    files.push(await readDroppedFile(entry));
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;

  const reader = entry.createReader();
  while (true) {
    const children = await readDirectoryBatch(reader);
    if (children.length === 0) return;
    for (const child of children) {
      await collectDroppedEntryFiles(child, files);
    }
  }
}

async function collectDroppedFiles(entries: DroppedFileEntry[]): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    await collectDroppedEntryFiles(entry, files);
  }
  return files;
}

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

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    Boolean(value) &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error) return new Error(error);
  return new Error('Submit failed');
}

function appendTranscript(base: string, transcript: string): string {
  const trimmedTranscript = transcript.trim();
  if (!trimmedTranscript) return base;
  if (!base.trim()) return trimmedTranscript;
  const separator = /\s$/.test(base) ? '' : ' ';
  return `${base}${separator}${trimmedTranscript}`;
}

function collectTranscript(results: SpeechRecognitionResultListLike): string {
  let transcript = '';
  for (let index = 0; index < results.length; index += 1) {
    transcript += results[index]?.[0]?.transcript ?? '';
  }
  return transcript;
}

function acceptsFile(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) {
      const prefix = token.slice(0, -1);
      return type.startsWith(prefix);
    }
    if (token.includes('/')) return type === token;
    return name.endsWith(`.${token}`);
  });
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
  onSubmitError,
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
  allowSubmitWithPendingUploads = false,
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
  enableVoiceInput = false,
  voiceLanguage,
  onVoiceStart,
  onVoiceEnd,
  onVoiceTranscript,
  onVoiceError,
  theme,
  className,
  textareaClassName,
  placeholder = DEFAULT_PLACEHOLDER,
  accept,
  multiple = true,
  allowAttachments = true,
  clearOnSubmit = true,
  onStop,
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
  const folderInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuButtonRef = useRef<HTMLButtonElement>(null);
  const attachmentMenuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptBaseRef = useRef('');
  const composingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const attachmentMenuButtonId = `${textareaId}-attachment-menu-button`;
  const attachmentMenuId = `${textareaId}-attachment-menu`;
  const speechRecognitionConstructor = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const speechWindow = window as SpeechRecognitionWindowLike;
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  }, []);

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
  const [isSubmitting, setIsSubmitting] = useState(false);

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
  const objectUrlFilesRef = useRef(new Map<string, File>());
  const [, refreshObjectUrls] = useState(0);

  // Mirror entries to a ref so async upload runners can read the current
  // state without re-binding callbacks on every render.
  const attachmentsRef = useRef<AttachmentEntry[]>(currentAttachments);
  useEffect(() => {
    attachmentsRef.current = currentAttachments;
  }, [currentAttachments]);

  const pendingAttachmentCount = currentAttachments.filter(
    (entry) => entry.status === 'queued' || entry.status === 'uploading',
  ).length;
  const isBusy = disabled || loading || streaming || isSubmitting;
  const canUseVoiceInput =
    enableVoiceInput && !isBusy && Boolean(speechRecognitionConstructor);
  const hasText = domText.trim().length > 0;
  const hasUploadedAttachment = currentAttachments.some(
    (entry) => entry.status === 'uploaded',
  );
  const isSubmitBlockedByPendingUploads =
    pendingAttachmentCount > 0 && !allowSubmitWithPendingUploads;
  const canSubmit =
    !isBusy &&
    !isSubmitBlockedByPendingUploads &&
    (hasText || currentFiles.length > 0 || hasUploadedAttachment);
  const canStop = Boolean(onStop) && streaming && !disabled;

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
    abortControllersRef.current.forEach((controller) => controller.abort());
    abortControllersRef.current.clear();
    objectUrlsRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // jsdom may not implement revokeObjectURL; ignore.
      }
    });
    objectUrlsRef.current.clear();
    objectUrlFilesRef.current.clear();
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
    objectUrlFilesRef.current.delete(id);
  }, []);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    const files = objectUrlFilesRef.current;
    const entriesById = new Map(
      currentAttachments.map((entry) => [entry.id, entry]),
    );
    let changed = false;

    for (const [id, url] of Array.from(urls)) {
      const entry = entriesById.get(id);
      const file = entry?.file;
      const shouldKeep =
        entry !== undefined &&
        file !== undefined &&
        isImageEntry(entry) &&
        !entry.uploaded?.url &&
        files.get(id) === file;

      if (!shouldKeep) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // jsdom may not implement revokeObjectURL; ignore.
        }
        urls.delete(id);
        files.delete(id);
        changed = true;
      }
    }

    for (const entry of currentAttachments) {
      if (!entry.file || !isImageEntry(entry) || entry.uploaded?.url) {
        files.delete(entry.id);
        continue;
      }

      const cached = urls.get(entry.id);
      if (cached && files.get(entry.id) === entry.file) continue;

      if (cached) {
        try {
          URL.revokeObjectURL(cached);
        } catch {
          // jsdom may not implement revokeObjectURL; ignore.
        }
        urls.delete(entry.id);
        files.delete(entry.id);
        changed = true;
      }

      try {
        const url = URL.createObjectURL(entry.file);
        urls.set(entry.id, url);
        files.set(entry.id, entry.file);
        changed = true;
      } catch {
        urls.delete(entry.id);
        files.delete(entry.id);
      }
    }

    for (const id of Array.from(files.keys())) {
      if (!urls.has(id)) files.delete(id);
    }

    if (changed) {
      refreshObjectUrls((version) => version + 1);
    }
  }, [currentAttachments]);

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

  const rejectFile = useCallback(
    (file: File, message: string) => {
      const reject: AttachmentEntry = {
        id: createEntryId(),
        status: 'error',
        file,
        error: message,
        createdAt: Date.now(),
      };
      const error = new Error(message);
      onAttachmentError?.(reject, error);
      flashValidationError(message);
    },
    [flashValidationError, onAttachmentError],
  );

  const validateIncomingFiles = useCallback(
    (incoming: File[], existingCount: number): File[] => {
      if (incoming.length === 0) return [];
      const accepted: File[] = [];
      let remainingSlots =
        typeof maxFiles === 'number'
          ? Math.max(0, maxFiles - existingCount)
          : Number.POSITIVE_INFINITY;

      for (const file of incoming) {
        if (!acceptsFile(file, accept)) {
          rejectFile(file, resolvedLabels.invalidFileType(file));
          continue;
        }
        if (typeof maxFileSize === 'number' && file.size > maxFileSize) {
          rejectFile(file, `File too large: ${file.name}`);
          continue;
        }
        if (remainingSlots <= 0) {
          rejectFile(file, `Too many files: ${file.name}`);
          continue;
        }
        remainingSlots -= 1;
        accepted.push(file);
      }

      return accepted;
    },
    [accept, maxFileSize, maxFiles, rejectFile, resolvedLabels],
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
      const accepted = validateIncomingFiles(
        incoming,
        attachmentsRef.current.length,
      ).map(makeQueuedEntry);

      if (accepted.length > 0) {
        setAttachmentList((prev) => [...prev, ...accepted]);
      }
      return accepted;
    },
    [setAttachmentList, validateIncomingFiles],
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
      objectUrlFilesRef.current.clear();
    };
  }, []);

  const openFilePicker = useCallback(() => {
    if (isBusy || !allowAttachments) return;
    setIsAttachmentMenuOpen(false);
    fileInputRef.current?.click();
  }, [allowAttachments, isBusy]);

  const openFolderPicker = useCallback(() => {
    if (isBusy || !allowAttachments) return;
    setIsAttachmentMenuOpen(false);
    folderInputRef.current?.click();
  }, [allowAttachments, isBusy]);

  const focusAttachmentMenuItem = useCallback((index: number) => {
    const item = attachmentMenuItemRefs.current[index];
    if (item) item.focus();
  }, []);

  const openAttachmentMenu = useCallback(
    (focusIndex = 0) => {
      if (isBusy || !allowAttachments) return;
      setIsAttachmentMenuOpen(true);
      window.setTimeout(() => focusAttachmentMenuItem(focusIndex), 0);
    },
    [allowAttachments, focusAttachmentMenuItem, isBusy],
  );

  const toggleAttachmentMenu = useCallback(() => {
    if (isBusy || !allowAttachments) return;
    if (isAttachmentMenuOpen) {
      setIsAttachmentMenuOpen(false);
      return;
    }
    openAttachmentMenu();
  }, [allowAttachments, isAttachmentMenuOpen, isBusy, openAttachmentMenu]);

  const handleAttachmentButtonKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        openAttachmentMenu(0);
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        openAttachmentMenu(1);
      }
    },
    [openAttachmentMenu],
  );

  const handleAttachmentMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const items = attachmentMenuItemRefs.current.filter(
        (item): item is HTMLButtonElement => Boolean(item),
      );
      const activeIndex = items.findIndex((item) => item === document.activeElement);

      if (event.key === 'Escape') {
        event.preventDefault();
        setIsAttachmentMenuOpen(false);
        attachmentMenuButtonRef.current?.focus();
        return;
      }

      if (event.key === 'Tab') {
        setIsAttachmentMenuOpen(false);
        return;
      }

      if (items.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % items.length : 0;
        items[nextIndex]?.focus();
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const nextIndex =
          activeIndex >= 0
            ? (activeIndex - 1 + items.length) % items.length
            : items.length - 1;
        items[nextIndex]?.focus();
      }

      if (event.key === 'Home') {
        event.preventDefault();
        items[0]?.focus();
      }

      if (event.key === 'End') {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    },
    [],
  );

  useEffect(() => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    if (isBusy || !allowAttachments) {
      setIsAttachmentMenuOpen(false);
    }
  }, [allowAttachments, isBusy]);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return undefined;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const menuRoot = attachmentMenuRef.current;
      if (!(target instanceof Node) || !menuRoot || menuRoot.contains(target)) {
        return;
      }
      setIsAttachmentMenuOpen(false);
    };

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAttachmentMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isAttachmentMenuOpen]);

  const applyVoiceTranscript = useCallback(
    (transcript: string) => {
      const nextText = appendTranscript(voiceTranscriptBaseRef.current, transcript);
      if (textareaRef.current) textareaRef.current.value = nextText;
      setDomText(nextText);
      setText(nextText);
      syncTextareaHeight();
      onVoiceTranscript?.(transcript.trim(), nextText);
    },
    [onVoiceTranscript, setText, syncTextareaHeight],
  );

  const stopVoiceInput = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.stop();
  }, []);

  const startVoiceInput = useCallback(() => {
    if (!enableVoiceInput || isBusy) return;

    const Recognition = speechRecognitionConstructor;
    if (!Recognition) {
      const error = new Error(resolvedLabels.voiceUnsupported);
      onVoiceError?.(error);
      flashValidationError(error.message);
      return;
    }

    try {
      recognitionRef.current?.abort();
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang =
        voiceLanguage ??
        (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
      voiceTranscriptBaseRef.current = textareaRef.current?.value ?? renderedText;

      recognition.onstart = () => {
        setIsVoiceListening(true);
        onVoiceStart?.();
      };
      recognition.onresult = (event) => {
        applyVoiceTranscript(collectTranscript(event.results));
      };
      recognition.onerror = (event) => {
        const message = event.message || event.error || resolvedLabels.voiceUnsupported;
        const error = new Error(message);
        onVoiceError?.(error);
        flashValidationError(error.message);
      };
      recognition.onend = () => {
        recognitionRef.current = null;
        setIsVoiceListening(false);
        onVoiceEnd?.();
      };

      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setIsVoiceListening(false);
      const normalized = toError(error);
      onVoiceError?.(normalized);
      flashValidationError(normalized.message);
    }
  }, [
    applyVoiceTranscript,
    enableVoiceInput,
    flashValidationError,
    isBusy,
    onVoiceEnd,
    onVoiceError,
    onVoiceStart,
    renderedText,
    resolvedLabels,
    speechRecognitionConstructor,
    voiceLanguage,
  ]);

  useEffect(() => {
    if (!isVoiceListening && !recognitionRef.current) return undefined;
    if (!enableVoiceInput || isBusy) {
      recognitionRef.current?.stop();
    }
    return undefined;
  }, [enableVoiceInput, isBusy, isVoiceListening]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  const resolveMetadata = useCallback(() => {
    if (typeof metadata === 'function') return metadata();
    return metadata;
  }, [metadata]);

  const clearSubmittedState = useCallback(
    (uploadedIds: Set<string>) => {
      if (textareaRef.current) textareaRef.current.value = '';
      setDomText('');
      setText('');
      setFileList([]);
      if (uploadedIds.size > 0) {
        uploadedIds.forEach(releaseObjectUrl);
        setAttachmentList((prev) =>
          prev.filter((entry) => !uploadedIds.has(entry.id)),
        );
      }
    },
    [releaseObjectUrl, setAttachmentList, setFileList, setText],
  );

  const stop = useCallback(() => {
    if (!onStop || disabled) return;
    void onStop();
  }, [disabled, onStop]);

  /** Funnel newly-picked / dropped / pasted files into the right pipeline. */
  const ingestFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      const trimmed = multiple ? incoming : incoming.slice(0, 1);
      onFilesSelected?.(trimmed);
      if (isUploadManaged) {
        enqueueFiles(trimmed);
      } else {
        const existingCount = multiple ? currentFiles.length : 0;
        const accepted = validateIncomingFiles(trimmed, existingCount);
        if (accepted.length > 0) {
          setFileList(multiple ? [...currentFiles, ...accepted] : accepted);
        }
      }
    },
    [
      currentFiles,
      enqueueFiles,
      isUploadManaged,
      multiple,
      onFilesSelected,
      setFileList,
      validateIncomingFiles,
    ],
  );

  const submit = useCallback(() => {
    if (isBusy) return;
    if (isSubmitBlockedByPendingUploads) {
      flashValidationError(resolvedLabels.pendingUploads(pendingAttachmentCount));
      return;
    }

    const rawTextValue = textareaRef.current?.value ?? renderedText;
    const trimmedRaw = rawTextValue.trim();
    const uploadedEntries = currentAttachments.filter(
      (entry) => entry.status === 'uploaded' && entry.uploaded,
    );
    const uploadedAttachments: UploadedAttachment[] = uploadedEntries.map(
      (entry) => entry.uploaded as UploadedAttachment,
    );

    if (
      !trimmedRaw &&
      currentFiles.length === 0 &&
      uploadedAttachments.length === 0
    ) {
      return;
    }

    const uploadedIds = new Set(uploadedEntries.map((entry) => entry.id));
    const finalText = applyAttachmentTemplate(
      attachmentTextTemplate,
      uploadedAttachments,
      trimmedRaw,
    );
    const payload: ChatBoxSubmitPayload = {
      text: finalText,
      rawText: trimmedRaw,
      files: [...currentFiles],
      attachments: uploadedAttachments,
      model: currentModel,
      accessMode: currentAccessMode,
      metadata: resolveMetadata(),
    };
    if (isVoiceListening) {
      stopVoiceInput();
    }
    const clearMode =
      clearOnSubmit === false || clearOnSubmit === 'never'
        ? 'never'
        : clearOnSubmit === 'immediate'
          ? 'immediate'
          : 'success';

    let submitResult: void | Promise<void>;
    try {
      submitResult = onSubmit(payload);
    } catch (error) {
      onSubmitError?.(toError(error), payload);
      return;
    }

    if (clearMode === 'immediate') {
      clearSubmittedState(uploadedIds);
    }

    if (isPromiseLike(submitResult)) {
      setIsSubmitting(true);
      void Promise.resolve(submitResult)
        .then(() => {
          if (clearMode === 'success') {
            clearSubmittedState(uploadedIds);
          }
        })
        .catch((error: unknown) => {
          onSubmitError?.(toError(error), payload);
        })
        .finally(() => {
          setIsSubmitting(false);
        });
      return;
    }

    if (clearMode === 'success') {
      clearSubmittedState(uploadedIds);
    }
  }, [
    attachmentTextTemplate,
    clearSubmittedState,
    clearOnSubmit,
    currentAccessMode,
    currentAttachments,
    currentFiles,
    currentModel,
    flashValidationError,
    isBusy,
    isSubmitBlockedByPendingUploads,
    isVoiceListening,
    onSubmit,
    onSubmitError,
    pendingAttachmentCount,
    renderedText,
    resolveMetadata,
    resolvedLabels,
    stopVoiceInput,
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
      submitting: isSubmitting,
      voiceListening: isVoiceListening,
      pendingAttachmentCount,
      canSubmit,
      canStop,
      canUseVoiceInput,
      submit,
      stop,
      startVoiceInput,
      stopVoiceInput,
      focus,
      clearText,
      clearFiles,
      openFilePicker,
      removeFile,
      removeAttachment,
      retryAttachment,
    }),
    [
      canSubmit,
      canStop,
      canUseVoiceInput,
      clearFiles,
      clearText,
      currentAccessMode,
      currentAttachments,
      currentFiles,
      currentModel,
      disabled,
      domText,
      focus,
      isSubmitting,
      isVoiceListening,
      loading,
      openFilePicker,
      pendingAttachmentCount,
      removeAttachment,
      removeFile,
      retryAttachment,
      streaming,
      stop,
      startVoiceInput,
      stopVoiceInput,
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
    setIsDragOver(true);
    rootRef.current?.setAttribute('data-amk-dragover', 'true');
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!allowAttachments || isBusy) return;
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dragDepthRef.current += 1;
    setIsDragOver(true);
    rootRef.current?.setAttribute('data-amk-dragover', 'true');
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!allowAttachments || isBusy) return;
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    if (dragDepthRef.current > 0) {
      dragDepthRef.current -= 1;
    }
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
      rootRef.current?.removeAttribute('data-amk-dragover');
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!allowAttachments || isBusy) return;
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    rootRef.current?.removeAttribute('data-amk-dragover');
    const entries = droppedEntries(event.dataTransfer);
    if (entries.length > 0) {
      void collectDroppedFiles(entries)
        .then((files) => ingestFiles(files))
        .catch(() => flashValidationError(resolvedLabels.uploadError));
      return;
    }
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

  const showLoadingIndicator = loading || streaming || isSubmitting;
  const loadingLabel = loading
    ? 'Loading'
    : streaming
      ? 'Streaming'
      : isSubmitting
        ? resolvedLabels.submitting
        : undefined;
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
      data-submitting={isSubmitting ? '' : undefined}
      data-theme={theme}
      role="form"
      aria-label={resolvedLabels.root}
      aria-disabled={disabled ? true : undefined}
      aria-busy={showLoadingIndicator ? true : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="amk-chatbox__drop-overlay" aria-hidden="true">
          <span>{resolvedLabels.drop}</span>
        </div>
      )}

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
        disabled={disabled || isSubmitting}
        aria-busy={showLoadingIndicator ? true : undefined}
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
            <div className="amk-chatbox__attachment-picker" ref={attachmentMenuRef}>
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
              <input
                ref={folderInputRef}
                className="amk-chatbox__file-input"
                type="file"
                accept={accept}
                multiple
                tabIndex={-1}
                aria-hidden="true"
                onChange={handleFileChange}
              />
              <button
                ref={attachmentMenuButtonRef}
                id={attachmentMenuButtonId}
                className="amk-chatbox__icon-button"
                type="button"
                aria-haspopup="menu"
                aria-expanded={isAttachmentMenuOpen}
                aria-controls={isAttachmentMenuOpen ? attachmentMenuId : undefined}
                aria-label={resolvedLabels.attach}
                title={resolvedLabels.attach}
                onClick={toggleAttachmentMenu}
                onKeyDown={handleAttachmentButtonKeyDown}
                disabled={isBusy}
              >
                <span aria-hidden="true">+</span>
              </button>
              {isAttachmentMenuOpen && (
                <div
                  id={attachmentMenuId}
                  className="amk-chatbox__attachment-menu"
                  role="menu"
                  aria-labelledby={attachmentMenuButtonId}
                  onKeyDown={handleAttachmentMenuKeyDown}
                >
                  <button
                    ref={(node) => {
                      attachmentMenuItemRefs.current[0] = node;
                    }}
                    className="amk-chatbox__attachment-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={openFilePicker}
                  >
                    <svg
                      className="amk-chatbox__attachment-menu-icon"
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <path
                        d="M8 12.5v-5a4 4 0 0 1 8 0v7a6 6 0 0 1-12 0v-7"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                    <span>{resolvedLabels.attachFiles}</span>
                  </button>
                  <button
                    ref={(node) => {
                      attachmentMenuItemRefs.current[1] = node;
                    }}
                    className="amk-chatbox__attachment-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={openFolderPicker}
                  >
                    <svg
                      className="amk-chatbox__attachment-menu-icon"
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <path
                        d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"
                        stroke="currentColor"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                    <span>{resolvedLabels.attachFolder}</span>
                  </button>
                </div>
              )}
            </div>
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

          {!slots?.voiceButton && enableVoiceInput && (
            <button
              className={cx(
                'amk-chatbox__icon-button',
                'amk-chatbox__voice',
                isVoiceListening && 'amk-chatbox__voice--listening',
              )}
              type="button"
              aria-label={isVoiceListening ? resolvedLabels.stopVoice : resolvedLabels.voice}
              aria-pressed={isVoiceListening}
              title={isVoiceListening ? resolvedLabels.stopVoice : resolvedLabels.voice}
              disabled={isBusy && !isVoiceListening}
              onClick={isVoiceListening ? stopVoiceInput : startVoiceInput}
            >
              {isVoiceListening ? (
                <span aria-hidden="true">■</span>
              ) : (
                <svg
                  className="amk-chatbox__voice-icon"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                </svg>
              )}
            </button>
          )}

          {renderSlot(slots?.sendButton, context) ??
            (canStop ? (
              <button
                className="amk-chatbox__send amk-chatbox__stop"
                type="button"
                aria-label={resolvedLabels.stop}
                title={resolvedLabels.stop}
                disabled={!canStop}
                onClick={stop}
              >
                <span aria-hidden="true">■</span>
              </button>
            ) : (
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
            ))}
        </div>
      </div>
    </div>
  );
}

export const AgentChatBox = CodexChatBox;
