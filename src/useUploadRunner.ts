import { useEffect, useRef, type MutableRefObject } from 'react';
import type {
  AttachmentEntry,
  UploadedAttachment,
  UploadHandler,
} from './types.js';

/**
 * Bookkeeping refs the upload runner needs from the host component. Kept as
 * a single object so the hook signature stays manageable.
 */
export interface UploadRunnerRefs {
  abortControllers: MutableRefObject<Map<string, AbortController>>;
  objectUrls: MutableRefObject<Map<string, string>>;
  attachmentsRef: MutableRefObject<AttachmentEntry[]>;
}

export interface UploadRunnerOptions {
  isUploadManaged: boolean;
  uploadHandler?: UploadHandler;
  maxConcurrentUploads: number;
  attachments: AttachmentEntry[];
  setAttachmentList: (
    updater:
      | AttachmentEntry[]
      | ((prev: AttachmentEntry[]) => AttachmentEntry[]),
  ) => void;
  onAttachmentError?: (entry: AttachmentEntry, error: Error) => void;
  refs: UploadRunnerRefs;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

/**
 * Drive the managed-upload state machine. Promotes queued entries to
 * uploading, runs the host handler, and reconciles the result back into
 * attachment state.
 */
export function useUploadRunner({
  isUploadManaged,
  uploadHandler,
  maxConcurrentUploads,
  attachments,
  setAttachmentList,
  onAttachmentError,
  refs,
}: UploadRunnerOptions): void {
  const handlerRef = useRef(uploadHandler);
  const onErrorRef = useRef(onAttachmentError);

  useEffect(() => {
    handlerRef.current = uploadHandler;
  }, [uploadHandler]);
  useEffect(() => {
    onErrorRef.current = onAttachmentError;
  }, [onAttachmentError]);

  useEffect(() => {
    if (!isUploadManaged) return;
    const handler = handlerRef.current;
    if (!handler) return;

    const inFlight = attachments.filter(
      (entry) => entry.status === 'uploading',
    ).length;
    const slots = Math.max(0, maxConcurrentUploads - inFlight);
    if (slots === 0) return;
    const queued = attachments.filter((entry) => entry.status === 'queued');
    if (queued.length === 0) return;

    const toStart = queued.slice(0, slots);
    const startIds = new Set(toStart.map((entry) => entry.id));

    setAttachmentList((prev) =>
      prev.map((entry) =>
        startIds.has(entry.id) && entry.status === 'queued'
          ? { ...entry, status: 'uploading' as const, error: undefined }
          : entry,
      ),
    );

    for (const entry of toStart) {
      const file = entry.file;
      if (!file) continue;

      const existingController = refs.abortControllers.current.get(entry.id);
      if (existingController) {
        existingController.abort();
      }
      const controller = new AbortController();
      refs.abortControllers.current.set(entry.id, controller);

      const reportProgress = (fraction: number) => {
        const clamped = Math.max(0, Math.min(1, fraction));
        setAttachmentList((prev) =>
          prev.map((existing) =>
            existing.id === entry.id && existing.status === 'uploading'
              ? { ...existing, progress: clamped }
              : existing,
          ),
        );
      };

      void Promise.resolve()
        .then(() =>
          handler(file, { signal: controller.signal, reportProgress }),
        )
        .then((uploaded) => {
          if (controller.signal.aborted) return;
          refs.abortControllers.current.delete(entry.id);
          const normalized: UploadedAttachment = {
            ...uploaded,
            id: uploaded.id ?? entry.id,
            mimeType: uploaded.mimeType ?? file.type ?? undefined,
            size: typeof uploaded.size === 'number' ? uploaded.size : file.size,
            name: uploaded.name ?? file.name,
          };
          const cached = refs.objectUrls.current.get(entry.id);
          if (cached) {
            try {
              URL.revokeObjectURL(cached);
            } catch {
              // ignore
            }
            refs.objectUrls.current.delete(entry.id);
          }
          setAttachmentList((prev) =>
            prev.map((existing) =>
              existing.id === entry.id
                ? {
                    ...existing,
                    status: 'uploaded' as const,
                    uploaded: normalized,
                    file: undefined,
                    progress: undefined,
                    error: undefined,
                  }
                : existing,
            ),
          );
        })
        .catch((error: unknown) => {
          refs.abortControllers.current.delete(entry.id);
          if (isAbortError(error) || controller.signal.aborted) {
            const cached = refs.objectUrls.current.get(entry.id);
            if (cached) {
              try {
                URL.revokeObjectURL(cached);
              } catch {
                // ignore
              }
              refs.objectUrls.current.delete(entry.id);
            }
            setAttachmentList((prev) =>
              prev.filter((existing) => existing.id !== entry.id),
            );
            return;
          }
          const message = errorMessage(error, 'Upload failed');
          const wrapped = error instanceof Error ? error : new Error(message);
          setAttachmentList((prev) => {
            const next = prev.map((existing) =>
              existing.id === entry.id
                ? {
                    ...existing,
                    status: 'error' as const,
                    error: message,
                    progress: undefined,
                  }
                : existing,
            );
            const failedEntry = next.find((e) => e.id === entry.id);
            if (failedEntry) {
              onErrorRef.current?.(failedEntry, wrapped);
            }
            return next;
          });
        });
    }
  }, [
    attachments,
    isUploadManaged,
    maxConcurrentUploads,
    refs.abortControllers,
    refs.objectUrls,
    setAttachmentList,
  ]);
}
