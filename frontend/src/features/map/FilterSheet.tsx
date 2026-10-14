/**
 * Map filters in one place: every category visible at once (the toolbar chip
 * row scrolls sideways and hides most of them). Changes apply live, so the
 * "Show (N)" button reflects the real result count. Native <dialog>: focus
 * trap, Esc and backdrop come for free; bottom sheet on phones via CSS.
 */
import { useEffect, useRef } from "react";
import { useI18n } from "@/shared/i18n";
import { IconClose } from "@/shared/icons";
import type { ApiCategory } from "@/entities/types";

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  categories: ApiCategory[];
  category: string;
  onCategoryChange: (slug: string) => void;
  /** undefined while results are loading. */
  resultCount: number | undefined;
}

export function FilterSheet({
  open,
  onClose,
  categories,
  category,
  onCategoryChange,
  resultCount,
}: FilterSheetProps) {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const options = [
    { slug: "", label: t.allCategories },
    ...categories.map((c) => ({ slug: c.slug, label: locale === "uz" ? c.name_uz : c.name_ru })),
  ];

  return (
    <dialog
      ref={ref}
      className="filter-sheet"
      aria-labelledby="filter-sheet-title"
      onClose={onClose}
      // Backdrop click: the inner wrapper fills the dialog, so only clicks
      // outside it target the <dialog> element itself.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      // Esc closes the dialog only — don't let it also collapse the results
      // panel (ResultsPanel listens for Esc on window).
      onKeyDown={(e) => {
        if (e.key === "Escape") e.stopPropagation();
      }}
    >
      <div className="filter-sheet-inner">
        <div className="filter-sheet-head">
          <h2 id="filter-sheet-title">{t.filters}</h2>
          <button type="button" className="sheet-close small" onClick={onClose} aria-label={t.close}>
            <IconClose />
          </button>
        </div>

        <fieldset className="filter-group">
          <legend>{t.categoryLabel}</legend>
          <div className="filter-options">
            {options.map((o) => (
              <label key={o.slug} className={`cat-chip${category === o.slug ? " active" : ""}`}>
                <input
                  type="radio"
                  name="filter-category"
                  value={o.slug}
                  checked={category === o.slug}
                  onChange={() => onCategoryChange(o.slug)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="filter-sheet-foot">
          <button
            type="button"
            className="btn"
            onClick={() => onCategoryChange("")}
            disabled={category === ""}
          >
            {t.clearFilters}
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            {resultCount === undefined ? t.showResults : `${t.showResults} (${resultCount})`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
