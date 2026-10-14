/**
 * Recent search queries (design review: search has no suggestions/recents —
 * users type blind). Purely client-side: the last queries that produced a
 * selection or an explicit submit, capped, per device.
 */
import { useEffect, useRef, useState } from "react";
import { IconClock, IconClose } from "@/shared/icons";

const STORAGE_KEY = "recent-searches";
const MAX_RECENT = 6;

export function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string) {
  const q = query.trim();
  if (q.length < 2) return;
  const next = [q, ...loadRecentSearches().filter((r) => r !== q)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are a bonus, not a contract */
  }
}

export function clearRecentSearches() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Dropdown under the map search input: recent queries when the field is
 *  focused and empty. Keyboard reachable (buttons), closes on blur-elsewhere
 *  and Escape. */
export function RecentSearches({
  open,
  recentLabel,
  closeLabel,
  onPick,
  onClose,
}: {
  open: boolean;
  recentLabel: string;
  closeLabel: string;
  onPick: (query: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setItems(loadRecentSearches());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || items.length === 0) return null;

  return (
    <div className="recent-searches" ref={boxRef} role="group" aria-label={recentLabel}>
      <div className="rs-head">
        <span className="muted-2">{recentLabel}</span>
        <button
          type="button"
          className="sheet-close small"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={() => {
            clearRecentSearches();
            setItems([]);
            onClose();
          }}
        >
          <IconClose />
        </button>
      </div>
      {items.map((q) => (
        <button
          key={q}
          type="button"
          // Keep focus in the search input so the dropdown never closes
          // between mousedown and click. Plain buttons (no listbox/option
          // roles): focus deliberately stays in the input, so options are
          // not arrow-navigable — group semantics match actual behavior.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onPick(q)}
        >
          <IconClock size={14} /> <span>{q}</span>
        </button>
      ))}
    </div>
  );
}
