// Minimal toast queue rendered by shell/Toasts.tsx.
import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
  action?: { label: string; run: () => void };
}

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextId = 1;

export function toast(message: string, kind: Toast["kind"] = "info", action?: Toast["action"]) {
  const id = nextId++;
  useToasts.setState((s) => ({
    toasts: [...s.toasts.filter((t) => t.message !== message), { id, message, kind, action }].slice(-3),
  }));
  window.setTimeout(() => dismissToast(id), kind === "error" ? 7000 : action ? 6000 : 3000);
}

export function dismissToast(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
