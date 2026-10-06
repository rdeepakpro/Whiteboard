/**
 * Built-in templates. Each is an ordinary Excalidraw scene generated with
 * Excalidraw's own `convertToExcalidrawElements` skeleton API. User templates
 * are plain `.excalidraw` files in <appData>/templates.
 */
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { emptySceneJSON, serializeScene } from "../editor/scene";
import { ipc } from "../platform/ipc";
import { getApp } from "../state/store";

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Path for user templates. */
  path?: string;
  build: () => Promise<string>;
}

const C = {
  yellow: "#ffec99",
  blue: "#a5d8ff",
  green: "#b2f2bb",
  red: "#ffc9c9",
  violet: "#d0bfff",
  orange: "#ffd8a8",
  grey: "#e9ecef",
  teal: "#96f2d7",
};

type Skel = Record<string, any>;

const box = (id: string, x: number, y: number, w: number, h: number, text: string, bg = "transparent", extra: Skel = {}): Skel => ({
  type: "rectangle",
  id,
  x,
  y,
  width: w,
  height: h,
  backgroundColor: bg,
  fillStyle: "solid",
  roundness: { type: 3 },
  label: { text, fontSize: 20 },
  ...extra,
});

const ellipse = (id: string, x: number, y: number, w: number, h: number, text: string, bg = "transparent"): Skel => ({
  type: "ellipse", id, x, y, width: w, height: h, backgroundColor: bg, fillStyle: "solid", label: { text, fontSize: 24 },
});

const diamond = (id: string, x: number, y: number, w: number, h: number, text: string, bg = "transparent"): Skel => ({
  type: "diamond", id, x, y, width: w, height: h, backgroundColor: bg, fillStyle: "solid", label: { text, fontSize: 18 },
});

const text = (x: number, y: number, t: string, fontSize = 20, extra: Skel = {}): Skel => ({ type: "text", x, y, text: t, fontSize, ...extra });

const arrow = (from: string, to: string, label?: string): Skel => ({
  type: "arrow",
  x: 0,
  y: 0,
  start: { id: from },
  end: { id: to },
  ...(label ? { label: { text: label, fontSize: 16 } } : {}),
});

/**
 * Bound arrows need a real start point and vector. Place each arrow between
 * the edges of the two shapes it connects (Excalidraw then binds it).
 */
function layoutArrows(skeleton: Skel[]): Skel[] {
  const byId = new Map(skeleton.filter((e) => e.id).map((e) => [e.id, e]));
  const GAP = 8;
  return skeleton.map((e) => {
    if (e.type !== "arrow" || !e.start?.id || !e.end?.id) return e;
    const a = byId.get(e.start.id);
    const b = byId.get(e.end.id);
    if (!a || !b) return e;
    const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    const len = Math.hypot(dx, dy) || 1;
    const edge = (box: Skel) => Math.min(box.width / 2 / Math.abs(dx / len || 1e-9), box.height / 2 / Math.abs(dy / len || 1e-9));
    const ta = edge(a) + GAP;
    const tb = edge(b) + GAP;
    const sx = ca.x + (dx / len) * ta;
    const sy = ca.y + (dy / len) * ta;
    const ex = cb.x - (dx / len) * tb;
    const ey = cb.y - (dy / len) * tb;
    return { ...e, x: sx, y: sy, width: ex - sx, height: ey - sy, points: [[0, 0], [ex - sx, ey - sy]] };
  });
}

function scene(skeleton: Skel[]): string {
  const elements = convertToExcalidrawElements(layoutArrows(skeleton) as any, { regenerateIds: true });
  return serializeScene(elements, { viewBackgroundColor: "#ffffff" }, {});
}

