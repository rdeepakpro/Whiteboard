/**
 * Design templates: ready-made low-fi screens inside named frames, built from
 * the same vocabulary as the kit. They are ordinary Excalidraw scenes with
 * the grid turned on, so you can start rearranging immediately.
 */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { serializeScene } from "../editor/scene";
import { ACCENT, ACCENT_SOFT, FILL, INK, LINE, MUTED, icon, image, kitFor, type K, type KitStyle } from "./kit";

type Skel = Record<string, any>;

interface Frame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Contents, positioned relative to the frame's top-left. */
  body: (k: K) => Skel[];
}

const phone = (name: string, x: number, body: Frame["body"]): Frame => ({ name, x, y: 0, w: 390, h: 844, body });

function buildScene(style: KitStyle, frames: Frame[], extra: (k: K) => Skel[] = () => []): string {
  const k = kitFor(style);
  const out: ExcalidrawElement[] = [];
  for (const f of frames) {
    const [frame] = convertToExcalidrawElements(
      [{ type: "frame", x: f.x, y: f.y, width: f.w, height: f.h, name: f.name, children: [] } as any],
      {
        regenerateIds: true,
      },
    );
    const body = [k.rect(0, 0, f.w, f.h, { strokeColor: LINE, roundness: null }), ...f.body(k)].map((s) => ({
      ...s,
      x: (s.x ?? 0) + f.x,
      y: (s.y ?? 0) + f.y,
    }));
    const inner = convertToExcalidrawElements(body as any, { regenerateIds: true }).map(
      (e) => ({ ...e, frameId: frame.id }) as ExcalidrawElement,
    );
    out.push(frame, ...inner);
  }
  out.push(...convertToExcalidrawElements(extra(k) as any, { regenerateIds: true }));
  return serializeScene(out, { viewBackgroundColor: "#ffffff", gridModeEnabled: true, gridSize: 20 } as any, {});
}

const appBar = (k: K, title: string): Skel[] => [
  k.rect(0, 44, 390, 56, { strokeColor: LINE, roundness: null }),
  k.text(16, 60, "‹", 22),
  k.text(195 - title.length * 4.5, 60, title, 18),
];
const status = (k: K): Skel[] => [k.text(24, 14, "9:41", 14, { strokeColor: MUTED })];
const primary = (k: K, x: number, y: number, w: number, label: string) =>
  k.box(x, y, w, 48, label, { backgroundColor: ACCENT, strokeColor: ACCENT, labelColor: "#ffffff" });
const field = (k: K, x: number, y: number, label: string, hint: string): Skel[] => [
  k.text(x, y, label, 14),
  k.rect(x, y + 24, 342, 46, { strokeColor: LINE }),
  k.text(x + 14, y + 37, hint, 15, { strokeColor: MUTED }),
];
const toggleRow = (k: K, y: number, label: string, on: boolean): Skel[] => [
  k.text(24, y + 4, label, 16),
  k.rect(318, y, 48, 28, {
    backgroundColor: on ? ACCENT : FILL,
    strokeColor: on ? ACCENT : LINE,
    roundness: { type: 3 },
  }),
  k.ellipse(on ? 341 : 321, y + 3, 22, 22, { strokeColor: on ? "#ffffff" : LINE }),
  k.line(24, y + 46, 342, 0),
];
const stepArrow = (x1: number, x2: number): Skel => ({
  type: "arrow",
  x: x1,
  y: 422,
  points: [
    [0, 0],
    [x2 - x1, 0],
  ],
  strokeColor: MUTED,
});

