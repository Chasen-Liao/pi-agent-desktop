"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent, useMemo } from "react";
import { buildSlashCommandItems, getSlashTriggerQuery, type SlashCommandItem, type SlashSkill } from "@/lib/slash-commands";
import type { AttachedImage, ChatInputHandle } from "./chat-input/types";
export type { ChatInputHandle };


import { AttachmentPreview } from "./chat-input/AttachmentPreview";
import { ModelSelector } from "./chat-input/ModelSelector";
import { PresetSelector } from "./chat-input/PresetSelector";

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  isStreaming: boolean;
  currentCwd?: string | null;
  model?: { provider: string; modelId: string } | null;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  onModelChange?: (provider: string, modelId: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const THINKING_LEVEL_DESC: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "沿用 pi 默认设置",
  off: "关闭推理",
  minimal: "最少推理",
  low: "低强度推理",
  medium: "中等推理",
  high: "高强度推理",
  xhigh: "最高强度推理",
};

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, modelNames, modelList, onModelChange,
  currentCwd,
  onCompact, onAbortCompaction, isCompacting, compactError, toolPreset, onToolPresetChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo,
  soundEnabled, onSoundToggle,
}: Props, ref) {
  const [value, setValue] = useState("");
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const [caretIndex, setCaretIndex] = useState(0);
  const [slashSkills, setSlashSkills] = useState<SlashSkill[]>([]);
  const [slashSkillsLoading, setSlashSkillsLoading] = useState(false);
  const [slashSkillsError, setSlashSkillsError] = useState<string | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashDismissedValue, setSlashDismissedValue] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      setValue(newVal);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<AttachedImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64 = result.split(",")[1];
              resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachedImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, []);

  const slashQuery = useMemo(() => getSlashTriggerQuery(value, caretIndex), [value, caretIndex]);
  const slashItems = useMemo(
    () => slashQuery === null ? [] : buildSlashCommandItems(slashQuery, slashSkills),
    [slashQuery, slashSkills]
  );
  const slashMenuOpen = inputFocused && slashQuery !== null && slashDismissedValue !== value && slashItems.length > 0;

  useEffect(() => {
    if (slashQuery === null || !currentCwd) return;

    const controller = new AbortController();
    setSlashSkillsLoading(true);
    setSlashSkillsError(null);

    fetch(`/api/skills?cwd=${encodeURIComponent(currentCwd)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d: { skills?: SlashSkill[]; error?: string }) => {
        if (d.error) {
          setSlashSkillsError(d.error);
          setSlashSkills([]);
          return;
        }
        setSlashSkills(d.skills ?? []);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          setSlashSkillsError(String(e));
          setSlashSkills([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSlashSkillsLoading(false);
      });

    return () => controller.abort();
  }, [currentCwd, slashQuery]);

  useEffect(() => {
    setSlashActiveIndex((index) => Math.min(index, Math.max(slashItems.length - 1, 0)));
  }, [slashItems.length]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery]);

  const selectSlashItem = useCallback((item: SlashCommandItem) => {
    const ta = textareaRef.current;
    const after = ta ? ta.value.slice(ta.selectionStart ?? value.length) : value.slice(caretIndex);
    const nextValue = `${item.insertText}${after}`;
    const nextCaret = item.insertText.length;
    setValue(nextValue);
    setCaretIndex(nextCaret);
    setSlashDismissedValue(null);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextCaret, nextCaret);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, [caretIndex, value]);

  const handleSend = useCallback(() => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onSend(msg, attachedImages.length ? attachedImages : undefined);
    setValue("");
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, attachedImages, isStreaming, onSend, clearImages]);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined);
    }
    setValue("");
    clearImages();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [value, attachedImages, onSteer, onFollowUp, clearImages]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashMenuOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex((index) => (index + 1) % slashItems.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex((index) => (index - 1 + slashItems.length) % slashItems.length);
          return;
        }
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
          e.preventDefault();
          const item = slashItems[Math.min(slashActiveIndex, slashItems.length - 1)];
          if (item) selectSlashItem(item);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashDismissedValue(value);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          sendQueued(onSteer ? "steer" : "followup");
        } else {
          handleSend();
        }
      }
    },
    [slashMenuOpen, slashItems, slashActiveIndex, selectSlashItem, value, isStreaming, onSteer, onFollowUp, sendQueued, handleSend]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles]);

  // Close thinking dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 10px",
        paddingRight: 52, // 16px base + 36px for ChatMinimap alignment
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "var(--warning-bg)", border: "1px solid var(--warning-border)",
            borderRadius: 6, fontSize: 12, color: "var(--warning)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Retrying ({retryInfo.attempt}/{retryInfo.maxAttempts})…{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}

        {/* Image previews */}
        <AttachmentPreview attachedImages={attachedImages} onRemoveImage={removeImage} />

        {/* Main input */}
        <div style={{ position: "relative" }}>
        {slashMenuOpen && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "calc(100% + 8px)",
              zIndex: 160,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-panel)",
              boxShadow: "var(--shadow-popover)",
              overflow: "hidden",
              maxHeight: 300,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "7px 12px",
                borderBottom: "1px solid var(--border)",
                color: "var(--text-dim)",
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <span>Slash commands</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>↑↓ Enter Tab Esc</span>
            </div>
            <div style={{ overflowY: "auto", padding: "5px" }}>
              {(["command", "skill"] as const).map((kind) => {
                const groupItems = slashItems.filter((item) => item.kind === kind);
                if (groupItems.length === 0) return null;
                return (
                  <div key={kind} style={{ marginBottom: kind === "command" ? 4 : 0 }}>
                    <div
                      style={{
                        padding: "5px 7px 3px",
                        color: "var(--text-dim)",
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {kind === "command" ? "Commands" : "Skills"}
                    </div>
                    {groupItems.map((item) => {
                      const itemIndex = slashItems.indexOf(item);
                      const active = itemIndex === slashActiveIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectSlashItem(item)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "8px 9px",
                            border: "none",
                            borderRadius: 6,
                            background: active ? "var(--bg-selected)" : "none",
                            color: active ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                          onMouseEnter={() => setSlashActiveIndex(itemIndex)}
                        >
                          <span
                            style={{
                              width: 110,
                              flexShrink: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                              fontWeight: active ? 700 : 600,
                              color: active ? "var(--accent)" : "var(--text)",
                            }}
                          >
                            {item.label}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 12,
                              color: "var(--text-muted)",
                            }}
                          >
                            {item.description}
                          </span>
                          {item.scope && (
                            <span
                              style={{
                                flexShrink: 0,
                                border: "1px solid var(--border)",
                                borderRadius: 4,
                                padding: "1px 5px",
                                fontSize: 10,
                                color: "var(--text-dim)",
                              }}
                            >
                              {item.scope}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {slashSkillsLoading && (
                <div style={{ padding: "7px 9px", color: "var(--text-dim)", fontSize: 12 }}>
                  Loading skills...
                </div>
              )}
              {slashSkillsError && (
                <div style={{ padding: "7px 9px", color: "var(--danger)", fontSize: 12 }}>
                  Skills unavailable
                </div>
              )}
            </div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--bg-elevated)",
            border: `1px solid ${inputFocused
              ? "var(--focus-ring)"
              : isStreaming && (onSteer || onFollowUp)
                ? "var(--warning-border)"
                : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
            borderRadius: 16,
            padding: "10px 10px 10px 14px",
            boxShadow: inputFocused ? "0 0 0 3px var(--focus-ring), var(--shadow-input)" : "var(--shadow-input)",
            transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
          } as React.CSSProperties}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setCaretIndex(e.target.selectionStart ?? e.target.value.length);
              setSlashDismissedValue(null);
            }}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            onSelect={(e) => setCaretIndex(e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
            onFocus={(e) => {
              setInputFocused(true);
              setCaretIndex(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
            }}
            onBlur={() => setInputFocused(false)}
            placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? "Steer 立即注入 / Follow-up 排队…"
                : isStreaming ? "Agent is running…"
                : "Message…"
            }
            rows={1}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: "inherit",
              minHeight: 24,
              maxHeight: 200,
              overflow: "auto",
            }}
          />

          {isStreaming ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, alignSelf: "flex-end" }}>
              {onSteer && (
                <button
                  onClick={() => sendQueued("steer")}
                  disabled={!value.trim() && !attachedImages.length}
                  title="打断 Agent 当前运行，立即注入消息"
                  aria-label="Steer running agent"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 12px",
                    background: (value.trim() || attachedImages.length) ? "var(--warning-bg)" : "none",
                    border: "1px solid var(--warning-border)",
                    borderRadius: "var(--radius-control)",
                    color: (value.trim() || attachedImages.length) ? "var(--warning)" : "var(--text-dim)",
                    cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: 0,
                    transition: "background 0.12s",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 1 L9 5 L5 9" /><line x1="1" y1="5" x2="9" y2="5" />
                  </svg>
                  Steer
                </button>
              )}
              {onFollowUp && (
                <button
                  onClick={() => sendQueued("followup")}
                  disabled={!value.trim() && !attachedImages.length}
                  title="在 Agent 完成后排队发送"
                  aria-label="Queue follow-up message"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 12px",
                    background: (value.trim() || attachedImages.length) ? "var(--info-bg)" : "none",
                    border: "1px solid var(--info-border)",
                    borderRadius: "var(--radius-control)",
                    color: (value.trim() || attachedImages.length) ? "var(--info)" : "var(--text-dim)",
                    cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: 0,
                    transition: "background 0.12s",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="1" x2="5" y2="6" /><polyline points="2.5 3.5 5 1 7.5 3.5" />
                    <line x1="2" y1="9" x2="8" y2="9" />
                  </svg>
                  Follow-up
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={!value.trim() && !attachedImages.length}
              aria-label="Send message"
              style={{
                flexShrink: 0,
                alignSelf: "flex-end",
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px",
                background: (value.trim() || attachedImages.length) ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: "var(--radius-control)",
                color: (value.trim() || attachedImages.length) ? "var(--accent-contrast)" : "var(--text-dim)",
                cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0,
                boxShadow: (value.trim() || attachedImages.length) ? "0 1px 8px var(--focus-ring)" : "none",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="7" x2="11" y2="7" />
                <polyline points="7.5 3 12 7 7.5 11" />
              </svg>
              Send
            </button>
          )}
        </div>
        </div>

        {/* Bottom bar: left | center (context) | right */}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, minHeight: 32 }}>

          {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 2 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              title="Attach image"
              aria-label="Attach image"
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: 32, height: "var(--control-height)", padding: 0,
                background: "none", border: "none",
                borderRadius: "var(--radius-control)",
                color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                cursor: isStreaming ? "not-allowed" : "pointer",
                opacity: isStreaming ? 0.5 : 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (isStreaming) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>

            {/* Model selector */}
            <ModelSelector
              isStreaming={isStreaming}
              model={model}
              modelNames={modelNames}
              modelList={modelList}
              onModelChange={onModelChange}
            />
          </div>

          {/* spacer */}
          <div style={{ flex: 1 }} />

          {/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 2, marginLeft: "auto" }}>
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setThinkingDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title="切换推理强度"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    height: "var(--control-height)",
                    background: thinkingDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: "var(--radius-control)",
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
                    <line x1="7" y1="18" x2="12" y2="18" />
                    <line x1="8" y1="21" x2="11" y2="21" />
                  </svg>
                  <span>{(() => {
                    const lvl = thinkingLevel ?? "auto";
                    if (lvl === "auto" || !thinkingLevelMap) return lvl;
                    const mapped = thinkingLevelMap[lvl];
                    return mapped != null ? mapped : lvl;
                  })()}</span>
                </button>
                {thinkingDropdownOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: "var(--radius-panel)", boxShadow: "var(--shadow-popover)",
                    overflow: "hidden", minWidth: 180,
                  }}>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                      const desc = THINKING_LEVEL_DESC[lvl];
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>
                            {displayLabel}
                            {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Preset selector */}
            {!isStreaming && onToolPresetChange && (
              <PresetSelector
                isStreaming={isStreaming}
                toolPreset={toolPreset}
                onToolPresetChange={onToolPresetChange}
              />
            )}

            {!isStreaming && onCompact && (
              <div style={{ position: "relative" }}>
                {compactError && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    background: "var(--bg-panel)", color: "var(--danger)",
                    fontSize: 11, padding: "4px 8px", borderRadius: "var(--radius-control)",
                    whiteSpace: "nowrap", pointerEvents: "none",
                    boxShadow: "var(--shadow-popover)", zIndex: 50,
                  }}>
                    {compactError}
                  </div>
                )}
                <button
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  aria-label={isCompacting ? "Stop compaction" : "Compact context"}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    height: "var(--control-height)",
                    background: isCompacting ? "var(--danger-bg)" : "none",
                    border: "none",
                    borderRadius: "var(--radius-control)",
                    color: isCompacting ? "var(--danger)" : "var(--text-muted)",
                    cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                    fontSize: 12, opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming && !isCompacting) return;
                    e.currentTarget.style.background = isCompacting ? "var(--danger-bg)" : "var(--bg-hover)";
                    e.currentTarget.style.color = isCompacting ? "var(--danger)" : "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isCompacting ? "var(--danger-bg)" : "none";
                    e.currentTarget.style.color = isCompacting ? "var(--danger)" : "var(--text-muted)";
                  }}
                  title={isCompacting ? "停止压缩" : "压缩上下文"}
                >
                  {isCompacting ? (
                    <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>Compacting…</>
                  ) : (
                    <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                      <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                    </svg>Compact</>
                  )}
                </button>
              </div>
            )}

            {isStreaming && (
              <button
                onClick={onAbort}
                title="停止 Agent"
                aria-label="Stop agent"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 14px",
                  height: "var(--control-height)",
                  background: "var(--danger-bg)",
                  border: "1px solid var(--danger-border)",
                  borderRadius: "var(--radius-control)",
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: 0,
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--danger-bg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--danger-bg)"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
                </svg>
                Stop
              </button>
            )}

            {onSoundToggle !== undefined && (
              <button
                onClick={onSoundToggle}
                title={soundEnabled ? "关闭完成提示音" : "开启完成提示音"}
                aria-label={soundEnabled ? "Disable done sound" : "Enable done sound"}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: "var(--control-height)", padding: 0,
                  background: "none",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: "pointer",
                  opacity: soundEnabled ? 1 : 0.55,
                  transition: "background 0.12s, color 0.12s, opacity 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
                }}
              >
                {soundEnabled ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                )}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
});
