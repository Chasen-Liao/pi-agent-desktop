"use client";

import React from "react";
import type { AttachedImage } from "./types";

interface AttachmentPreviewProps {
  attachedImages: AttachedImage[];
  onRemoveImage: (index: number) => void;
}

export function AttachmentPreview({ attachedImages, onRemoveImage }: AttachmentPreviewProps) {
  if (attachedImages.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
      {attachedImages.map((img, i) => (
        <div key={i} style={{ position: "relative", flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.previewUrl}
            alt=""
            style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }}
          />
          <button
            onClick={() => onRemoveImage(i)}
            style={{
              position: "absolute", top: -4, right: -4,
              width: 16, height: 16, borderRadius: "50%",
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", padding: 0, color: "var(--text-muted)",
            }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
