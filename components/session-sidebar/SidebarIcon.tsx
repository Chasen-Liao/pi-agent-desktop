import type { CSSProperties } from "react";

const paths = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  "folder-open": <><path d="M3 10V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" /><path d="M3 20h15a2 2 0 0 0 2-1.6L22 12H7l-3 8H3V10" /></>,
  "folder-plus": <><path d="M12 20H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3M18 15v6m-3-3h6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  refresh: <><path d="M3 10a9 9 0 1 1 1 7M3 4v6h6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  sort: <path d="M4 6h16M7 12h10M10 18h4" />,
  grip: <><circle cx="8" cy="5" r="1" /><circle cx="16" cy="5" r="1" /><circle cx="8" cy="12" r="1" /><circle cx="16" cy="12" r="1" /><circle cx="8" cy="19" r="1" /><circle cx="16" cy="19" r="1" /></>,
  more: <><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>,
  branch: <><circle cx="6" cy="18" r="3" /><circle cx="18" cy="6" r="3" /><path d="M6 3v12m12-6a9 9 0 0 1-9 9" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 4V3H3v13h1" /></>,
  download: <><path d="M4 16v4h16v-4M12 3v12m-5-5 5 5 5-5" /></>,
  pencil: <><path d="m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15Z" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
};

export function SidebarIcon({ name, size = 16, className, style }: {
  name: keyof typeof paths;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}
