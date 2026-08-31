"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import type { FollowUpQueueItem } from "@/lib/follow-up-queue";
import { useI18n } from "../I18nProvider";

type Props = {
  items: FollowUpQueueItem[];
  disabled?: boolean;
  onReorder: (orderedIds: string[]) => void;
};

type DropTarget = { id: string; after: boolean } | null;

export function QueuedMessageList({ items, disabled = false, onReorder }: Props) {
  const { t } = useI18n();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  if (!items.length) return null;

  const move = (id: string, nextIndex: number) => {
    const currentIndex = items.findIndex((item) => item.id === id);
    const clampedIndex = Math.max(0, Math.min(items.length - 1, nextIndex));
    if (disabled || currentIndex === -1 || currentIndex === clampedIndex) return;
    const orderedIds = items.map((item) => item.id);
    orderedIds.splice(currentIndex, 1);
    orderedIds.splice(clampedIndex, 0, id);
    onReorder(orderedIds);
    setAnnouncement(t("queue.moved", { position: clampedIndex + 1, total: items.length }));
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  };

  const handleDrop = (event: DragEvent<HTMLOListElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!draggingId || !dropTarget || draggingId === dropTarget.id || disabled) {
      setDraggingId(null);
      setDropTarget(null);
      return;
    }
    const orderedIds = items.map((item) => item.id).filter((id) => id !== draggingId);
    const targetIndex = orderedIds.indexOf(dropTarget.id);
    orderedIds.splice(targetIndex + (dropTarget.after ? 1 : 0), 0, draggingId);
    onReorder(orderedIds);
    setAnnouncement(t("queue.moved", { position: orderedIds.indexOf(draggingId) + 1, total: items.length }));
    requestAnimationFrame(() => rowRefs.current.get(draggingId)?.focus());
    setDraggingId(null);
    setDropTarget(null);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLLIElement>, id: string, index: number) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    move(id, index + (event.key === "ArrowUp" ? -1 : 1));
  };

  return (
    <>
      <ol
        className="queued-message-list"
        aria-label={t("queue.title")}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={handleDrop}
      >
        {items.map((item, index) => (
          <li
            key={item.id}
            ref={(node) => {
              if (node) rowRefs.current.set(item.id, node);
              else rowRefs.current.delete(item.id);
            }}
            tabIndex={0}
            className="queued-message-row"
            data-dragging={draggingId === item.id ? "true" : "false"}
            data-drop-before={dropTarget?.id === item.id && !dropTarget.after ? "true" : "false"}
            data-drop-after={dropTarget?.id === item.id && dropTarget.after ? "true" : "false"}
            onKeyDown={(event) => handleRowKeyDown(event, item.id, index)}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              setDropTarget({ id: item.id, after: event.clientY > rect.top + rect.height / 2 });
            }}
          >
            <button
              type="button"
              className="queued-message-grip"
              draggable={!disabled}
              disabled={disabled}
              aria-label={t("queue.drag", { number: index + 1 })}
              onDragStart={(event) => {
                event.stopPropagation();
                setDraggingId(item.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-pi-follow-up", item.id);
              }}
              onDragEnd={(event) => {
                event.stopPropagation();
                setDraggingId(null);
                setDropTarget(null);
              }}
            >
              <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
                <circle cx="3" cy="3" r="1" /><circle cx="9" cy="3" r="1" />
                <circle cx="3" cy="8" r="1" /><circle cx="9" cy="8" r="1" />
                <circle cx="3" cy="13" r="1" /><circle cx="9" cy="13" r="1" />
              </svg>
            </button>
            <span className="queued-message-copy">{item.message || t("queue.image")}</span>
            {item.attachmentCount > 0 && (
              <span className="queued-message-attachments" aria-label={t("queue.attachments", { count: item.attachmentCount })}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                {item.attachmentCount}
              </span>
            )}
            <div className="queued-message-actions">
              <button type="button" disabled={disabled || index === 0} onClick={() => move(item.id, index - 1)} aria-label={t("queue.moveUp")}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 9 4-4 4 4" /></svg>
              </button>
              <button type="button" disabled={disabled || index === items.length - 1} onClick={() => move(item.id, index + 1)} aria-label={t("queue.moveDown")}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 5 4 4 4-4" /></svg>
              </button>
            </div>
          </li>
        ))}
      </ol>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </>
  );
}
