import type {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

/**
 * Description of an attachment that has finished uploading. The chatbox
 * surfaces these values through {@link ChatBoxSubmitPayload.attachments} and
 * uses them to render chip metadata.
 */
export interface UploadedAttachment {
  /** Stable id; chatbox generates one if omitted. */
  id?: string;
  /** Display filename. */
  name: string;
  /** Size in bytes. */
  size: number;
  /** Path on the backend (e.g. "attachments/foo.png"). */
  relPath?: string;
  /** Optional URL for preview / download. */
  url?: string;
  /** MIME type (used to choose icon / preview). */
  mimeType?: string;
  /** Arbitrary caller-defined metadata. */
  metadata?: Record<string, unknown>;
}

export type AttachmentStatus = 'queued' | 'uploading' | 'uploaded' | 'error';

export interface AttachmentEntry {
  id: string;
  status: AttachmentStatus;
  /**
   * Present while the entry is queued/uploading or has failed (so retry can
   * re-send the bytes). Cleared once uploaded to release memory.
   */
  file?: File;
  uploaded?: UploadedAttachment;
  error?: string;
  /** 0..1 upload progress, when uploadHandler reports it. */
  progress?: number;
  /** Wall-clock ms when the entry was added (for stable sort). */
  createdAt: number;
}

export interface UploadHandlerContext {
  signal: AbortSignal;
  /**
   * Optional progress reporter; calls back chatbox to update the entry's
   * `progress`.
   */
  reportProgress?: (fraction: number) => void;
}

export type UploadHandler = (
  file: File,
  ctx: UploadHandlerContext,
) => Promise<UploadedAttachment>;

export interface ChatBoxSubmitPayload {
  /** Final composed text (template-rendered when attachments are present). */
  text: string;
  /**
   * The raw textarea text, unaffected by attachmentTextTemplate. Equals `text`
   * when no template is rendered (no template or no attachments).
   */
  rawText: string;
  files: File[];
  /** Uploaded attachments included with this submission. Always present. */
  attachments: UploadedAttachment[];
  model?: string;
  accessMode?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatBoxOption {
  value: string;
  label: string;
}

export interface ChatBoxRenderContext {
  text: string;
  files: File[];
  attachments: AttachmentEntry[];
  model?: string;
  accessMode?: string;
  disabled: boolean;
  loading: boolean;
  streaming: boolean;
  submitting: boolean;
  voiceListening: boolean;
  pendingAttachmentCount: number;
  canSubmit: boolean;
  canStop: boolean;
  canUseVoiceInput: boolean;
  submit: () => void;
  stop: () => void;
  startVoiceInput: () => void;
  stopVoiceInput: () => void;
  focus: () => void;
  clearText: () => void;
  clearFiles: () => void;
  openFilePicker: () => void;
  removeFile: (index: number) => void;
  removeAttachment: (id: string) => void;
  retryAttachment: (id: string) => void;
}

export type ChatBoxSlot = ReactNode | ((context: ChatBoxRenderContext) => ReactNode);

export interface ChatBoxSlots {
  leftTools?: ChatBoxSlot;
  modelSelector?: ChatBoxSlot;
  accessModeSelector?: ChatBoxSlot;
  voiceButton?: ChatBoxSlot;
  sendButton?: ChatBoxSlot;
  loadingIndicator?: ChatBoxSlot;
}

export type ChatBoxLocale = 'en' | 'zh';

export type ChatBoxTheme = 'dark' | 'light' | 'auto';

export interface ChatBoxLabels {
  root?: string;
  textarea?: string;
  attach?: string;
  attachFiles?: string;
  attachFolder?: string;
  voice?: string;
  stopVoice?: string;
  voiceListening?: string;
  voiceUnsupported?: string;
  removeFile?: (file: File) => string;
  removeAttachment?: (attachment: { name: string }) => string;
  retryAttachment?: string;
  uploadError?: string;
  uploading?: string;
  submitting?: string;
  pendingUploads?: (count: number) => string;
  invalidFileType?: (file: File) => string;
  model?: string;
  accessMode?: string;
  send?: string;
  stop?: string;
  drop?: string;
}

export type AttachmentTextTemplate =
  | string
  | ((attachments: UploadedAttachment[], text: string) => string);

export type ClearOnSubmitMode = boolean | 'immediate' | 'success' | 'never';

type NativeTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  | 'value'
  | 'defaultValue'
  | 'disabled'
  | 'onChange'
  | 'onSubmit'
  | 'children'
  | 'className'
  | 'onCompositionEnd'
  | 'onCompositionStart'
  | 'onInput'
  | 'onKeyUp'
  | 'onDragOver'
  | 'onDragLeave'
  | 'onDrop'
  | 'onPaste'
>;

export interface CodexChatBoxProps extends NativeTextareaProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string, event?: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit: (payload: ChatBoxSubmitPayload) => void | Promise<void>;
  files?: File[];
  defaultFiles?: File[];
  onFilesChange?: (files: File[]) => void;
  onFilesSelected?: (files: File[]) => void;
  onFileRemove?: (file: File, index: number) => void;
  onSubmitError?: (error: Error, payload: ChatBoxSubmitPayload) => void;
  /** Controlled managed-upload entries. */
  attachments?: AttachmentEntry[];
  defaultAttachments?: AttachmentEntry[];
  onAttachmentsChange?: (entries: AttachmentEntry[]) => void;
  onAttachmentError?: (entry: AttachmentEntry, error: Error) => void;
  /**
   * When provided, the chatbox runs uploads itself and surfaces queued /
   * uploading / uploaded / error entries through the attachments props.
   */
  uploadHandler?: UploadHandler;
  /** Max concurrent in-flight uploads. Default 4. */
  maxConcurrentUploads?: number;
  /** Maximum size per file (bytes). When set, larger files are rejected. */
  maxFileSize?: number;
  /**
   * Maximum number of entries the chatbox will hold (queued + uploading +
   * uploaded). Extra files are rejected and reported via onAttachmentError.
   */
  maxFiles?: number;
  /**
   * By default, managed-upload submissions are blocked while queued/uploading
   * files exist so users do not accidentally send a prompt missing attachments.
   */
  allowSubmitWithPendingUploads?: boolean;
  /**
   * Final text template applied when attachments are present at submit time.
   * String form supports `{paths}`, `{names}`, `{count}`, `{text}`. Function
   * form receives `(attachments, text)` and returns the final string.
   */
  attachmentTextTemplate?: AttachmentTextTemplate;
  model?: string;
  defaultModel?: string;
  modelOptions?: ChatBoxOption[];
  onModelChange?: (model: string) => void;
  accessMode?: string;
  defaultAccessMode?: string;
  accessModeOptions?: ChatBoxOption[];
  onAccessModeChange?: (accessMode: string) => void;
  metadata?: Record<string, unknown> | (() => Record<string, unknown> | undefined);
  slots?: ChatBoxSlots;
  disabled?: boolean;
  loading?: boolean;
  streaming?: boolean;
  /** Enables the built-in browser speech-to-text voice button. */
  enableVoiceInput?: boolean;
  /**
   * Recognition language passed to SpeechRecognition.lang. Defaults to the
   * browser locale when available.
   */
  voiceLanguage?: string;
  onVoiceStart?: () => void;
  onVoiceEnd?: () => void;
  onVoiceTranscript?: (transcript: string, nextText: string) => void;
  onVoiceError?: (error: Error) => void;
  /**
   * Visual theme applied to the chatbox root. `auto` keeps the dark default
   * unless the user's system preference is light.
   */
  theme?: ChatBoxTheme;
  className?: string;
  textareaClassName?: string;
  placeholder?: string;
  accept?: string;
  multiple?: boolean;
  allowAttachments?: boolean;
  /**
   * Controls when submitted text/files are cleared. `true` means after a
   * successful submit; `false`/`never` keeps the draft; `immediate` preserves
   * the historical fire-and-forget clearing behavior.
   */
  clearOnSubmit?: ClearOnSubmitMode;
  onStop?: () => void | Promise<void>;
  autoResize?: boolean;
  maxTextareaHeight?: number;
  locale?: ChatBoxLocale;
  labels?: ChatBoxLabels;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}
