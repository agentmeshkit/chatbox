export interface ChatBoxSubmitPayload {
  text: string;
  model?: string;
  accessMode?: string;
  files?: File[];
  metadata?: Record<string, unknown>;
}

export interface CodexChatBoxProps {
  value?: string;
  disabled?: boolean;
  model?: string;
  accessMode?: string;
  onChange?: (value: string) => void;
  onSubmit: (payload: ChatBoxSubmitPayload) => void;
}

