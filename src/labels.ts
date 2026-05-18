import type { ChatBoxLabels, ChatBoxLocale } from './types.js';

/**
 * Built-in label dictionaries. Hosts may pick a locale via `locale='en'|'zh'`
 * and override individual fields through `labels`.
 */
export const DEFAULT_LABELS_EN: Required<ChatBoxLabels> = {
  root: 'Composer',
  textarea: 'Message Codex',
  attach: 'Attach file',
  attachFiles: 'Add files or photos',
  attachFolder: 'Add folder',
  removeFile: (f: File) => `Remove ${f.name}`,
  removeAttachment: (a: { name: string }) => `Remove ${a.name}`,
  retryAttachment: 'Retry upload',
  uploadError: 'Upload failed',
  uploading: 'Uploading...',
  submitting: 'Submitting',
  pendingUploads: (count: number) =>
    count === 1
      ? 'Wait for 1 attachment to finish uploading'
      : `Wait for ${count} attachments to finish uploading`,
  invalidFileType: (f: File) => `File type not accepted: ${f.name}`,
  model: 'Model',
  accessMode: 'Mode',
  send: 'Send',
  stop: 'Stop',
  drop: 'Drop files to attach',
};

export const DEFAULT_LABELS_ZH: Required<ChatBoxLabels> = {
  root: '消息输入区',
  textarea: '说点什么…',
  attach: '上传附件',
  attachFiles: '添加文件或照片',
  attachFolder: '添加文件夹',
  removeFile: (f: File) => `删除文件 ${f.name}`,
  removeAttachment: (a: { name: string }) => `删除附件 ${a.name}`,
  retryAttachment: '重新上传',
  uploadError: '上传失败',
  uploading: '上传中...',
  submitting: '提交中',
  pendingUploads: (count: number) => `请等待 ${count} 个附件上传完成`,
  invalidFileType: (f: File) => `不支持的文件类型：${f.name}`,
  model: '模型',
  accessMode: '模式',
  send: '发送消息',
  stop: '停止',
  drop: '拖入文件以附加',
};

export function resolveLabels(
  locale: ChatBoxLocale | undefined,
  overrides: ChatBoxLabels | undefined,
): Required<ChatBoxLabels> {
  const base = locale === 'zh' ? DEFAULT_LABELS_ZH : DEFAULT_LABELS_EN;
  if (!overrides) return base;
  return { ...base, ...overrides };
}