export interface DesignTemplate {
  id: string;
  name: string;
  description: string;
  build: (style: KitStyle) => string;
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: "design-blank-phone",
    name: "Blank phone",
    description: "One empty phone screen",
    build: (style) => buildScene(style, [phone("Screen", 0, (k) => status(k))]),
  },
  {
    id: "design-blank-desktop",
    name: "Blank desktop",
    description: "One empty browser window",
    build: (style) =>
      buildScene(style, [
        {
          name: "Page",
          x: 0,
          y: 0,
          w: 1280,
          h: 800,
          body: (k) => [
            k.rect(0, 0, 1280, 44, { backgroundColor: FILL, strokeColor: LINE, roundness: null }),
            k.box(380, 9, 520, 26, "yourproduct.com", { strokeColor: LINE, labelColor: MUTED }, 13),
          ],
        },
      ]),
  },
  {
    id: "design-signup",
    name: "Sign-up screen",
    description: "Form, button and social login",
    build: (style) =>
      buildScene(style, [
        phone("Sign up", 0, (k) => [
          ...status(k),
          k.text(24, 110, "Create account", 30),
          k.text(24, 156, "Start brainstorming in seconds.", 16, { strokeColor: MUTED }),
          ...field(k, 24, 210, "Name", "Your name"),
          ...field(k, 24, 300, "Email", "you@example.com"),
          ...field(k, 24, 390, "Password", "••••••••"),
          primary(k, 24, 500, 342, "Create account"),
          k.text(150, 572, "or continue with", 13, { strokeColor: MUTED }),
          k.box(24, 604, 164, 46, "Apple", { strokeColor: LINE }),
          k.box(202, 604, 164, 46, "Google", { strokeColor: LINE }),
        ]),
      ]),
  },
  {
    id: "design-onboarding",
    name: "Onboarding flow",
    description: "Three connected phone screens",
    build: (style) =>
      buildScene(
        style,
        [
          phone("1 · Welcome", 0, (k) => [
            ...status(k),
            ...image(k, 24, 140, 342, 300),
            k.text(24, 470, "Think visually", 28),
            k.text(24, 514, "Capture ideas the moment\nyou have them.", 16, { strokeColor: MUTED }),
            primary(k, 24, 720, 342, "Get started"),
          ]),
          phone("2 · Pick a goal", 480, (k) => [
            ...status(k),
            ...appBar(k, "Your goal"),
            ...["Launch a product", "Plan a project", "Study better"].flatMap((t, i) => [
              k.box(24, 140 + i * 84, 342, 68, t, {
                strokeColor: i === 0 ? ACCENT : LINE,
                backgroundColor: i === 0 ? ACCENT_SOFT : "#ffffff",
              }),
            ]),
            primary(k, 24, 720, 342, "Continue"),
          ]),
          phone("3 · Home", 960, (k) => [
            ...status(k),
            k.text(24, 60, "Good morning", 26),
            k.rect(24, 112, 342, 40, { backgroundColor: FILL, strokeColor: LINE }),
            k.text(40, 122, "Search boards…", 15, { strokeColor: MUTED }),
            ...[0, 1, 2].flatMap((i) => [
              k.ellipse(24, 184 + i * 72, 44, 44, { backgroundColor: FILL, strokeColor: LINE }),
              k.text(82, 186 + i * 72, ["Product ideas", "Launch plan", "Research"][i], 16),
              k.text(82, 210 + i * 72, "Edited today", 13, { strokeColor: MUTED }),
            ]),
            k.rect(0, 772, 390, 72, { strokeColor: LINE, roundness: null }),
            ...["Home", "Search", "Profile"].flatMap((t, i) => [
              icon(k, 70 + i * 120, 784, 22),
              k.text(62 + i * 120, 812, t, 12, { strokeColor: i === 0 ? ACCENT : MUTED }),
            ]),
          ]),
        ],
        () => [stepArrow(400, 470), stepArrow(880, 950)],
      ),
  },
  {
    id: "design-landing",
    name: "Landing page",
    description: "Nav, hero, features",
    build: (style) =>
      buildScene(style, [
        {
          name: "Landing page",
          x: 0,
          y: 0,
          w: 1280,
          h: 900,
          body: (k) => [
            k.rect(0, 0, 1280, 64, { strokeColor: LINE, roundness: null }),
            k.text(40, 20, "Logo", 20),
            k.text(780, 22, "Product", 16),
            k.text(880, 22, "Pricing", 16),
            k.text(975, 22, "About", 16),
            k.box(1100, 14, 140, 36, "Sign up", {
              backgroundColor: ACCENT,
              strokeColor: ACCENT,
              labelColor: "#ffffff",
            }),
            k.text(80, 170, "The headline that\nsays what you do", 48),
            k.text(80, 310, "One sentence about who it's for and why it matters.", 18, { strokeColor: MUTED }),
            primary(k, 80, 370, 180, "Get started"),
            k.box(276, 370, 160, 48, "Watch demo", { strokeColor: LINE }),
            ...image(k, 680, 130, 520, 340),
            ...[0, 1, 2].flatMap((i) => [
              k.rect(80 + i * 380, 540, 340, 240, { strokeColor: LINE }),
              icon(k, 104 + i * 380, 564, 40),
              k.text(104 + i * 380, 624, ["Fast", "Private", "Simple"][i], 22),
              k.text(104 + i * 380, 664, "A short line about\nthis benefit.", 15, { strokeColor: MUTED }),
            ]),
          ],
        },
      ]),
  },
  {
    id: "design-dashboard",
    name: "Dashboard",
    description: "Side menu, stats, chart, table",
    build: (style) =>
      buildScene(style, [
        {
          name: "Dashboard",
          x: 0,
          y: 0,
          w: 1280,
          h: 800,
          body: (k) => [
            k.rect(0, 0, 220, 800, { backgroundColor: FILL, strokeColor: LINE, roundness: null }),
            k.text(24, 24, "Acme", 20),
            ...["Overview", "Customers", "Revenue", "Settings"].flatMap((t, i) => [
              ...(i === 0
                ? [k.rect(12, 74, 196, 36, { backgroundColor: ACCENT_SOFT, strokeColor: "transparent" })]
                : []),
              k.text(28, 82 + i * 44, t, 15, { strokeColor: i === 0 ? ACCENT : INK }),
            ]),
            k.text(260, 28, "Overview", 26),
            ...["Revenue", "Users", "Churn"].flatMap((t, i) => [
              k.rect(260 + i * 330, 90, 310, 120, { strokeColor: LINE }),
              k.text(280 + i * 330, 106, t, 14, { strokeColor: MUTED }),
              k.text(280 + i * 330, 134, ["$48.2k", "12,480", "2.1%"][i], 30),
            ]),
            k.rect(260, 236, 640, 300, { strokeColor: LINE }),
            ...[90, 140, 120, 180, 160, 220, 200, 250].map((h, i) =>
              k.rect(292 + i * 74, 512 - h, 40, h, {
                backgroundColor: i === 7 ? ACCENT : ACCENT_SOFT,
                strokeColor: "transparent",
                roundness: null,
              }),
            ),
            k.rect(920, 236, 310, 300, { strokeColor: LINE }),
            k.text(940, 254, "Recent activity", 16),
            ...[0, 1, 2, 3].map((i) => k.text(940, 300 + i * 50, "• Something happened", 14, { strokeColor: MUTED })),
            k.rect(260, 560, 970, 200, { strokeColor: LINE, roundness: null }),
            ...["Customer", "Plan", "Status"].map((h, i) => k.text(284 + i * 320, 576, h, 14, { strokeColor: MUTED })),
            ...[1, 2, 3].map((r) => k.line(260, 560 + r * 50, 970, 0)),
          ],
        },
      ]),
  },
  {
    id: "design-settings",
    name: "Settings screen",
    description: "Grouped toggles and rows",
    build: (style) =>
      buildScene(style, [
        phone("Settings", 0, (k) => [
          ...status(k),
          ...appBar(k, "Settings"),
          k.text(24, 124, "NOTIFICATIONS", 12, { strokeColor: MUTED }),
          ...toggleRow(k, 150, "Push notifications", true),
          ...toggleRow(k, 206, "Email digest", false),
          ...toggleRow(k, 262, "Weekly summary", true),
          k.text(24, 344, "ACCOUNT", 12, { strokeColor: MUTED }),
          ...["Profile", "Privacy", "Subscription"].flatMap((t, i) => [
            k.text(24, 374 + i * 52, t, 16),
            k.text(350, 372 + i * 52, "›", 20, { strokeColor: MUTED }),
            k.line(24, 410 + i * 52, 342, 0),
          ]),
          k.box(24, 560, 342, 48, "Log out", { strokeColor: "#e03131", labelColor: "#e03131" }),
        ]),
      ]),
  },
];
