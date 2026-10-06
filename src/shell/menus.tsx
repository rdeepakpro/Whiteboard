// Context menus for boards and folders (sidebar rows, cards, tabs).
import { allFolders, getApp, setApp, type TreeNode } from "../state/store";
import {
  duplicateBoard,
  moveInto,
  newBoard,
  newFolder,
  openBoard,
  reveal,
  setArchived,
  setDesignBoard,
  toggleFavorite,
  trashPath,
} from "../lib/boards";
import { dirname, isInside } from "../lib/paths";
import type { MenuItem } from "./ContextMenu";
import { Icon } from "./icons";

function moveTargets(path: string): MenuItem[] {
  const s = getApp();
  const root = s.prefs.libraryRoot;
  const folders: TreeNode[] = allFolders(s.tree).filter((f) => !isInside(f.path, path) && f.path !== dirname(path));
  const items: MenuItem[] = [];
  if (dirname(path) !== root)
    items.push({ label: "Whiteboard (top level)", icon: Icon.home, onSelect: () => moveInto(path, root) });
  for (const f of folders) {
    const depth = f.path.slice(root.length + 1).split("/").length - 1;
    items.push({ label: `${"   ".repeat(depth)}${f.name}`, icon: Icon.folder, onSelect: () => moveInto(path, f.path) });
  }
  return items.length ? items : [{ label: "No other folders", disabled: true }];
}

export function boardMenu(path: string, opts: { inTree?: boolean } = {}): MenuItem[] {
  const s = getApp();
  const fav = s.favorites.includes(path);
  const archived = s.archived.includes(path);
  const inLibrary = isInside(path, s.prefs.libraryRoot);
  return [
    { label: "Open", icon: Icon.board, onSelect: () => openBoard(path) },
    { label: "Quick Look", icon: Icon.search, shortcut: "Space", onSelect: () => setApp({ quickLook: path }) },
    "separator",
    ...(opts.inTree || inLibrary
      ? [
          {
            label: "Rename",
            icon: Icon.pencil,
            onSelect: () => setApp({ renaming: path, selected: path, sidebarCollapsed: false, focusMode: false }),
          } as MenuItem,
        ]
      : []),
    { label: "Duplicate", icon: Icon.copy, onSelect: () => duplicateBoard(path) },
    ...(inLibrary ? [{ label: "Move To", icon: Icon.move, submenu: moveTargets(path) } as MenuItem] : []),
    "separator",
    {
      label: fav ? "Remove from Favorites" : "Add to Favorites",
      icon: fav ? Icon.starFilled : Icon.star,
      onSelect: () => toggleFavorite(path),
    },
    { label: archived ? "Unarchive" : "Archive", icon: Icon.archive, onSelect: () => setArchived(path, !archived) },
    {
      label: s.designBoards.includes(path) ? "Hide Design Panel" : "Show Design Panel",
      icon: Icon.design,
      onSelect: () => setDesignBoard(path, !getApp().designBoards.includes(path)),
    },
    {
      label: "Version History",
      icon: Icon.history,
      onSelect: async () => {
        await openBoard(path);
        setApp({ historyOpen: true });
      },
    },
    { label: "Show in Finder", icon: Icon.finder, onSelect: () => reveal(path) },
    "separator",
    { label: "Move to Trash", icon: Icon.trash, danger: true, onSelect: () => trashPath(path) },
  ];
}

export function folderMenu(path: string): MenuItem[] {
  return [
    { label: "New Board", icon: Icon.plus, onSelect: () => newBoard({ folder: path }) },
    {
      label: "New Board from Template…",
      icon: Icon.template,
      onSelect: () => setApp({ dialog: { kind: "templates", folder: path } }),
    },
    { label: "New Folder", icon: Icon.folder, onSelect: () => newFolder(path) },
    "separator",
    { label: "Rename", icon: Icon.pencil, onSelect: () => setApp({ renaming: path, selected: path }) },
    { label: "Move To", icon: Icon.move, submenu: moveTargets(path) },
    { label: "Show in Finder", icon: Icon.finder, onSelect: () => reveal(path) },
    "separator",
    { label: "Move to Trash", icon: Icon.trash, danger: true, onSelect: () => trashPath(path) },
  ];
}
