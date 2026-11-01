import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinesses, useCategories } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { deleteBusiness, saveBusiness, saveLogo, uploadMedia } from "@/features/advertiser/api";
import { selectBusiness, useCurrentBusiness } from "@/features/advertiser/currentBusiness";
import { useI18n } from "@/shared/i18n";
import { useDirtyRouteGuard } from "@/shared/route-guard";
import { toast } from "@/shared/toast";
import { confirmDialog } from "@/shared/dialog";
import { IconAlert, IconPlus, IconTrash } from "@/shared/icons";
import { FallImg, QueryError } from "@/shared/ui";

export function BusinessProfilePage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const {
    data: businesses,
    isError: businessesFailed,
    refetch: refetchBusinesses,
  } = useBusinesses();
  const { data: categories } = useCategories();
  const existing = useCurrentBusiness(businesses);

  const [form, setForm] = useState({
    name: "",
    category: "",
    description: "",
    phone: "",
    telegram: "",
    whatsapp: "",
    site: "",
  });

  // Prefilled server values, for the unsaved-changes indicator.
  const baseline = useMemo(
    () =>
      existing
        ? `${existing.name}|${existing.category}|${existing.description ?? ""}|${existing.phone ?? ""}|${existing.telegram ?? ""}|${existing.whatsapp ?? ""}|${existing.site ?? ""}`
        : null,
    [existing],
  );
  const dirty =
    baseline !== null &&
    baseline !== `${form.name}|${form.category}|${form.description}|${form.phone}|${form.telegram}|${form.whatsapp}|${form.site}`;
  // In-app navigation (nav tabs) drops edits just like a refresh — guard both.
  useDirtyRouteGuard(dirty);

  // Warn before leaving the page with unsaved edits (matches the editor).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name,
        category: existing.category,
        description: existing.description ?? "",
        phone: existing.phone ?? "",
        telegram: existing.telegram ?? "",
        whatsapp: existing.whatsapp ?? "",
        site: existing.site ?? "",
      });
    }
  }, [existing]);

  const mutation = useMutation({
    mutationFn: () =>
      saveBusiness(
        {
          name: form.name,
          category: form.category,
          description: form.description,
          phone: form.phone,
          telegram: form.telegram,
          whatsapp: form.whatsapp,
          site: form.site,
        },
        existing?.id,
      ),
    onSuccess: () => {
      toast.success(t.saved);
      queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.error),
  });

  const removeBusiness = useMutation({
    mutationFn: () => deleteBusiness(existing!.id),
    onSuccess: () => {
      toast.success(t.businessDeleted);
      // Drop the stale selection; the header falls back to the next remaining
      // business, or the cabinet flips to its create-business state.
      selectBusiness("");
      queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.error),
  });

  // Logo key as last saved from this page. Kept local on purpose: refetching the
  // business would reset the unsaved profile form below.
  const [logoKey, setLogoKey] = useState<string | null>(null);
  const shownLogoKey = logoKey ?? existing?.logo_key ?? "";
  const logoMutation = useMutation({
    mutationFn: async (file: File | null) => {
      const key = file ? (await uploadMedia(file, "logos")).key : "";
      await saveLogo(existing!.id, key);
      return key;
    },
    onSuccess: (key) => {
      setLogoKey(key);
      toast.success(key ? t.logoSaved : t.saved);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.error),
  });

  const confirmDeleteBusiness = () => {
    void confirmDialog({
      t,
      title: t.deleteBusinessTitle,
      body: t.deleteBusinessBody,
      confirmLabel: t.deleteBusinessConfirm,
      cancelLabel: t.cancel,
      danger: true,
    }).then((ok) => {
      if (ok) removeBusiness.mutate();
    });
  };

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  // Without the existing profile an empty form would save a duplicate business.
  if (businessesFailed && !businesses) {
    return (
      <section className="form">
        <h2>{t.business}</h2>
        <QueryError onRetry={() => refetchBusinesses()} />
      </section>
    );
  }

  return (
    <section className="form">
      <div className="row-between">
        <h2>{t.business}</h2>
        {dirty && (
          <span className="chip orange" role="status">
            <IconAlert size={14} /> {t.unsavedChangesNote}
          </span>
        )}
      </div>

      <div className="form-section flush">
        <h3 className="section-title">
          <span className="section-num" aria-hidden="true">1</span>
          {t.secProfile}
        </h3>
        <span className="field-hint">{t.profileSectionHint}</span>
        <div className="field">
          <label htmlFor="biz-name">{t.businessName}</label>
          <input id="biz-name" value={form.name} onChange={set("name")} placeholder="Osh Markazi" />
        </div>
        <div className="field">
          <label htmlFor="biz-category">{t.categoryLabel}</label>
          <select id="biz-category" value={form.category} onChange={set("category")}>
            <option value="">{t.categoryPlaceholder}</option>
            {categories?.map((c) => (
              <option key={c.slug} value={c.slug}>
                {locale === "uz" ? c.name_uz : c.name_ru}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-section">
        <h3 className="section-title">
          <span className="section-num" aria-hidden="true">2</span>
          {t.secAbout}
        </h3>
        <span className="field-hint">{t.aboutSectionHint}</span>
        <div className="field">
          <label htmlFor="biz-desc">{t.businessDescriptionLabel}</label>
          <textarea id="biz-desc" value={form.description} onChange={set("description")} rows={3} />
        </div>
      </div>

      <div className="form-section">
        <h3 className="section-title">
          <span className="section-num" aria-hidden="true">3</span>
          {t.secContacts}
        </h3>
        <div className="field">
          <label htmlFor="biz-phone">{t.phone}</label>
          <input
            id="biz-phone"
            type="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={set("phone")}
            placeholder="+998 90 123 45 67"
          />
        </div>
        <div className="field">
          <label htmlFor="biz-telegram">Telegram</label>
          <input id="biz-telegram" value={form.telegram} onChange={set("telegram")} placeholder="@username" />
        </div>
        <div className="field">
          <label htmlFor="biz-whatsapp">WhatsApp</label>
          <input
            id="biz-whatsapp"
            type="tel"
            value={form.whatsapp}
            onChange={set("whatsapp")}
            placeholder="+998 90 123 45 67"
          />
        </div>
        <div className="field">
          <label htmlFor="biz-site">{t.website}</label>
          <input
            id="biz-site"
            type="url"
            autoComplete="url"
            value={form.site}
            onChange={set("site")}
            placeholder="https://…"
          />
        </div>
      </div>

      <div className="form-section">
        <h3 className="section-title">
          <span className="section-num" aria-hidden="true">4</span>
          {t.logoTitle}
        </h3>
        <span className="field-hint">{existing ? t.logoHint : t.logoNeedsBusiness}</span>
        {existing && (
          <div className="row mt-8">
            <FallImg
              className="logo-preview"
              src={shownLogoKey ? `/media/${shownLogoKey}` : undefined}
              alt={t.logoTitle}
            />
            <div className="stack">
              <input
                id="biz-logo"
                className="file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={logoMutation.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) logoMutation.mutate(file);
                }}
              />
              <label htmlFor="biz-logo" className="btn small">
                <IconPlus size={14} /> {t.logoUpload}
              </label>
              {shownLogoKey && (
                <button
                  className="btn small"
                  disabled={logoMutation.isPending}
                  onClick={() => logoMutation.mutate(null)}
                >
                  {t.logoRemove}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="form-actions">
        <button
          className="btn primary"
          disabled={mutation.isPending || !form.name || !form.category}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? t.saving : t.save}
        </button>
        {(!form.name || !form.category) && !mutation.isPending && (
          <span className="field-hint" role="status">
            {t.saveRequiresHint}
          </span>
        )}
      </div>

      {/* Danger zone — empty businesses only (backend-enforced); anything
          used carries records the platform must retain (spec §7.1/§14). */}
      {existing && (
        <div className="form-section flush mt-14">
          <h3 className="section-title">{t.deleteBusiness}</h3>
          <span className="field-hint">{t.deleteBusinessBody}</span>
          <button
            className="btn danger"
            disabled={removeBusiness.isPending}
            onClick={confirmDeleteBusiness}
          >
            <IconTrash size={12} /> {t.deleteBusinessConfirm}
          </button>
        </div>
      )}
    </section>
  );
}
