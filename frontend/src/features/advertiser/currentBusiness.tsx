import { useSyncExternalStore } from "react";
import { useBusinesses } from "@/shared/api/queries";
import { useI18n } from "@/shared/i18n";

/* The cabinet's working business. Launch UX is one business per owner
 * (spec §4), but the data model allows several: the header switcher then
 * picks which one the profile, branches and new-campaign pages work on.
 * Remembered per browser; an id this account doesn't own (another login, a
 * removed business) falls back to the newest business. */

const STORAGE_KEY = "cabinet.business";
const listeners = new Set<() => void>();
let selectedId: string | null = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked: in-tab selection still works
  }
})();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function selectBusiness(id: string) {
  selectedId = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode / blocked storage: the selection lasts for this tab.
  }
  listeners.forEach((l) => l());
}

/** The explicitly chosen business id (null = default). The cabinet layout
 *  keys its page outlet on it, so a switch remounts the page cleanly. */
export function useSelectedBusinessId(): string | null {
  return useSyncExternalStore(subscribe, () => selectedId);
}

/** The chosen business among the owner's, else the newest one. */
export function useCurrentBusiness<T extends { id: string }>(businesses: T[] | undefined): T | undefined {
  const id = useSelectedBusinessId();
  return businesses?.find((b) => b.id === id) ?? businesses?.[0];
}

/** Header switcher — rendered only for owners with more than one business. */
export function BusinessSwitcher() {
  const { t } = useI18n();
  const { data: businesses } = useBusinesses();
  const current = useCurrentBusiness(businesses);
  if (!businesses || businesses.length < 2 || !current) return null;
  return (
    <select
      className="business-switch"
      aria-label={t.business}
      value={current.id}
      onChange={(e) => selectBusiness(e.target.value)}
    >
      {businesses.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
