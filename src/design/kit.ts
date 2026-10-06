/**
 * The Design kit: simple, low-fidelity UI building blocks for sketching
 * screens. Every item is plain Excalidraw shapes and text, grouped — so it
 * behaves (and saves, exports and opens in Excalidraw) like anything else you
 * draw. Two looks: "clean" (straight lines, Nunito) and "sketchy" (Excalidraw's
 * hand-drawn style with Excalifont).
 */
import { convertToExcalidrawElements, FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type KitStyle = "clean" | "sketchy";

type Skel = Record<string, any>;

interface StyleTokens {
  roughness: number;
  font: number;
}

const STYLES: Record<KitStyle, StyleTokens> = {
  clean: { roughness: 0, font: FONT_FAMILY.Nunito },
  sketchy: { roughness: 1, font: FONT_FAMILY.Excalifont },
};

export const INK = "#1e1e1e";
export const MUTED = "#868e96";
export const LINE = "#ced4da";
export const FILL = "#f1f3f5";
export const ACCENT = "#4263eb";
export const ACCENT_SOFT = "#dbe4ff";

/** Small drawing vocabulary bound to a style. */
export function kit(t: StyleTokens) {
  const base = { roughness: t.roughness, strokeWidth: 1, strokeColor: INK };
  return {
    roughness: t.roughness,
    rect: (x: number, y: number, w: number, h: number, o: Skel = {}): Skel => ({
      type: "rectangle",
      x,
      y,
      width: w,
      height: h,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      roundness: { type: 3 },
      ...base,
      ...o,
    }),
    ellipse: (x: number, y: number, w: number, h: number, o: Skel = {}): Skel => ({
      type: "ellipse",
      x,
      y,
      width: w,
      height: h,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      ...base,
      ...o,
    }),
    line: (x: number, y: number, dx: number, dy: number, o: Skel = {}): Skel => ({
      type: "line",
      x,
      y,
      points: [
        [0, 0],
        [dx, dy],
      ],
      ...base,
      strokeColor: LINE,
      ...o,
    }),
    text: (x: number, y: number, text: string, size = 16, o: Skel = {}): Skel => ({
      type: "text",
      x,
      y,
      text,
      fontSize: size,
      fontFamily: t.font,
      strokeColor: INK,
      ...o,
    }),
    /** A rectangle with centered text (Excalidraw bound label). */
    box: (x: number, y: number, w: number, h: number, label: string, o: Skel = {}, size = 16): Skel => ({
      type: "rectangle",
      x,
      y,
      width: w,
      height: h,
      backgroundColor: "#ffffff",
      fillStyle: "solid",
      roundness: { type: 3 },
      ...base,
      ...o,
      label: { text: label, fontSize: size, fontFamily: t.font, strokeColor: o.labelColor ?? INK },
    }),
  };
}

export type K = ReturnType<typeof kit>;

export function kitFor(style: KitStyle): K {
  return kit(STYLES[style]);
}

/** Image placeholder: a light box with a cross. */
export const image = (k: K, x: number, y: number, w: number, h: number): Skel[] => [
  k.rect(x, y, w, h, { backgroundColor: FILL, strokeColor: LINE, roundness: { type: 3 } }),
  k.line(x + 8, y + 8, w - 16, h - 16),
  k.line(x + 8, y + h - 8, w - 16, -(h - 16)),
];

export const icon = (k: K, x: number, y: number, s = 20): Skel =>
  k.rect(x, y, s, s, { backgroundColor: FILL, strokeColor: LINE, roundness: { type: 3 } });

export interface KitItem {
  id: string;
  name: string;
  category: Category;
  build: (k: K) => Skel[];
}

export type Category = "Screens" | "Navigation" | "Inputs" | "Content" | "Overlays" | "Notes";

export const CATEGORIES: Category[] = ["Screens", "Navigation", "Inputs", "Content", "Overlays", "Notes"];

const screen =
  (name: string, w: number, h: number) =>
  (k: K): Skel[] => [
    { type: "frame", x: 0, y: 0, width: w, height: h, name, children: [] },
    k.rect(0, 0, w, h, { strokeColor: "#adb5bd", roundness: null, backgroundColor: "#ffffff" }),
  ];

export const KIT: KitItem[] = [
  // ------------------------------------------------------------- Screens
  {
    id: "phone",
    name: "Phone",
    category: "Screens",
    build: (k) => [
      ...screen("Phone", 390, 844)(k),
      k.text(24, 16, "9:41", 14, { strokeColor: MUTED }),
      k.rect(150, 820, 90, 5, { backgroundColor: INK, strokeColor: INK }),
    ],
  },
  { id: "tablet", name: "Tablet", category: "Screens", build: (k) => screen("Tablet", 820, 1180)(k) },
  { id: "desktop", name: "Desktop", category: "Screens", build: (k) => screen("Desktop", 1280, 800)(k) },
  {
    id: "browser",
    name: "Browser",
    category: "Screens",
    build: (k) => [
      ...screen("Browser", 1280, 800)(k),
      k.rect(0, 0, 1280, 44, { backgroundColor: FILL, strokeColor: LINE, roundness: null }),
      k.ellipse(16, 16, 12, 12, { backgroundColor: "#ff6b6b", strokeColor: "#ff6b6b" }),
      k.ellipse(36, 16, 12, 12, { backgroundColor: "#fcc419", strokeColor: "#fcc419" }),
      k.ellipse(56, 16, 12, 12, { backgroundColor: "#51cf66", strokeColor: "#51cf66" }),
      k.box(380, 9, 520, 26, "yourproduct.com", { strokeColor: LINE, labelColor: MUTED }, 13),
    ],
  },

  // ---------------------------------------------------------- Navigation
  {
    id: "navbar",
    name: "Top bar",
    category: "Navigation",
    build: (k) => [
      k.rect(0, 0, 1280, 64, { strokeColor: LINE, roundness: null }),
      k.text(32, 20, "Logo", 20),
      k.text(760, 22, "Product", 16),
      k.text(860, 22, "Pricing", 16),
      k.text(955, 22, "About", 16),
      k.box(1100, 14, 140, 36, "Get started", { backgroundColor: ACCENT, strokeColor: ACCENT, labelColor: "#ffffff" }),
    ],
  },
  {
    id: "appbar",
    name: "App bar",
    category: "Navigation",
    build: (k) => [
      k.rect(0, 0, 390, 56, { strokeColor: LINE, roundness: null }),
      k.text(16, 16, "‹", 22),
      k.text(160, 16, "Title", 18),
      icon(k, 350, 18),
    ],
  },
  {
    id: "tabbar",
    name: "Tab bar",
    category: "Navigation",
    build: (k) => [
      k.rect(0, 0, 390, 72, { strokeColor: LINE, roundness: null }),
      ...["Home", "Search", "Inbox", "Profile"].flatMap((label, i) => [
        icon(k, 34 + i * 92, 12, 24),
        k.text(26 + i * 92, 42, label, 12, { strokeColor: i === 0 ? ACCENT : MUTED }),
      ]),
    ],
  },
  {
    id: "sidenav",
    name: "Side menu",
    category: "Navigation",
    build: (k) => [
      k.rect(0, 0, 220, 420, { backgroundColor: FILL, strokeColor: LINE, roundness: null }),
      k.text(20, 20, "Workspace", 18),
      ...["Dashboard", "Projects", "Team", "Reports", "Settings"].flatMap((label, i) => [
        ...(i === 0 ? [k.rect(10, 66, 200, 36, { backgroundColor: ACCENT_SOFT, strokeColor: "transparent" })] : []),
        icon(k, 22, 74 + i * 44, 20),
        k.text(54, 74 + i * 44, label, 15, { strokeColor: i === 0 ? ACCENT : INK }),
      ]),
    ],
  },
  {
    id: "tabs",
    name: "Tabs",
    category: "Navigation",
    build: (k) => [
      k.text(0, 0, "Overview", 16, { strokeColor: ACCENT }),
      k.text(110, 0, "Activity", 16, { strokeColor: MUTED }),
      k.text(210, 0, "Settings", 16, { strokeColor: MUTED }),
      k.line(0, 30, 320, 0),
      k.line(0, 30, 80, 0, { strokeColor: ACCENT, strokeWidth: 2 }),
    ],
  },
  {
    id: "breadcrumbs",
    name: "Breadcrumbs",
    category: "Navigation",
    build: (k) => [k.text(0, 0, "Home  /  Projects  /  Onboarding", 14, { strokeColor: MUTED })],
  },

  // -------------------------------------------------------------- Inputs
  {
    id: "button",
    name: "Button",
    category: "Inputs",
    build: (k) => [
      k.box(0, 0, 140, 44, "Continue", { backgroundColor: ACCENT, strokeColor: ACCENT, labelColor: "#ffffff" }),
    ],
  },
  {
    id: "button-secondary",
    name: "Secondary button",
    category: "Inputs",
    build: (k) => [k.box(0, 0, 140, 44, "Cancel", { strokeColor: LINE })],
  },
  {
    id: "textfield",
    name: "Text field",
    category: "Inputs",
    build: (k) => [
      k.text(0, 0, "Email", 14),
      k.rect(0, 24, 300, 44, { strokeColor: LINE }),
      k.text(14, 36, "you@example.com", 15, { strokeColor: MUTED }),
    ],
  },
  {
    id: "search",
    name: "Search",
    category: "Inputs",
    build: (k) => [
      k.rect(0, 0, 300, 40, { backgroundColor: FILL, strokeColor: LINE, roundness: { type: 3 } }),
      k.ellipse(14, 12, 14, 14, { backgroundColor: "transparent", strokeColor: MUTED }),
      k.text(40, 10, "Search…", 15, { strokeColor: MUTED }),
    ],
  },
  {
    id: "checkbox",
    name: "Checkbox",
    category: "Inputs",
    build: (k) => [
      k.rect(0, 2, 20, 20, { strokeColor: ACCENT, backgroundColor: ACCENT_SOFT }),
      k.text(32, 0, "Remember me", 16),
    ],
  },
  {
    id: "radio",
    name: "Radio",
    category: "Inputs",
    build: (k) => [
      k.ellipse(0, 2, 20, 20, { strokeColor: ACCENT }),
      k.ellipse(5, 7, 10, 10, { strokeColor: ACCENT, backgroundColor: ACCENT }),
      k.text(32, 0, "Monthly", 16),
    ],
  },
  {
    id: "toggle",
    name: "Toggle",
    category: "Inputs",
    build: (k) => [
      k.rect(0, 0, 48, 28, { backgroundColor: ACCENT, strokeColor: ACCENT, roundness: { type: 3 } }),
      k.ellipse(23, 3, 22, 22, { strokeColor: "#ffffff" }),
      k.text(60, 3, "Notifications", 16),
    ],
  },
  {
    id: "select",
    name: "Dropdown",
    category: "Inputs",
    build: (k) => [
      k.rect(0, 0, 220, 44, { strokeColor: LINE }),
      k.text(14, 12, "Choose a plan", 15, { strokeColor: MUTED }),
      k.text(194, 10, "⌄", 18, { strokeColor: MUTED }),
    ],
  },
  {
    id: "slider",
    name: "Slider",
    category: "Inputs",
    build: (k) => [
      k.line(0, 12, 260, 0, { strokeWidth: 3 }),
      k.line(0, 12, 150, 0, { strokeColor: ACCENT, strokeWidth: 3 }),
      k.ellipse(140, 2, 20, 20, { strokeColor: ACCENT }),
    ],
  },

  // ------------------------------------------------------------- Content
  {
    id: "heading",
    name: "Heading + text",
    category: "Content",
    build: (k) => [
      k.text(0, 0, "Build better, faster", 32),
      k.text(0, 52, "A short line that explains the value\nin plain words.", 16, { strokeColor: MUTED }),
    ],
  },
  { id: "image", name: "Image", category: "Content", build: (k) => image(k, 0, 0, 240, 160) },
  {
    id: "card",
    name: "Card",
    category: "Content",
    build: (k) => [
      k.rect(0, 0, 260, 290, { strokeColor: LINE }),
      ...image(k, 12, 12, 236, 140),
      k.text(16, 166, "Card title", 18),
      k.text(16, 196, "Supporting text that\nexplains the card.", 14, { strokeColor: MUTED }),
      k.box(16, 240, 100, 34, "Open", { strokeColor: LINE }, 14),
    ],
  },
  {
    id: "listitem",
    name: "List row",
    category: "Content",
    build: (k) => [
      k.ellipse(0, 4, 40, 40, { backgroundColor: FILL, strokeColor: LINE }),
      k.text(56, 2, "Alex Morgan", 16),
      k.text(56, 26, "Last message preview…", 13, { strokeColor: MUTED }),
      k.text(330, 12, "›", 20, { strokeColor: MUTED }),
      k.line(56, 54, 290, 0),
    ],
  },
  {
    id: "avatar",
    name: "Avatar",
    category: "Content",
    build: (k) => [k.ellipse(0, 0, 48, 48, { backgroundColor: FILL, strokeColor: LINE }), k.text(60, 12, "Jamie", 16)],
  },
  {
    id: "stat",
    name: "Stat",
    category: "Content",
    build: (k) => [
      k.rect(0, 0, 200, 110, { strokeColor: LINE }),
      k.text(16, 14, "Active users", 14, { strokeColor: MUTED }),
      k.text(16, 40, "12,480", 30),
      k.text(16, 80, "↑ 8% this week", 13, { strokeColor: "#2f9e44" }),
    ],
  },
  {
    id: "chart",
    name: "Chart",
    category: "Content",
    build: (k) => [
      k.rect(0, 0, 320, 200, { strokeColor: LINE }),
      ...[60, 100, 80, 130, 110, 150].map((h, i) =>
        k.rect(24 + i * 48, 180 - h, 28, h, {
          backgroundColor: i === 5 ? ACCENT : ACCENT_SOFT,
          strokeColor: "transparent",
          roundness: null,
        }),
      ),
      k.line(16, 180, 288, 0),
    ],
  },
  {
    id: "table",
    name: "Table",
    category: "Content",
    build: (k) => [
      k.rect(0, 0, 480, 176, { strokeColor: LINE, roundness: null }),
      k.rect(0, 0, 480, 44, { backgroundColor: FILL, strokeColor: LINE, roundness: null }),
      ...["Name", "Status", "Owner"].map((h, i) => k.text(16 + i * 160, 12, h, 14, { strokeColor: MUTED })),
      ...[1, 2, 3].flatMap((r) => [
        k.line(0, 44 * r, 480, 0),
        k.text(16, 44 * r + 12, `Row ${r}`, 14),
        k.text(176, 44 * r + 12, r === 2 ? "Blocked" : "Active", 14, { strokeColor: r === 2 ? "#e03131" : "#2f9e44" }),
        k.text(336, 44 * r + 12, "Sam", 14),
      ]),
    ],
  },
  {
    id: "badge",
    name: "Badge",
    category: "Content",
    build: (k) => [
      k.box(0, 0, 72, 26, "New", { backgroundColor: ACCENT_SOFT, strokeColor: "transparent", labelColor: ACCENT }, 13),
    ],
  },
  { id: "divider", name: "Divider", category: "Content", build: (k) => [k.line(0, 0, 320, 0)] },

  // ------------------------------------------------------------ Overlays
  {
    id: "modal",
    name: "Dialog",
    category: "Overlays",
    build: (k) => [
      k.rect(0, 0, 360, 200, { strokeColor: LINE }),
      k.text(24, 22, "Delete project?", 20),
      k.text(24, 60, "This can't be undone. All boards\nin it will be removed.", 15, { strokeColor: MUTED }),
      k.box(140, 140, 96, 40, "Cancel", { strokeColor: LINE }, 15),
      k.box(
        246,
        140,
        96,
        40,
        "Delete",
        { backgroundColor: "#e03131", strokeColor: "#e03131", labelColor: "#ffffff" },
        15,
      ),
    ],
  },
  {
    id: "toast",
    name: "Toast",
    category: "Overlays",
    build: (k) => [
      k.box(0, 0, 280, 48, "Saved ✓", { backgroundColor: INK, strokeColor: INK, labelColor: "#ffffff" }, 15),
    ],
  },
  {
    id: "empty",
    name: "Empty state",
    category: "Overlays",
    build: (k) => [
      k.ellipse(110, 0, 80, 80, { backgroundColor: FILL, strokeColor: LINE }),
      k.text(70, 100, "Nothing here yet", 18),
      k.text(52, 132, "Create your first project to start.", 14, { strokeColor: MUTED }),
      k.box(90, 170, 120, 40, "Create", { backgroundColor: ACCENT, strokeColor: ACCENT, labelColor: "#ffffff" }, 15),
    ],
  },
  {
    id: "tooltip",
    name: "Tooltip",
    category: "Overlays",
    build: (k) => [
      k.box(0, 0, 160, 34, "Helpful hint", { backgroundColor: INK, strokeColor: INK, labelColor: "#ffffff" }, 13),
    ],
  },

  // ---------------------------------------------------------------- Notes
  {
    id: "sticky",
    name: "Sticky note",
    category: "Notes",
    build: (k) => [
      k.box(0, 0, 180, 140, "Idea…", { backgroundColor: "#ffec99", strokeColor: "transparent", roundness: null }, 18),
    ],
  },
  {
    id: "marker",
    name: "Step marker",
    category: "Notes",
    build: (k) => [
      k.box(
        0,
        0,
        32,
        32,
        "1",
        { type: "ellipse", backgroundColor: "#e03131", strokeColor: "#e03131", labelColor: "#ffffff" },
        16,
      ),
    ],
  },
  {
    id: "callout",
    name: "Callout",
    category: "Notes",
    build: (k) => [
      k.box(
        0,
        0,
        200,
        60,
        "Why is this here?",
        { backgroundColor: "#fff5f5", strokeColor: "#e03131", labelColor: "#e03131" },
        15,
      ),
      {
        type: "arrow",
        x: 100,
        y: 60,
        points: [
          [0, 0],
          [-40, 70],
        ],
        strokeColor: "#e03131",
        roughness: k.roughness,
      },
    ],
  },
];

/**
 * Converts a kit item to Excalidraw elements, grouped as one object, with
 * its top-left at (x, y). Screens become frames that other items snap into.
 */
export function buildKitElements(item: KitItem, style: KitStyle, x = 0, y = 0): ExcalidrawElement[] {
  const skeleton = item.build(kit(STYLES[style])).map((s) => ({ ...s, x: (s.x ?? 0) + x, y: (s.y ?? 0) + y }));
  const elements = convertToExcalidrawElements(skeleton as any, { regenerateIds: true });
  const isScreen = item.category === "Screens";
  const groupId = `kit-${item.id}-${Math.random().toString(36).slice(2, 8)}`;
  const frame = elements.find((e) => e.type === "frame");
  return elements.map((e) => {
    if (e.type === "frame") return e;
    // Screen parts belong to the frame; other items become one group.
    return (isScreen && frame ? { ...e, frameId: frame.id } : { ...e, groupIds: [groupId] }) as ExcalidrawElement;
  });
}
