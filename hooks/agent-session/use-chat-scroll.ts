"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseChatScrollOptions {
  messageCount: number;
  agentRunning: boolean;
  streamingMessage?: unknown;
}

export function useChatScroll({
  messageCount,
  agentRunning,
  streamingMessage,
}: UseChatScrollOptions) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    // Consider user at bottom if within 80px of bottom
    isAtBottomRef.current = distanceToBottom < 80;
  }, []);

  // Track user scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Initial load scroll to bottom
  useEffect(() => {
    if (messageCount <= 0) return;
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      isAtBottomRef.current = true;
      scrollToBottom("instant");
    }
  }, [messageCount, scrollToBottom]);

  // When user sends a message, scroll down and lock to bottom
  useEffect(() => {
    if (pendingScrollToUserRef.current) {
      pendingScrollToUserRef.current = false;
      initialScrollDoneRef.current = true;
      isAtBottomRef.current = true;
      scrollToBottom("smooth");
    }
  }, [messageCount, scrollToBottom]);

  // During streaming/thinking/tool execution, auto-scroll to bottom if user is at bottom
  useEffect(() => {
    if (agentRunning && isAtBottomRef.current) {
      scrollToBottom("instant");
    }
  }, [streamingMessage, agentRunning, scrollToBottom]);

  // When agent settles, smooth scroll to bottom if at bottom
  useEffect(() => {
    if (!agentRunning && initialScrollDoneRef.current && isAtBottomRef.current) {
      scrollToBottom("smooth");
    }
  }, [agentRunning, scrollToBottom]);

  return {
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    scrollToBottom,
  };
}
