"use client";

import type { ReactNode } from "react";

export interface ModalSurfaceProps {
  children: ReactNode;
  backdropClassName?: string;
  panelClassName?: string;
  ariaLabelledBy?: string;
}

const DEFAULT_BACKDROP_CLASS =
  "ui-dialog-backdrop fixed inset-0 z-[1000] flex items-center justify-center p-4";
const DEFAULT_PANEL_CLASS = "t-modal is-open ui-dialog-surface";

export function ModalSurface({
  children,
  backdropClassName = DEFAULT_BACKDROP_CLASS,
  panelClassName = DEFAULT_PANEL_CLASS,
  ariaLabelledBy,
}: ModalSurfaceProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      className={backdropClassName}
    >
      <div className={panelClassName}>{children}</div>
    </div>
  );
}
