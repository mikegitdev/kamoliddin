import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import { STAFF_PAGE_SIZE } from "@/shared/api/queries";
import { reasonDialog } from "@/shared/dialog";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/toast";
import { IconBlock, IconCheck, IconClose, IconExternal } from "@/shared/icons";

/** Shared building blocks for the staff control-room tabs. */

export function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value.trim()), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Confirm + mandatory reason + POST + refresh every staff query. Returns
 *  true when the action went through. Every staff mutation goes through
 *  here, so each one lands in the audit trail with a typed reason. */
export function useStaffAction() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (opts: {
    path: string;
    body: string;
    confirmLabel: string;
    danger?: boolean;
    payload?: Record<string, unknown>;
  }): Promise<boolean> => {
    const reason = await reasonDialog({
      t,
      body: opts.body,
      confirmLabel: opts.confirmLabel,
      cancelLabel: t.cancel,
      danger: opts.danger,
    });
    if (!reason) return false;
    setBusy(true);
    try {
      await api(`/api/v1/admin/${opts.path}`, {
        method: "POST",
        json: { ...opts.payload, reason },
      });
      toast.success(t.actionDone);
      await qc.invalidateQueries({ queryKey: ["staff"] });
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t.error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/** Offset pager for server-paginated lists. */
export function ServerPager({
  count,
  offset,
  onOffset,
}: {
  count: number;
  offset: number;
  onOffset: (next: number) => void;
}) {
  const { t } = useI18n();
  if (count <= STAFF_PAGE_SIZE) return null;
  const page = Math.floor(offset / STAFF_PAGE_SIZE) + 1;
  const pages = Math.ceil(count / STAFF_PAGE_SIZE);
  return (
    <div className="row staff-pager">
      <button
        className="btn small"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - STAFF_PAGE_SIZE))}
      >
        {t.prevPage}
      </button>
      <span className="muted-2">
        {page} {t.pageOf} {pages}
      </span>
      <button
        className="btn small"
        disabled={page >= pages}
        onClick={() => onOffset(offset + STAFF_PAGE_SIZE)}
      >
        {t.nextPage}
      </button>
    </div>
  );
}

