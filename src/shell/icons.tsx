// Small stroke icons for the Whiteboard shell (original artwork, drawn to sit
// quietly next to Excalidraw's own icon style).
import type { ReactElement } from "react";

const svg = (children: ReactElement | ReactElement[], size = 16) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const Icon = {
  sidebar: svg([<rect key="a" x="2.5" y="3.5" width="15" height="13" rx="2.5" />, <path key="b" d="M7.5 3.5v13" />]),
  plus: svg(<path d="M10 4.5v11M4.5 10h11" />),
  search: svg([<circle key="a" cx="9" cy="9" r="5" />, <path key="b" d="m13 13 3.5 3.5" />]),
  clock: svg([<circle key="a" cx="10" cy="10" r="7" />, <path key="b" d="M10 6.5V10l2.5 1.5" />]),
  star: svg(<path d="m10 3 2.1 4.4 4.8.6-3.5 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.1 8l4.8-.6z" />),
  starFilled: (
    <svg width={16} height={16} viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" aria-hidden="true">
      <path d="m10 3 2.1 4.4 4.8.6-3.5 3.3.9 4.7L10 13.7 5.7 16l.9-4.7L3.1 8l4.8-.6z" />
    </svg>
  ),
  folder: svg(<path d="M2.5 6V14.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H10L8.3 4H4.5a2 2 0 0 0-2 2Z" />),
  folderOpen: svg(<path d="M2.5 14.5V6a2 2 0 0 1 2-2h3.8L10 6h5a2 2 0 0 1 2 2v1M2.5 14.5l2-5h13l-2 5a2 2 0 0 1-1.9 1.5H4.5a2 2 0 0 1-2-1.5Z" />),
  chevron: svg(<path d="m7.5 5 5 5-5 5" />, 12),
  board: svg([<rect key="a" x="3.5" y="3.5" width="13" height="13" rx="2.5" />, <path key="b" d="M6.5 12c1.2-2.5 2.2-3.5 3-3s.5 2 1.5 2.3 1.5-1.3 2.5-2.3" />]),
  archive: svg([<rect key="a" x="2.5" y="4" width="15" height="3.5" rx="1" />, <path key="b" d="M4 7.5V15a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15V7.5M8 11h4" />]),
  trash: svg(<path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5m3 0-.7 10a1.5 1.5 0 0 1-1.5 1.4H7.2a1.5 1.5 0 0 1-1.5-1.4L5 5.5" />),
  more: svg([<circle key="a" cx="5" cy="10" r=".8" />, <circle key="b" cx="10" cy="10" r=".8" />, <circle key="c" cx="15" cy="10" r=".8" />]),
  gear: svg([
    <circle key="a" cx="10" cy="10" r="2.5" />,
    <path key="b" d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />,
  ]),
  history: svg([<path key="a" d="M3.5 10a6.5 6.5 0 1 0 2-4.7L3.5 7.3" />, <path key="b" d="M3.5 3.5v3.8h3.8M10 6.5V10l2.5 1.5" />]),
  save: svg([<path key="a" d="M4.5 3.5h9l3 3v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" />, <path key="b" d="M6.5 3.5v4h6v-4M6.5 16.5v-5h7v5" />]),
  close: svg(<path d="m5.5 5.5 9 9m0-9-9 9" />, 12),
  check: svg(<path d="m4.5 10.5 3.5 3.5 7.5-8" />, 12),
  home: svg(<path d="M3.5 9 10 3.5 16.5 9v7a.5.5 0 0 1-.5.5h-4v-5H8v5H4a.5.5 0 0 1-.5-.5Z" />),
  template: svg([<rect key="a" x="3" y="3" width="6" height="6" rx="1.5" />, <rect key="b" x="11" y="3" width="6" height="6" rx="1.5" />, <rect key="c" x="3" y="11" width="6" height="6" rx="1.5" />, <path key="d" d="M14 11.5v5M11.5 14h5" />]),
  export: svg(<path d="M10 12.5V3.5m0 0-3.5 3.5M10 3.5l3.5 3.5M4 11.5v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4" />),
  focus: svg(<path d="M3.5 7.5v-3a1 1 0 0 1 1-1h3M12.5 3.5h3a1 1 0 0 1 1 1v3M16.5 12.5v3a1 1 0 0 1-1 1h-3M7.5 16.5h-3a1 1 0 0 1-1-1v-3" />),
  finder: svg([<rect key="a" x="3" y="3.5" width="14" height="13" rx="2.5" />, <path key="b" d="M10 3.5c-1 2.5-1.3 5-1 7.5H10M7 7.5v1M13 7.5v1M6.5 13c2 1.3 5 1.3 7 0" />]),
  copy: svg([<rect key="a" x="6.5" y="6.5" width="10" height="10" rx="2" />, <path key="b" d="M13.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5" />]),
  restore: svg(<path d="M4 10a6 6 0 1 0 1.8-4.3L4 7.5M4 4v3.5h3.5" />),
  pencil: svg(<path d="m12.5 4.5 3 3-8.5 8.5H4v-3zM11 6l3 3" />),
  move: svg(<path d="M2.5 6V14.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H10L8.3 4H4.5a2 2 0 0 0-2 2ZM8 11.5h5m-2-2 2 2-2 2" />),
  folderOpenAlt: svg(<path d="M3 15V5.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2h5.5A1.5 1.5 0 0 1 16 7.5V9M3 15l2-5.5h12.5L15.5 15Z" />),
  keyboard: svg([<rect key="a" x="2.5" y="5" width="15" height="10" rx="2" />, <path key="b" d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M6.5 12h7" />]),
  sun: svg([<circle key="a" cx="10" cy="10" r="3" />, <path key="b" d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1 1M14.3 14.3l1 1M4.7 15.3l1-1M14.3 5.7l1-1" />]),
  image: svg([<rect key="a" x="3" y="4" width="14" height="12" rx="2" />, <circle key="b" cx="7.5" cy="8.5" r="1.3" />, <path key="c" d="m3.5 14 4-3.5 3 2.5 2.5-2 3.5 3" />]),
  design: svg([
    <rect key="a" x="2.5" y="3.5" width="15" height="13" rx="2" />,
    <path key="b" d="M2.5 7h15M6 10.5h4M6 13h6" />,
  ]),
  link: svg(<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2L10 5.8m1.5 2.7a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2L10 14.2" />),
};
