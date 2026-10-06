// Minimal POSIX-style path helpers (macOS first; Windows paths would need
// separator handling here).
export const SEP = "/";

export function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split(SEP);
  return parts[parts.length - 1] ?? p;
}

export function dirname(p: string): string {
  const i = p.replace(/\/+$/, "").lastIndexOf(SEP);
  return i <= 0 ? SEP : p.slice(0, i);
}

export function join(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join(SEP)
    .replace(/\/{2,}/g, SEP);
}

export function stripExt(name: string): string {
  return name.replace(/\.excalidraw$/i, "");
}

export function boardName(path: string): string {
  return stripExt(basename(path));
}

export function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(SEP) ? parent : parent + SEP);
}

/** Folder chain of `path` relative to `root`, e.g. ["Startup", "Product"]. */
export function folderChain(path: string, root: string): string[] | null {
  if (!isInside(path, root)) return null;
  const rel = dirname(path).slice(root.length).replace(/^\/+/, "");
  return rel ? rel.split(SEP) : [];
}

/** Rewrites `p` if it lies inside `from` (used after moving/renaming folders). */
export function rebase(p: string, from: string, to: string): string {
  if (p === from) return to;
  if (isInside(p, from)) return to + p.slice(from.length);
  return p;
}

/** Characters macOS Finder disallows or that break paths. */
export function sanitizeName(name: string): string {
  return name
    .replace(/[/:\\]/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200);
}

export function prettyLocation(path: string, root: string): string {
  const chain = folderChain(path, root);
  if (chain) return chain.length ? chain.join(" / ") : "Whiteboard";
  return dirname(path).replace(/^\/Users\/[^/]+/, "~");
}
