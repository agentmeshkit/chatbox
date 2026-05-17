import type {
  AttachmentEntry,
  AttachmentTextTemplate,
  UploadedAttachment,
} from './types.js';

/**
 * Helpers for managed-upload attachment state. Kept separate from
 * CodexChatBox.tsx so the main component file stays under ~800 lines.
 */

/**
 * Generate a stable id for an attachment entry. Prefers
 * `crypto.randomUUID()` and falls back to a time + random string when not
 * available (older runtimes, some jsdom configurations).
 */
export function createEntryId(): string {
  if (typeof globalThis.crypto !== 'undefined') {
    const c = globalThis.crypto as Crypto & {
      randomUUID?: () => string;
    };
    if (typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a queued AttachmentEntry from a freshly-picked File. The entry starts
 * in `queued` state; the upload runner is expected to flip it to `uploading`
 * before invoking the host upload handler.
 */
export function makeQueuedEntry(file: File): AttachmentEntry {
  return {
    id: createEntryId(),
    status: 'queued',
    file,
    createdAt: Date.now(),
  };
}

/**
 * Tail of the filename after the last `.`. Returns the upper-cased extension
 * (no dot) when present, otherwise an empty string. Used to render a text
 * badge on non-image attachment chips.
 */
export function extensionBadge(name: string, mimeType?: string): string {
  if (mimeType?.startsWith('image/')) return 'IMG';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'application/zip') return 'ZIP';
  if (mimeType === 'text/plain') return 'TXT';
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'FILE';
  return name.slice(dot + 1).toUpperCase().slice(0, 6);
}

export function isImageEntry(entry: AttachmentEntry): boolean {
  if (entry.uploaded?.mimeType?.startsWith('image/')) return true;
  if (entry.file?.type.startsWith('image/')) return true;
  return false;
}

/**
 * Pick a URL to use for a chip preview / thumbnail. Prefers an already-known
 * uploaded URL, otherwise reads a previously-created object URL from the
 * lifecycle cache. May return undefined when the entry has neither.
 */
export function pickThumbnailUrl(
  entry: AttachmentEntry,
  objectUrls?: ReadonlyMap<string, string>,
): string | undefined {
  if (entry.uploaded?.url) return entry.uploaded.url;
  if (entry.file) return objectUrls?.get(entry.id);
  return undefined;
}

/**
 * Apply the user-provided attachment text template, if any. Returns the final
 * text. When there are no attachments, the original text is returned
 * unchanged regardless of whether a template was provided.
 */
export function applyAttachmentTemplate(
  template: AttachmentTextTemplate | undefined,
  attachments: UploadedAttachment[],
  text: string,
): string {
  if (attachments.length === 0) return text;
  if (!template) return text;
  if (typeof template === 'function') return template(attachments, text);
  return template
    .replaceAll('{paths}', attachments.map((a) => a.relPath ?? a.name).join(','))
    .replaceAll('{names}', attachments.map((a) => a.name).join(','))
    .replaceAll('{count}', String(attachments.length))
    .replaceAll('{text}', text);
}

export function entriesEqual(
  a: AttachmentEntry[],
  b: AttachmentEntry[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
