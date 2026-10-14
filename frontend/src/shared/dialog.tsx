/**
 * Self-contained modal dialogs (confirm / report) usable from any component
 * without providers. Each call mounts its own root in a backdrop overlay and
 * resolves a promise on close — replaces window.confirm for a consistent,
 * localized, focus-managed UX.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, ApiError } from "@/shared/api/client";
import type { Dict } from "@/shared/i18n/ru";
import { IconAlert } from "@/shared/icons";

export function mountDialog(render: (close: () => void) => React.ReactNode): Promise<void> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.className = "dialog-backdrop";
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = () => {
      // Restore focus to the element that opened the dialog (WCAG 2.4.3).
      previouslyFocused?.focus();
      root.unmount();
      host.remove();
      resolve();
    };
    // Backdrop click dismisses (clicks inside .dialog stop propagation).
    host.addEventListener("click", (e) => {
      if (e.target === host) close();
    });
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    // Focus trap: Tab cycles inside the dialog while it is mounted
    // (aria-modal without containment strands keyboard users behind it).
    const FOCUSABLE =
      "a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !host.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !host.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    host.addEventListener("keydown", onKeydown);
    root.render(render(close));
  });
}

/* ---------- Confirm ---------- */

export interface ConfirmOptions {
  t: Dict;
  title?: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

function ConfirmBody({ options, close }: { options: ConfirmOptions; close: (v: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Danger flows start on the SAFE action; regular confirms start on the
    // primary one. Enter is NOT a global shortcut anymore: a focused Cancel
    // button must never confirm a destructive action.
    (options.danger ? cancelRef : confirmRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, options.danger]);
  return (
    <div className="dialog" role="alertdialog" aria-modal="true" aria-label={options.title ?? options.body}>
      {options.title && <h3>{options.title}</h3>}
      <p className="dialog-body">{options.body}</p>
      <div className="dialog-actions">
        <button ref={cancelRef} className="btn" onClick={() => close(false)}>
          {options.cancelLabel}
        </button>
        <button
          ref={confirmRef}
          className={`btn primary${options.danger ? " danger-solid" : ""}`}
          onClick={() => close(true)}
        >
          {options.confirmLabel}
        </button>
      </div>
    </div>
  );
}

/** window.confirm replacement: resolves true on confirm, false on cancel/Esc/backdrop. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    void mountDialog((close) => (
      <ConfirmBody
        options={options}
        close={(value) => {
          close();
          resolve(value);
        }}
      />
    ));
  });
}

/* ---------- Report (public moderation complaint) ---------- */

export interface ReportOptions {
  t: Dict;
  entity: "location" | "campaign";
  entityId: string;
}

function ReportBody({ options, close }: { options: ReportOptions; close: () => void }) {
  const t = options.t;
  const [preset, setPreset] = useState<string>("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const presets: { key: string; label: string }[] = [
    { key: t.reportReasonSpam, label: t.reportReasonSpam },
    { key: t.reportReasonOffensive, label: t.reportReasonOffensive },
    { key: t.reportReasonProhibited, label: t.reportReasonProhibited },
    { key: t.reportReasonOutdated, label: t.reportReasonOutdated },
    { key: t.reportReasonOther, label: t.reportReasonOther },
  ];
  const reason = (note.trim() || preset).trim();

  const submit = async () => {
    if (!reason || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      await api("/api/v1/public/reports", {
        method: "POST",
        json: { entity: options.entity, entity_id: options.entityId, reason },
      });
      setState("sent");
    } catch (e) {
      setState("error");
      setError(e instanceof ApiError ? e.message : options.t.error);
    }
  };

  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label={t.reportTitle}>
      {state === "sent" ? (
        <div className="dialog-sent">
          <h3>{t.reportTitle}</h3>
          <p className="ok" role="status">
            {t.reportSent}
          </p>
          <div className="dialog-actions">
            <button ref={closeRef} className="btn primary" onClick={close}>
              {t.close}
            </button>
          </div>
        </div>
      ) : (
        <>
          <h3>
            <IconAlert size={16} /> {t.reportTitle}
          </h3>
          <p className="muted-2 dialog-body">{t.reportHint}</p>
          <div className="report-presets" role="group" aria-label={t.reportTitle}>
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`filter-chip${preset === p.key ? " active" : ""}`}
                aria-pressed={preset === p.key}
                onClick={() => setPreset(preset === p.key ? "" : p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <textarea
            className="report-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.reportHint}
            maxLength={2000}
            autoFocus
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="btn" onClick={close}>
              {t.cancel}
            </button>
            <button
              className="btn primary"
              disabled={!reason || state === "sending"}
              onClick={() => void submit()}
            >
              {state === "sending" ? t.sending : t.send}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Public complaint dialog — posts to /api/v1/public/reports (spec §12). */
export function reportDialog(options: ReportOptions): Promise<void> {
  return mountDialog((close) => <ReportBody options={options} close={close} />);
}

/* ---------- Refund request (advertiser cabinet) ---------- */

export interface RefundDialogProps {
  t: Dict;
  locale: string;
  onSubmit: (reason: string) => Promise<void>;
  close: () => void;
}

/** Reasoned refund request: presets + free text; the moderator reads the
 *  reason verbatim, so it must never be a hardcoded English string. */
export function RefundDialogBody({ t, onSubmit, close }: RefundDialogProps) {
  const [preset, setPreset] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = [t.refundReasonRejected];
  const reason = (note.trim() || preset).trim();

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(reason);
      close();
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError ? e.message : t.error);
    }
  };

  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label={t.refundDialogTitle}>
      <h3>{t.refundDialogTitle}</h3>
      <p className="muted-2 dialog-body">{t.refundDialogReason}</p>
      <div className="report-presets" role="group" aria-label={t.refundDialogTitle}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={`filter-chip${preset === p ? " active" : ""}`}
            aria-pressed={preset === p}
            onClick={() => setPreset(preset === p ? "" : p)}
          >
            {p}
          </button>
        ))}
      </div>
      <textarea
        className="report-note"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t.refundDialogReason}
        maxLength={500}
        autoFocus
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={close} disabled={busy}>
          {t.cancel}
        </button>
        <button
          className="btn primary"
          disabled={!reason || busy}
          onClick={() => void submit()}
        >
          {busy ? t.sending : t.send}
        </button>
      </div>
    </div>
  );
}
