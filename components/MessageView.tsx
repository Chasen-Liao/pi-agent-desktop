"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { ayuDarkSyntaxTheme, ayuLightSyntaxTheme } from "@/lib/ayu-syntax-theme";
import { useTheme } from "@/hooks/useTheme";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
  CustomMessage,
} from "@/lib/types";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${date} ${time}`;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}

export const MessageView = React.memo(function MessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  entryId,
  onFork,
  forking,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  showTimestamp,
  prevTimestamp,
}: Props) {
  if (message.role === "user") {
    return (
      <UserMessageView
        message={message as UserMessage}
        entryId={entryId}
        onFork={onFork}
        forking={forking}
        onNavigate={onNavigate}
        prevAssistantEntryId={prevAssistantEntryId}
        onEditContent={onEditContent}
      />
    );
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessageView
        message={message as AssistantMessage}
        isStreaming={isStreaming}
        toolResults={toolResults}
        modelNames={modelNames}
        showTimestamp={showTimestamp}
        prevTimestamp={prevTimestamp}
      />
    );
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom" && message.display) {
    return (
      <CustomMessageView 
        message={message as CustomMessage} 
        showTimestamp={showTimestamp} 
      />
    );
  }
  return null;
});

const CustomMessageView = React.memo(function CustomMessageView({
  message,
  showTimestamp,
}: {
  message: CustomMessage;
  showTimestamp?: boolean;
}) {
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  return (
    <div className="mb-[18px] flex flex-col items-center">
      <div className="bg-bg-elevated border border-border rounded-panel px-4 py-2 text-[13px] text-text-muted whitespace-pre-wrap max-w-[90%] shadow-sm">
        {message.customType && (
          <div className="text-[11px] font-semibold mb-2 text-text-dim uppercase tracking-wider text-center">
            {message.customType.replace(/_/g, " ")}
          </div>
        )}
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
      {time && <span className="text-[10px] text-text-dim mt-1">{time}</span>}
    </div>
  );
});

const UserMessageView = React.memo(function UserMessageView({
  message,
  entryId,
  onFork,
  forking,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
}: {
  message: UserMessage;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;

  const copyContent = () => {
    copyText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="mb-[18px] flex flex-col items-end"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-end gap-1.5 max-w-[85%]">
        <div className="flex-1 min-w-0 bg-user-bg border border-user-border rounded-panel px-3 py-2 text-[14px] leading-[1.6] text-text whitespace-pre-wrap break-words">
          {imageBlocks.length > 0 && (
            <div className={`flex gap-1.5 flex-wrap ${content ? "mb-2" : "mb-0"}`}>
              {imageBlocks.map((img, i) => {
                const flat = img as unknown as { data?: string; mimeType?: string };
                const src = img.source
                  ? img.source.type === "base64"
                    ? `data:${img.source.media_type};base64,${img.source.data}`
                    : img.source.url ?? ""
                  : flat.data
                  ? `data:${flat.mimeType};base64,${flat.data}`
                  : "";
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className="max-w-[240px] max-h-[240px] rounded-md object-contain block border border-user-border"
                  />
                );
              })}
            </div>
          )}
          {content}
        </div>
      </div>

      {/* Bottom row: action buttons + timestamp */}
      {(time || canFork || canNavigate || true) && (
        <div className="flex items-center justify-end gap-1.5 mt-[3px]">
          <div
            className={`flex gap-[3px] transition-opacity duration-120 ${
              hovered ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
          >
            <button
              onClick={copyContent}
              title="Copy message"
              aria-label="Copy message"
              className={`flex items-center gap-1 px-2 py-[3px] h-[22px] bg-transparent border-none rounded-control cursor-pointer text-[11px] font-normal whitespace-nowrap transition-colors duration-120 ${
                copied ? "text-accent" : "text-text-dim hover:text-accent"
              }`}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {(canFork || canNavigate) && (
            <div
              className={`flex gap-[3px] transition-opacity duration-120 ${
                hovered || forking ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
              }`}
            >
              {canNavigate && (
                <button
                  onClick={() => {
                    onNavigate!(prevAssistantEntryId!);
                    onEditContent?.(content);
                  }}
                  title="Edit from here — branches within this session"
                  aria-label="Edit from here"
                  className="flex items-center gap-1 px-2 py-[3px] h-[22px] bg-transparent border-none rounded-control text-text-dim hover:text-accent cursor-pointer text-[11px] font-normal whitespace-nowrap transition-colors duration-120"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 10 20 15 15 20" />
                    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
                  </svg>
                  Edit from here
                </button>
              )}
              {canFork && (
                <button
                  onClick={() => {
                    onFork!(entryId!);
                  }}
                  disabled={forking}
                  title={forking ? "Creating new session…" : "New session — creates an independent copy from here"}
                  aria-label="Create new session from here"
                  className={`flex items-center gap-1 px-2 py-[3px] h-[22px] bg-transparent border-none rounded-control cursor-pointer text-[11px] font-normal whitespace-nowrap transition-colors duration-120 ${
                    forking ? "text-accent cursor-not-allowed" : "text-text-dim hover:text-accent"
                  }`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {forking ? "Creating…" : "New session"}
                </button>
              )}
            </div>
          )}
          {time && <span className="text-[10px] text-text-dim">{time}</span>}
        </div>
      )}
    </div>
  );
});

