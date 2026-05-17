import type {
  ChangeEvent,
  KeyboardEvent,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

export interface ChatBoxSubmitPayload {
  text: string;
  files: File[];
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
  model?: string;
  accessMode?: string;
  disabled: boolean;
  loading: boolean;
  streaming: boolean;
  canSubmit: boolean;
  submit: () => void;
  focus: () => void;
  clearText: () => void;
  clearFiles: () => void;
  openFilePicker: () => void;
  removeFile: (index: number) => void;
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
  className?: string;
  textareaClassName?: string;
  placeholder?: string;
  accept?: string;
  multiple?: boolean;
  allowAttachments?: boolean;
  clearOnSubmit?: boolean;
  autoResize?: boolean;
  maxTextareaHeight?: number;
  labels?: {
    root?: string;
    textarea?: string;
    attach?: string;
    removeFile?: (file: File) => string;
    model?: string;
    accessMode?: string;
    send?: string;
  };
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}