/** Pill switcher between the sub-views of one tab. */
export function SubTabs<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: [K, string][];
  onChange: (k: K) => void;
}) {
  return (
    <div className="row mb-14" role="group">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          className="filter-chip"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Cross-tab drill-down via the URL: /staff?tab=placements&business=<id>. */
export function useStaffLink() {
  const [params, setParams] = useSearchParams();
  const go = (tab: string, extra: Record<string, string> = {}) =>
    setParams({ tab, ...extra });
  const get = (key: string) => params.get(key) ?? "";
  const clear = (...keys: string[]) => {
    const next = new URLSearchParams(params);
    keys.forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };
  return { go, get, clear };
}

/** useState that survives Back/Forward: the value is stored per history entry
 *  (location.key), so returning from an opened ad/location page or a
 *  drill-down restores filters and paging, while a fresh navigation starts
 *  from `initial`. */
export function useHistoryState<T>(name: string, initial: T | (() => T)) {
  const { key, search } = useLocation();
  const storageKey = `staff-state:${key}${search}:${name}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {
      // Unavailable or corrupted storage: start fresh.
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Private-mode Safari can throw; in-tab state still works.
    }
  }, [storageKey, value]);
  return [value, setValue] as const;
}

/** Restorable page offset that resets to 0 when `filters` change — but not on
 *  mount, so an offset restored by Back survives. */
export function usePagedOffset(name: string, filters: unknown) {
  const [offset, setOffset] = useHistoryState(name, 0);
  const sig = JSON.stringify(filters);
  const prev = useRef(sig);
  useEffect(() => {
    if (prev.current === sig) return;
    prev.current = sig;
    setOffset(0);
  }, [sig, setOffset]);
  return [offset, setOffset] as const;
}

/** Result count, pushed to the right end of a `.staff-toolbar`. */
export function ListCount({ count }: { count: number | undefined }) {
  const { t } = useI18n();
  if (count == null) return null;
  return (
    <span className="staff-count">
      {t.countLabel}: <strong>{count}</strong>
    </span>
  );
}

/** "Filtered by …" pill with a reset button, shown for URL drill-downs. */
export function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  const { t } = useI18n();
  return (
    <span className="chip blue staff-filter-pill">
      {t.filteredBy}: {label}
      <button className="link-button" onClick={onClear} aria-label={t.clearFilter}>
        <IconClose size={12} />
      </button>
    </span>
  );
}

/** The single take-down / restore action every staff list shares (block,
 *  disable, suspend). `live` = the entity is currently up, so the button
 *  takes it down and is styled as danger. */
export function StatusToggle({
  live,
  downLabel,
  upLabel,
  busy,
  onClick,
}: {
  live: boolean;
  downLabel: string;
  upLabel: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`btn small${live ? " danger" : ""}`} disabled={busy} onClick={onClick}>
      {live ? <IconBlock size={12} /> : <IconCheck size={12} />} {live ? downLabel : upLabel}
    </button>
  );
}

export type RowLink = {
  label: string;
  onClick?: () => void;
  to?: string;
  /** Status-changing item: listed last, under a divider. */
  status?: "down" | "up";
  disabled?: boolean;
};

/** Take-down / restore as a menu item — the single shape every staff list
 *  uses for block, disable and suspend. `live` = currently up. */
export function statusItem(
  live: boolean,
  downLabel: string,
  upLabel: string,
  busy: boolean,
  run: () => void,
): RowLink {
  return { label: live ? downLabel : upLabel, status: live ? "down" : "up", disabled: busy, onClick: run };
}

/** One "⋯" menu holding every action of a row: drill-downs first, then the
 *  status change under a divider. Fixed-positioned so the table's overflow
 *  container cannot clip it. */
export function RowMenu({ items }: { items: RowLink[] }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number } | null>(
    null,
  );
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);
  if (items.length === 0) return null;
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pos) return setPos(null);
    const r = e.currentTarget.getBoundingClientRect();
    // Open upward near the viewport bottom; anchor to the button's left edge
    // when right-aligning would push the menu off-screen (phone cards).
    const vertical = window.innerHeight - r.bottom < 220
      ? { bottom: window.innerHeight - r.top + 4 }
      : { top: r.bottom + 4 };
    const horizontal = r.right < 240 ? { left: r.left } : { right: window.innerWidth - r.right };
    setPos({ ...vertical, ...horizontal });
  };
  const nav = items.filter((it) => !it.status);
  const status = items.filter((it) => it.status);
  return (
    <div className="row-menu" ref={ref}>
      <button
        type="button"
        className="btn small subtle"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={t.moreActions}
        title={t.moreActions}
        onClick={toggle}
      >
        ⋯
      </button>
      {pos && (
        <div className="row-menu-pop" role="menu" style={pos}>
          {[...nav, ...status].map((it, i) =>
            it.to ? (
              <Link key={it.label} to={it.to} role="menuitem" onClick={() => setPos(null)}>
                <span>{it.label}</span> <IconExternal size={12} />
              </Link>
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={[
                  it.status === "down" ? "danger" : it.status === "up" ? "ok" : "",
                  it.status && i === nav.length && nav.length > 0 ? "divided" : "",
                ].join(" ").trim() || undefined}
                onClick={() => {
                  setPos(null);
                  it.onClick?.();
                }}
              >
                {it.status === "down" && <IconBlock size={13} />}
                {it.status === "up" && <IconCheck size={13} />}
                <span>{it.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_CLASS: Record<string, string> = {
  active: "chip green",
  disabled: "chip red",
  blocked: "chip red",
  deleted: "chip dark",
  under_review: "chip orange",
};

/** Account / business / branch status chip. */
export function StatusChip({ status }: { status: string }) {
  const { t } = useI18n();
  const label: Record<string, string> = {
    active: t.stActive,
    disabled: t.stDisabled,
    blocked: t.stUserBlocked,
    deleted: t.stUserDeleted,
    under_review: t.stUnderReviewShort,
  };
  return <span className={STATUS_CLASS[status] ?? "chip gray"}>{label[status] ?? status}</span>;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