const AssistantMessageView = React.memo(function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  showTimestamp,
  prevTimestamp,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  showTimestamp?: boolean;
  prevTimestamp?: number;
}) {
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blocks = useMemo(() => message.content ?? [], [message.content]);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const copyContent = () => {
    copyText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = Date.now();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        let changed = false;
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) {
            next.set(idx, Math.round((now - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }

    const now = Date.now();

    // Record start time for each block the first time we see it
    blocks.forEach((_, i) => {
      if (!blockStartTimesRef.current.has(i)) blockStartTimesRef.current.set(i, now);
    });

    // When a non-last block has a successor already started, finalise its duration
    setStreamingDurations((prev: Map<number, number>) => {
      let changed = false;
      const next = new Map(prev);
      for (let i = 0; i < blocks.length - 1; i++) {
        if (!next.has(i) && blockStartTimesRef.current.has(i)) {
          const start = blockStartTimesRef.current.get(i)!;
          const nextStart = blockStartTimesRef.current.get(i + 1) ?? now;
          next.set(i, Math.round((nextStart - start) / 1000));
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    let chars = 0;
    for (const b of blocks) {
      if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
      else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
      else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
    }
    if (chars === 0) return;
    if (streamStartRef.current === null) streamStartRef.current = now;
    const elapsed = (now - streamStartRef.current) / 1000;
    if (elapsed > 0.5) setTps(chars / 4 / elapsed);
  }, [blocks, isStreaming]);

  return (
    <div
      className="mb-[18px]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Model label */}
      <div className="text-[11px] text-text-dim mb-1 flex items-center gap-1.5">
        {message.provider && (
          <span>
            {modelNames?.[`${message.provider}:${message.model}`] ??
              modelNames?.[message.model] ??
              message.model}
          </span>
        )}
        {isStreaming &&
          (() => {
            let chars = 0;
            for (const b of blocks) {
              if (b.type === "text") chars += (b as TextContent).text?.length ?? 0;
              else if (b.type === "thinking") chars += (b as ThinkingContent).thinking?.length ?? 0;
              else if (b.type === "toolCall") chars += JSON.stringify((b as ToolCallContent).input ?? {}).length;
            }
            const est = Math.round(chars / 4);
            return (
              <>
                {est > 0 && (
                  <span className="flex items-center gap-1 text-text" title="预估 token 数（流式接收中）">
                    <span className="flex items-center gap-0.5 text-[11px] font-normal">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="1.5" x2="5" y2="8.5" />
                        <polyline points="2 6 5 8.5 8 6" />
                      </svg>
                      {est}
                    </span>
                    {tps !== null &&
                      (() => {
                        const bg =
                          tps >= 50
                            ? "var(--info)"
                            : tps >= 30
                            ? "var(--success)"
                            : tps >= 15
                            ? "var(--warning)"
                            : "var(--danger)";
                        return (
                          <span
                            className="ml-1.5 px-1.5 py-[1px] rounded-[4px] text-accent-contrast text-[11px] font-normal"
                            style={{ background: bg }}
                          >
                            {tps.toFixed(1)} t/s
                          </span>
                        );
                      })()}
                  </span>
                )}
              </>
            );
          })()}
      </div>

      <div className="flex flex-col gap-2">
        {blocks.map((block, i) => (
          <BlockView
            key={i}
            block={block}
            toolResults={toolResults}
            streamingDuration={
              streamingDurations.get(i) ??
              (block.type === "thinking" ? thinkingDurationFromFile : undefined)
            }
            toolCallDurations={toolCallDurations}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 mt-1">
        {message.usage && !isStreaming && (
          <div className="text-[11px] text-text-dim">{formatUsage(message.usage)}</div>
        )}
        {textContent && !isStreaming && (
          <button
            onClick={copyContent}
            title="Copy message"
            aria-label="Copy message"
            className={`flex items-center gap-1 px-2 py-[3px] h-[22px] bg-transparent border-none rounded-control cursor-pointer text-[11px] font-normal whitespace-nowrap transition-colors duration-120 ${
              copied ? "text-accent" : "text-text-dim hover:text-accent"
            } ${hovered ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {time && !isStreaming && (
          <span className="text-[10px] text-text-dim ml-auto">{time}</span>
        )}
      </div>
    </div>
  );
});

function BlockView({
  block,
  toolResults,
  streamingDuration,
  toolCallDurations,
}: {
  block: AssistantContentBlock;
  toolResults?: Map<string, ToolResultMessage>;
  streamingDuration?: number;
  toolCallDurations?: Map<string, number>;
}) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    return <ToolCallBlock block={tc} result={result} duration={duration} />;
  }
  return null;
}

function TextBlock({ block }: { block: TextContent }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const lang = className?.replace("language-", "") ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
            }
            return (
              <code
                className="bg-bg-selected px-1 py-[1px] rounded-[3px] font-mono text-[0.9em]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {block.text}
      </ReactMarkdown>
    </div>
  );
}

function ThinkingBlock({ block, duration }: { block: ThinkingContent; duration?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-border rounded-panel overflow-hidden text-[13px]">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? "Collapse thinking" : "Expand thinking"}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 bg-code-header-bg border-none text-text-muted cursor-pointer text-[12px] text-left"
      >
        <span>Thinking</span>
        {duration !== undefined && (
          <span className="ml-auto text-[11px] text-text-dim tabular-nums">{duration}s</span>
        )}
      </button>
      {expanded && (
        <div className="px-2.5 py-2 text-text-muted text-[12px] leading-[1.6] whitespace-pre-wrap bg-bg-panel border-t border-border">
          {block.thinking}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({
  block,
  result,
  duration,
}: {
  block: ToolCallContent;
  result?: ToolResultMessage;
  duration?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = JSON.stringify(block.input, null, 2);

  const resultText = result
    ? result.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : resultText.trim() === "(no output)" || resultText.trim() === "";
  const isError = result?.isError ?? false;

  return (
    <div
      className={`rounded-panel overflow-hidden text-[12px] border ${
        isError ? "border-danger-border bg-danger-bg" : "border-success-border bg-success-bg"
      }`}
    >
      {/* ── Tool call header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? `Collapse ${block.toolName} tool call` : `Expand ${block.toolName} tool call`}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 bg-transparent border-none text-text-muted cursor-pointer text-[12px] text-left min-w-0"
      >
        <span className={`font-mono font-semibold text-[11px] shrink-0 ${isError ? "text-danger" : "text-success"}`}>
          {block.toolName}
        </span>
        <span className="text-text-dim font-mono text-[11px] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
          {getToolPreview(block)}
        </span>
        {duration !== undefined && (
          <span className="text-[11px] text-text-dim shrink-0 tabular-nums">{duration}s</span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--text-dim)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 transition-transform duration-150"
          style={{ transform: expanded ? "rotate(180deg)" : "none" }}
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {/* ── Expanded: input args ── */}
      {expanded && (
        <pre
          className={`m-0 px-2.5 py-2 text-text-muted text-[12px] leading-[1.5] overflow-auto bg-bg-subtle border-t whitespace-pre-wrap break-all ${
            isError ? "border-danger-border" : "border-success-border"
          }`}
        >
          {inputStr}
        </pre>
      )}

      {/* ── Paired result — only shown when expanded ── */}
      {expanded && result && (
        <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={isError} />
      )}
    </div>
  );
}

function PairedResult({
  text,
  isEmpty,
  isError,
}: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  return (
    <div
      className={`border-t ${
        isError ? "border-danger-border bg-danger-bg" : "border-success-border bg-bg-subtle"
      }`}
    >
      <pre
        className={`m-0 px-2.5 py-2 text-[12px] leading-[1.5] overflow-auto max-h-[400px] bg-bg whitespace-pre-wrap break-all ${
          isError ? "text-danger" : isEmpty ? "text-text-dim italic opacity-60" : "text-text-muted normal-case opacity-100"
        }`}
      >
        {isEmpty ? "(no output)" : text}
      </pre>
    </div>
  );
}

function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative my-1 rounded-panel overflow-hidden border border-border">
      <div className="px-2.5 py-[3px] bg-bg-panel border-b border-border text-[11px] text-text-dim flex justify-between items-center">
        <span>{lang}</span>
        <button
          onClick={copy}
          aria-label="Copy code"
          className="bg-transparent border-none text-text-muted hover:text-text cursor-pointer text-[11px] rounded-control px-1.5 py-[2px] transition-colors duration-120"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang || "text"}
        style={isDark ? ayuDarkSyntaxTheme : ayuLightSyntaxTheme}
        showLineNumbers
        lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
        customStyle={{
          margin: 0,
          padding: "10px 12px",
          fontSize: 12.5,
          lineHeight: 1.6,
          borderRadius: 0,
          background: "var(--code-bg)",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
