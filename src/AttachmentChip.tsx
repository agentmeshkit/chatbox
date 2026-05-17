import type { ChatBoxLabels, AttachmentEntry } from './types.js';
import {
  extensionBadge,
  isImageEntry,
  pickThumbnailUrl,
} from './upload-state.js';

/**
 * Render a single managed-upload attachment chip. Pure presentation — all
 * state and callbacks are passed in, so the chip can be unit-tested
 * independently of CodexChatBox.
 */
export interface AttachmentChipProps {
  entry: AttachmentEntry;
  index: number;
  disabled: boolean;
  labels: Required<ChatBoxLabels>;
  /** Pre-cached object URL store, keyed by entry id. Read-only during render. */
  objectUrls: ReadonlyMap<string, string>;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function AttachmentChip({
  entry,
  index,
  disabled,
  labels,
  objectUrls,
  onRetry,
  onRemove,
}: AttachmentChipProps) {
  const displayName = entry.uploaded?.name ?? entry.file?.name ?? entry.id;
  const displaySize = entry.uploaded?.size ?? entry.file?.size ?? 0;
  const mime = entry.uploaded?.mimeType ?? entry.file?.type;
  const isImage = isImageEntry(entry);
  const thumbUrl = isImage ? pickThumbnailUrl(entry, objectUrls) : undefined;
  const badge = extensionBadge(displayName, mime);
  const ariaLabel = labels.removeAttachment({ name: displayName });

  return (
    <span
      className={cx(
        'amk-chatbox__chip',
        'amk-chatbox__chip--entry',
        entry.status === 'queued' && 'amk-chatbox__chip--queued',
        entry.status === 'uploading' && 'amk-chatbox__chip--uploading',
        entry.status === 'uploaded' && 'amk-chatbox__chip--uploaded',
        entry.status === 'error' && 'amk-chatbox__chip--error',
      )}
      data-status={entry.status}
      data-testid={`chatbox-attachment-${index}`}
    >
      {isImage && thumbUrl ? (
        <img
          className="amk-chatbox__chip-thumb"
          src={thumbUrl}
          alt=""
          width={24}
          height={24}
        />
      ) : (
        <span className="amk-chatbox__chip-badge" aria-hidden="true">
          {badge}
        </span>
      )}
      <span className="amk-chatbox__chip-name" title={displayName}>
        {displayName}
      </span>
      {entry.status === 'uploaded' && (
        <span className="amk-chatbox__chip-size">{formatBytes(displaySize)}</span>
      )}
      {(entry.status === 'queued' || entry.status === 'uploading') && (
        <span
          className="amk-chatbox__chip-status"
          role="status"
          aria-live="polite"
        >
          {labels.uploading}
          {typeof entry.progress === 'number' && (
            <span className="amk-chatbox__chip-progress">
              {' '}
              {Math.round(entry.progress * 100)}%
            </span>
          )}
        </span>
      )}
      {entry.status === 'error' && (
        <>
          <span className="amk-chatbox__chip-error" role="alert">
            {entry.error ?? labels.uploadError}
          </span>
          <button
            className="amk-chatbox__chip-retry"
            type="button"
            onClick={() => onRetry(entry.id)}
            disabled={disabled}
          >
            {labels.retryAttachment}
          </button>
        </>
      )}
      <button
        className="amk-chatbox__chip-remove"
        type="button"
        aria-label={ariaLabel}
        onClick={() => onRemove(entry.id)}
        disabled={disabled}
      >
        <span aria-hidden="true">x</span>
      </button>
    </span>
  );
}
