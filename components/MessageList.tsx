import React, { useMemo } from "react";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import { MessageView } from "./MessageView.tsx";

interface MessageListProps {
  messages: AgentMessage[];
  entryIds: string[];
  toolResultsMap: Map<string, ToolResultMessage>;
  nextUserIdx: number[];
  nextAssistantIdx: number[];
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
  isNew: boolean;
  agentRunning: boolean;
  forkingEntryId: string | null;
  onFork: (entryId: string) => void;
  onNavigate: (entryId: string) => void;
  onEditContent: (content: string) => void;
  messageRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  lastUserMsgRef: React.MutableRefObject<HTMLDivElement | null>;
  modelNames: Record<string, string>;
}

export const MessageList = React.memo(function MessageList({
  messages, entryIds, toolResultsMap, nextUserIdx, nextAssistantIdx,
  isStreaming, streamingMessage, isNew, agentRunning, forkingEntryId,
  onFork, onNavigate, onEditContent, messageRefs, lastUserMsgRef,
  modelNames,
}: MessageListProps) {
  const lastUserIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  }, [messages]);

  let refIdx = 0;
  return (
    <>
      {messages.map((msg, idx) => {
        const isFirstUserMessage = idx === 0 && msg.role === "user";
        const canFork = !agentRunning && !isNew && !isFirstUserMessage;
        const canNavigate = !agentRunning;
        const isUserOrAssistant = msg.role === "user" || msg.role === "assistant";
        const showTimestamp = msg.role !== "assistant"
          || nextUserIdx[idx] !== -1
          || nextAssistantIdx[idx] === -1;
        const finalShowTimestamp = showTimestamp && !(isStreaming && idx === messages.length - 1);
        const prevAssistantEntryId = msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
          ? entryIds[idx - 1]
          : undefined;
        const prevTimestamp = idx > 0
          ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp
          : undefined;

        const view = (
          <MessageView
            key={entryIds[idx] ?? `idx-${idx}`}
            message={msg}
            toolResults={toolResultsMap}
            modelNames={modelNames}
            entryId={entryIds[idx]}
            onFork={canFork ? onFork : undefined}
            forking={forkingEntryId === entryIds[idx]}
            onNavigate={canNavigate ? onNavigate : undefined}
            prevAssistantEntryId={prevAssistantEntryId}
            onEditContent={onEditContent}
            showTimestamp={finalShowTimestamp}
            prevTimestamp={prevTimestamp}
          />
        );

        if (!isUserOrAssistant) return view;
        const currentRefIdx = refIdx++;
        return (
          <div
            key={entryIds[idx] ?? `idx-${idx}`}
            ref={(el) => {
              messageRefs.current[currentRefIdx] = el;
              if (idx === lastUserIdx) lastUserMsgRef.current = el;
            }}
            style={{ contentVisibility: "auto", containIntrinsicSize: "auto 150px" }}
          >
            {view}
          </div>
        );
      })}
      {isStreaming && streamingMessage && (
        <MessageView message={streamingMessage as AgentMessage} isStreaming modelNames={modelNames} />
      )}
    </>
  );
});