const BUILTIN: { id: string; name: string; description: string; skeleton: () => Skel[] }[] = [
  {
    id: "brainstorm",
    name: "Brainstorm",
    description: "A question in the middle, sticky notes around it",
    skeleton: () => {
      const notes: Skel[] = [];
      const colors = [C.yellow, C.blue, C.green, C.red, C.violet, C.orange];
      for (let i = 0; i < 12; i++) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        notes.push(box(`n${i}`, col * 220, 220 + row * 170, 190, 140, "Idea", colors[i % colors.length], { roundness: null, strokeColor: "transparent" }));
      }
      return [text(0, 0, "What are we exploring?", 36), text(0, 60, "Dump every idea — sort later.", 20, { strokeColor: "#868e96" }), ...notes];
    },
  },
  {
    id: "mindmap",
    name: "Mind Map",
    description: "Central topic with branches and sub-ideas",
    skeleton: () => {
      const out: Skel[] = [ellipse("c", 380, 260, 240, 120, "Central topic", C.yellow)];
      const branches = [
        { id: "b1", x: 40, y: 40, color: C.blue },
        { id: "b2", x: 760, y: 40, color: C.green },
        { id: "b3", x: 40, y: 500, color: C.violet },
        { id: "b4", x: 760, y: 500, color: C.orange },
      ];
      branches.forEach((b, i) => {
        out.push(box(b.id, b.x, b.y, 200, 80, `Branch ${i + 1}`, b.color));
        out.push(arrow("c", b.id));
        const dx = b.x < 400 ? -240 : 260;
        for (let j = 0; j < 2; j++) {
          const id = `${b.id}s${j}`;
          out.push(box(id, b.x + dx, b.y - 40 + j * 110, 180, 60, "Sub-idea"));
          out.push({ ...arrow(b.id, id), strokeStyle: "dashed" });
        }
      });
      return out;
    },
  },
  {
    id: "userflow",
    name: "User Flow",
    description: "Screens, decisions and outcomes",
    skeleton: () => [
      ellipse("s", 0, 100, 160, 80, "Start", C.green),
      box("a", 240, 95, 200, 90, "Landing screen", C.blue),
      diamond("d", 520, 70, 200, 140, "Signed in?", C.yellow),
      box("y", 820, 0, 200, 90, "Dashboard", C.blue),
      box("n", 820, 190, 200, 90, "Sign up", C.blue),
      ellipse("e", 1100, 95, 160, 80, "Done", C.red),
      arrow("s", "a"),
      arrow("a", "d"),
      arrow("d", "y", "Yes"),
      arrow("d", "n", "No"),
      arrow("y", "e"),
      arrow("n", "e"),
    ],
  },
  {
    id: "journey",
    name: "Customer Journey",
    description: "Stages × actions, thoughts, pains, opportunities",
    skeleton: () => {
      const stages = ["Awareness", "Consideration", "Purchase", "Onboarding", "Advocacy"];
      const rows = ["Actions", "Thoughts", "Pain points", "Opportunities"];
      const rowColor = [C.grey, C.blue, C.red, C.green];
      const out: Skel[] = [text(0, -90, "Customer Journey", 36)];
      stages.forEach((s, i) => out.push(box(`h${i}`, 180 + i * 220, 0, 200, 60, s, C.yellow)));
      rows.forEach((r, j) => {
        out.push(text(0, 100 + j * 150, r, 20));
        stages.forEach((_, i) =>
          out.push({ type: "rectangle", x: 180 + i * 220, y: 80 + j * 150, width: 200, height: 130, backgroundColor: rowColor[j], fillStyle: "solid", roundness: { type: 3 } }),
        );
      });
      return out;
    },
  },
  {
    id: "swot",
    name: "SWOT",
    description: "Strengths, weaknesses, opportunities, threats",
    skeleton: () => [
      text(0, -80, "SWOT Analysis", 36),
      box("s", 0, 0, 400, 300, "Strengths", C.green),
      box("w", 420, 0, 400, 300, "Weaknesses", C.red),
      box("o", 0, 320, 400, 300, "Opportunities", C.blue),
      box("t", 420, 320, 400, 300, "Threats", C.orange),
    ].map((b) => (b.label ? { ...b, label: { ...b.label, verticalAlign: "top" } } : b)),
  },
  {
    id: "architecture",
    name: "Architecture",
    description: "Clients, services and data stores",
    skeleton: () => [
      box("web", 0, 0, 180, 80, "Web app", C.blue),
      box("mobile", 0, 140, 180, 80, "Mobile app", C.blue),
      box("api", 300, 70, 200, 80, "API", C.violet),
      box("auth", 620, -40, 180, 80, "Auth service", C.green),
      box("core", 620, 70, 180, 80, "Core service", C.green),
      box("jobs", 620, 180, 180, 80, "Worker", C.green),
      { ...box("db", 920, 20, 180, 90, "Database", C.yellow), type: "ellipse" },
      { ...box("q", 920, 180, 180, 80, "Queue", C.orange) },
      arrow("web", "api"),
      arrow("mobile", "api"),
      arrow("api", "auth"),
      arrow("api", "core"),
      arrow("core", "db"),
      arrow("core", "q"),
      arrow("q", "jobs"),
    ],
  },
  {
    id: "storyboard",
    name: "Storyboard",
    description: "Six frames with captions",
    skeleton: () => {
      const out: Skel[] = [];
      for (let i = 0; i < 6; i++) {
        const x = (i % 3) * 380;
        const y = Math.floor(i / 3) * 360;
        out.push({ type: "frame", id: `f${i}`, x, y, width: 340, height: 240, name: `Scene ${i + 1}`, children: [] });
        out.push(text(x, y + 255, "Caption…", 18, { strokeColor: "#868e96" }));
      }
      return out;
    },
  },
  {
    id: "weekly",
    name: "Weekly Planning",
    description: "Goals plus a column for each day",
    skeleton: () => {
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const out: Skel[] = [text(0, -90, "This week", 36), box("g", 0, 0, 1530, 110, "Goals for the week", C.yellow, { label: { text: "Goals for the week", fontSize: 20, verticalAlign: "top", textAlign: "left" } })];
      days.forEach((d, i) => {
        out.push(box(`d${i}`, i * 220, 140, 200, 50, d, i >= 5 ? C.violet : C.blue));
        out.push({ type: "rectangle", x: i * 220, y: 200, width: 200, height: 420, strokeStyle: "dashed", roundness: { type: 3 } });
      });
      return out;
    },
  },
];

export const BLANK: Template = {
  id: "blank",
  name: "Blank",
  description: "An empty canvas",
  build: async () => emptySceneJSON(),
};

export function builtinTemplates(): Template[] {
  return [BLANK, ...BUILTIN.map((t) => ({ id: t.id, name: t.name, description: t.description, build: async () => scene(t.skeleton()) }))];
}

export async function userTemplates(): Promise<Template[]> {
  const dir = getApp().paths?.templatesDir;
  if (!dir) return [];
  const nodes = await ipc.scanTree(dir).catch(() => []);
  return nodes
    .filter((n) => n.kind === "board")
    .map((n) => ({
      id: `user:${n.path}`,
      name: n.name,
      description: "Your template",
      path: n.path,
      build: async () => (await ipc.readText(n.path)).content,
    }));
}
