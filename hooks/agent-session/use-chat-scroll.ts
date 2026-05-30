"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseChatScrollOptions {
  messageCount: number;
  agentRunning: boolean;
}

export function useChatScroll({ messageCount, agentRunning }: UseChatScrollOptions) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const agentRunningRef = useRef(false);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messageCount <= 0) return;
    if (pendingScrollToUserRef.current) {
      pendingScrollToUserRef.current = false;
      initialScrollDoneRef.current = true;
      scrollUserMsgToTop();
    } else if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      scrollToBottom("instant");
    } else if (!agentRunningRef.current) {
      scrollToBottom("smooth");
    }
  }, [messageCount, agentRunning, scrollToBottom, scrollUserMsgToTop]);

  return {
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
  };
}
