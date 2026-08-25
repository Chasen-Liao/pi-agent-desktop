export type FollowUpImage = {
  type: "image";
  data: string;
  mimeType: string;
};

export type QueuedFollowUp = {
  id: string;
  message: string;
  images?: FollowUpImage[];
  createdAt: number;
};

export type FollowUpQueueItem = {
  id: string;
  message: string;
  attachmentCount: number;
  createdAt: number;
};

export type FollowUpQueueSnapshot = {
  revision: number;
  items: FollowUpQueueItem[];
};

export class FollowUpQueue {
  private items: QueuedFollowUp[] = [];
  private revision = 0;

  snapshot(): FollowUpQueueSnapshot {
    return {
      revision: this.revision,
      items: this.items.map(({ id, message, images, createdAt }) => ({
        id,
        message,
        attachmentCount: images?.length ?? 0,
        createdAt,
      })),
    };
  }

  enqueue(item: QueuedFollowUp): FollowUpQueueSnapshot {
    this.items.push(item);
    this.revision += 1;
    return this.snapshot();
  }

  reorder(orderedIds: string[], expectedRevision: number): FollowUpQueueSnapshot {
    if (expectedRevision !== this.revision) {
      throw new Error("Follow-up queue changed; refresh and try again");
    }
    if (
      orderedIds.length !== this.items.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      orderedIds.some((id) => !this.items.some((item) => item.id === id))
    ) {
      throw new Error("Follow-up queue order must contain every queued item exactly once");
    }

    const byId = new Map(this.items.map((item) => [item.id, item]));
    this.items = orderedIds.map((id) => byId.get(id)!);
    this.revision += 1;
    return this.snapshot();
  }

  shift(): { item: QueuedFollowUp; snapshot: FollowUpQueueSnapshot } | null {
    const item = this.items.shift();
    if (!item) return null;
    this.revision += 1;
    return { item, snapshot: this.snapshot() };
  }

  restoreFront(item: QueuedFollowUp): FollowUpQueueSnapshot {
    this.items.unshift(item);
    this.revision += 1;
    return this.snapshot();
  }
}
