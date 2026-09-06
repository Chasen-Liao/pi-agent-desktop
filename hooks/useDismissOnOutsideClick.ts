import { useEffect, useRef, type RefObject } from "react";

export type DismissReason = "outside" | "escape";

export function useDismissOnOutsideClick(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: (reason: DismissReason) => void,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onCloseRef.current("outside");
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current("escape");
    };

    document.addEventListener("pointerdown", handlePointerDown);
    // Capture so a nested picker/menu consumes Escape before a parent dialog
    // that still listens on bubble (backdrop click / input onKeyDown).
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, ref]);
}
