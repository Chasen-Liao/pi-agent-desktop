"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export function useAudio() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("pi-sound-enabled");
    return stored === null ? true : stored === "true";
  });

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Tracks the in-flight AudioContext and its deferred close timer so unmount
  // can clear the timer and close the context — avoiding a dangling timer and
  // a leaked WebAudio context after the chime.
  const pendingAudioRef = useRef<{ timer: ReturnType<typeof setTimeout>; ctx: AudioContext } | null>(null);

  useEffect(() => {
    return () => {
      const pending = pendingAudioRef.current;
      if (pending) {
        clearTimeout(pending.timer);
        pending.ctx.close().catch(() => {});
      }
    };
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("pi-sound-enabled", String(next));
      return next;
    });
  }, []);

  const playDone = useCallback(() => {
    if (!enabledRef.current) return;
    try {
      const ctx = new AudioContext();
      const now = ctx.currentTime;
      const freqs = [523.25, 659.25];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = now + i * 0.18;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.start(t);
        osc.stop(t + 0.45);
      });
      const timer = setTimeout(() => {
        // Clear the ref once the deferred close fires so unmount's cleanup
        // doesn't close an already-closed context.
        if (pendingAudioRef.current?.ctx === ctx) pendingAudioRef.current = null;
        ctx.close().catch(() => {});
      }, 1200);
      pendingAudioRef.current = { timer, ctx };
    } catch {
      // AudioContext not available
    }
  }, []);

  return { soundEnabled: enabled, onSoundToggle: toggle, playDoneSound: playDone, soundEnabledRef: enabledRef };
}