/**
 * The Design panel — an Excalidraw sidebar (same mechanism as Excalidraw's
 * own Library) shown on Design boards. Click a piece to drop it in the middle
 * of the view (or into the selected screen), or drag it onto the canvas.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Sidebar,
  exportToSvg,
  getCommonBounds,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI, LibraryItems } from "@excalidraw/excalidraw/types";
import { getApp, setApp, useApp } from "../state/store";
import { schedulePersist } from "../state/persist";
import { viewportCenter } from "../lib/canvasInsert";
import { toast } from "../lib/toast";
import { buildKitElements, CATEGORIES, KIT, type KitItem, type KitStyle } from "./kit";

export const DESIGN_SIDEBAR = "wb-design";

export const designIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="6" height="6" rx="1.5" />
    <rect x="11" y="3" width="6" height="6" rx="3" />
    <rect x="3" y="11" width="6" height="6" rx="1.5" />
    <path d="M11 14h6M14 11v6" />
  </svg>
);

const LIB_MIME = "application/vnd.excalidrawlib+json";

function libraryItem(item: KitItem, style: KitStyle) {
  return {
    id: `wb-kit-${item.id}-${style}`,
    status: "unpublished" as const,
    elements: buildKitElements(item, style),
    created: Date.now(),
    name: item.name,
  };
}

/** Puts a kit item on the canvas, inside the selected screen if there is one. */
export function insertKitItem(api: ExcalidrawImperativeAPI, item: KitItem, style: KitStyle) {
  const built = buildKitElements(item, style);
  const [x1, y1, x2, y2] = getCommonBounds(built);
  const w = x2 - x1;
  const h = y2 - y1;
  const scene = api.getSceneElements();
  const selected = api.getAppState().selectedElementIds;
  // Target screen: a selected frame, or the frame of a selected element.
  const sel = scene.find((e) => selected[e.id]);
  const frame =
    item.category === "Screens"
      ? null
      : (scene.find((e) => e.type === "frame" && (selected[e.id] || e.id === sel?.frameId)) ?? null);
  let left: number;
  let top: number;
  if (frame) {
    // Stack below what's already in the screen, ignoring the full-size
    // background and anything anchored in the bottom quarter (tab bars,
    // primary buttons). Falls back to the screen's middle if it won't fit.
    const fb = frame.y + frame.height;
    const contentBottom = scene
      .filter((e) => e.frameId === frame.id && !e.isDeleted)
      .filter((e) => !(e.width >= frame.width - 2 && e.height >= frame.height - 2))
      .filter((e) => e.y < frame.y + frame.height * 0.75)
      .reduce((b, e) => Math.max(b, e.y + e.height), frame.y + 24);
    left = w > frame.width - 48 ? frame.x + (frame.width - w) / 2 : frame.x + 24;
    top = contentBottom + 16;
    if (top + h > fb - 16) top = frame.y + Math.max(16, (frame.height - h) / 2);
  } else {
    const c = viewportCenter(api);
    left = c.x - w / 2;
    top = c.y - h / 2;
  }
  const dx = left - x1;
  const dy = top - y1;
  const placed = built.map(
    (e) =>
      ({
        ...e,
        x: e.x + dx,
        y: e.y + dy,
        ...(frame && e.type !== "frame" ? { frameId: frame.id } : {}),
      }) as ExcalidrawElement,
  );
  const groupId = placed.find((e) => e.groupIds.length)?.groupIds[0];
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...placed],
    appState: {
      selectedElementIds: Object.fromEntries(
        placed.filter((e) => e.type !== "frame" || item.category === "Screens").map((e) => [e.id, true]),
      ),
      selectedGroupIds: groupId ? { [groupId]: true } : {},
    } as any,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

const previewCache = new Map<string, Promise<SVGSVGElement>>();

const Preview = memo(function Preview({ item, style }: { item: KitItem; style: KitStyle }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const key = `${item.id}:${style}`;
    if (!previewCache.has(key)) {
      previewCache.set(
        key,
        exportToSvg({
          elements: buildKitElements(item, style),
          appState: { exportBackground: false, viewBackgroundColor: "transparent" } as any,
          files: null,
          exportPadding: 4,
        }),
      );
    }
    previewCache.get(key)!.then((svg) => {
      if (cancelled || !ref.current) return;
      const copy = svg.cloneNode(true) as SVGSVGElement;
      copy.removeAttribute("width");
      copy.removeAttribute("height");
      ref.current.replaceChildren(copy);
    });
    return () => {
      cancelled = true;
    };
  }, [item, style]);
  return <div className="wb-kit__preview" ref={ref} />;
});

export function DesignPanel({ getApi }: { getApi: () => ExcalidrawImperativeAPI | null }) {
  const style = useApp((s) => s.prefs.designStyle);
  const docked = useApp((s) => s.prefs.designDocked);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        category: c,
        items: KIT.filter((i) => i.category === c && (!q || `${i.name} ${i.category}`.toLowerCase().includes(q))),
      })).filter((g) => g.items.length),
    [q],
  );

  const setPref = (patch: Partial<ReturnType<typeof getApp>["prefs"]>) => {
    setApp((s) => ({ prefs: { ...s.prefs, ...patch } }));
    schedulePersist();
  };

  const addToLibrary = async () => {
    const api = getApi();
    if (!api) return;
    await api.updateLibrary({
      libraryItems: KIT.map((i) => libraryItem(i, style)) as unknown as LibraryItems,
      merge: true,
      openLibraryMenu: true,
    });
    toast(`Added ${KIT.length} pieces to your Library`);
  };

  return (
    <Sidebar name={DESIGN_SIDEBAR} docked={docked} onDock={(d) => setPref({ designDocked: d })} className="wb-design">
      <Sidebar.Header>
        <span className="wb-kit__title">Design</span>
      </Sidebar.Header>
      <div className="wb-kit">
        <div className="wb-kit__controls">
          <div className="wb-kit__seg" role="radiogroup" aria-label="Style">
            {(["clean", "sketchy"] as KitStyle[]).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={style === s}
                className={style === s ? "active" : ""}
                onClick={() => setPref({ designStyle: s })}
              >
                {s === "clean" ? "Clean" : "Sketchy"}
              </button>
            ))}
          </div>
          <input
            className="wb-kit__search"
            placeholder="Find a piece…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="wb-kit__scroll">
          {groups.map((g) => (
            <section key={g.category}>
              <div className="wb-kit__cat">{g.category}</div>
              <div className="wb-kit__grid">
                {g.items.map((item) => (
                  <button
                    key={item.id}
                    className="wb-kit__tile"
                    title={`${item.name} — click to add, or drag onto the canvas`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        LIB_MIME,
                        serializeLibraryAsJSON([libraryItem(item, style)] as unknown as LibraryItems),
                      );
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => {
                      const api = getApi();
                      if (api) insertKitItem(api, item, style);
                    }}
                  >
                    <Preview item={item} style={style} />
                    <span className="wb-kit__name">{item.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!groups.length && <div className="wb-kit__empty">No pieces match “{query}”.</div>}
          <div className="wb-kit__footer">
            <button className="wb-kit__link" onClick={addToLibrary}>
              Add these to my Library
            </button>
            <span>Tip: select a screen first and pieces land inside it.</span>
          </div>
        </div>
      </div>
    </Sidebar>
  );
}
