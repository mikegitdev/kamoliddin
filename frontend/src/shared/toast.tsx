/**
 * Minimal toast feedback (design review 0.9): one consistent pattern for
 * mutation results that would otherwise float detached from their action.
 * Mounts its own root, auto-dismisses, dismissible, capped stack (oldest
 * drops off), assertive for errors / polite for success.
 */
import { createRoot } from "react-dom/client";
import { IconAlert, IconCheck, IconClose } from "@/shared/icons";
import { ru } from "@/shared/i18n/ru";
import { uz } from "@/shared/i18n/uz";

export type ToastTone = "success" | "error";
/** Errors outlive successes: the reason for a failure must stay readable. */
const AUTO_DISMISS_MS: Record<ToastTone, number> = { success: 3800, error: 6500 };
/** Never more than a few on screen — a burst of failures must not bury the UI. */
const MAX_VISIBLE = 3;

function ToastMessage({
  message,
  tone,
  onClose,
}: {
  message: string;
  tone: ToastTone;
  onClose: () => void;
}) {
  return (
    // Errors are assertive (role=alert); success stays polite (role=status).
    <div className={`toast ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {tone === "success" ? <IconCheck size={16} /> : <IconAlert size={16} />}
      <span>{message}</span>
      <button
        type="button"
        className="toast-close"
        aria-label={closeLabel()}
        onClick={onClose}
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}

let host: HTMLDivElement | null = null;

/** Toasts mount outside the React tree (own root), so context is unavailable;
 *  the i18n provider keeps <html lang> in sync — use it for the label. */
const closeLabel = () => (document.documentElement.lang === "uz" ? uz.close : ru.close);

function ensureHost() {
  if (host) return host;
  host = document.createElement("div");
  host.className = "toast-host";
  document.body.appendChild(host);
  return host;
}

function dismiss(item: HTMLElement, root: { unmount: () => void }) {
  if (!item.isConnected) return;
  item.classList.add("leaving");
  window.setTimeout(() => {
    root.unmount();
    item.remove();
  }, 200);
}

function showToast(message: string, tone: ToastTone) {
  const h = ensureHost();
  // Cap the stack: drop the oldest before mounting a new one.
  while (h.children.length >= MAX_VISIBLE) {
    h.firstElementChild?.remove();
  }
  const item = document.createElement("div");
  h.appendChild(item);
  const itemRoot = createRoot(item);
  const close = () => dismiss(item, itemRoot);
  itemRoot.render(<ToastMessage message={message} tone={tone} onClose={close} />);
  window.setTimeout(close, AUTO_DISMISS_MS[tone]);
}

export const toast = {
  success: (message: string) => showToast(message, "success"),
  error: (message: string) => showToast(message, "error"),
};
