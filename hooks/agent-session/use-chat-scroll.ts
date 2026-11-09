"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  shouldFollowAgentSettle,
  shouldFollowStreamingUpdate,
} from "./chat-scroll-policy";

interface UseChatScrollOptions {
  messageCount: number;
  agentRunning: boolean;
  streamingMessage?: unknown;
  followStreaming?: boolean;
}

/** Manages chat transcript scroll tracking and conditional auto-scrolling on user send, streaming updates, and agent settle. */
export function useChatScroll({
  messageCount,
  agentRunning,
  streamingMessage,
  followStreaming = true,
}: UseChatScrollOptions) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const isAtBottomRef = useRef(true);

  const setScrollContainer = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
    setContainerNode(node);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerNode;
    if (!container) return;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    // Consider user at bottom if within 80px of bottom
    isAtBottomRef.current = distanceToBottom < 80;
  }, [containerNode]);

  // Track user scroll position on the active container node
  useEffect(() => {
    if (!containerNode) return;
    handleScroll();
    containerNode.addEventListener("scroll", handleScroll, { passive: true });
    return () => containerNode.removeEventListener("scroll", handleScroll);
  }, [containerNode, handleScroll]);

  // Initial load scroll to bottom once container mounts
  useEffect(() => {
    if (messageCount <= 0 || !containerNode) return;
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      isAtBottomRef.current = true;
      scrollToBottom("auto");
    }
  }, [messageCount, containerNode, scrollToBottom]);

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
    if (
      shouldFollowStreamingUpdate({
        agentRunning,
        isAtBottom: isAtBottomRef.current,
        followStreaming,
      })
    ) {
      scrollToBottom("auto");
    }
  }, [streamingMessage, messageCount, agentRunning, followStreaming, scrollToBottom]);

  // When the agent settles or the transcript changes while at the bottom,
  // smoothly follow the new context without interrupting manual history review.
  useEffect(() => {
    if (
      shouldFollowAgentSettle({
        agentRunning,
        initialScrollDone: initialScrollDoneRef.current,
        isAtBottom: isAtBottomRef.current,
        followStreaming,
      })
    ) {
      scrollToBottom("smooth");
    }
  }, [agentRunning, messageCount, followStreaming, scrollToBottom]);

  return {
    messagesEndRef,
    scrollContainerRef,
    setScrollContainer,
    pendingScrollToUserRef,
    initialScrollDoneRef,
    scrollToBottom,
  };
}
