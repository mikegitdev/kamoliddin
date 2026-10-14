import { useState } from "react";
import { useI18n } from "@/shared/i18n";

/** Client-side "show more" paging for staff tables/lists — the admin API has
 *  no server pagination yet; this keeps long lists usable (same pattern as
 *  the advertiser campaigns page). Server-side paging is the scale-up path. */
export function useShowMore<T>(items: T[] | undefined, pageSize = 25) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const visible = (items ?? []).slice(0, visibleCount);
  const hidden = (items?.length ?? 0) - visible.length;
  return {
    visible,
    hidden,
    showMore: () => setVisibleCount((n) => n + pageSize),
    reset: () => setVisibleCount(pageSize),
  };
}

/** The "show more" affordance; renders nothing when everything is visible. */
export function MoreRow({ hidden, onMore }: { hidden: number; onMore: () => void }) {
  const { t } = useI18n();
  if (hidden <= 0) return null;
  return (
    <p className="cc-more-row">
      <button className="btn subtle small" onClick={onMore}>
        {t.showMore} ({hidden})
      </button>
    </p>
  );
}
