import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinesses, useCategories } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { saveBusiness } from "@/features/advertiser/api";
import { useI18n } from "@/shared/i18n";
import { IconCheck } from "@/shared/icons";

export function BusinessProfilePage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { data: businesses } = useBusinesses();
  const { data: categories } = useCategories();
  const existing = businesses?.[0];

  const [form, setForm] = useState({
    name: "",
    category: "",
    description: "",
    phone: "",
    telegram: "",
    whatsapp: "",
    site: "",
  });
  const [error, setError] = useState<string | null>(null);

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
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t.error),
  });

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <section className="form">
      <h2>{t.business}</h2>

      <div className="form-section" style={{ borderTop: "none", marginTop: 8, paddingTop: 0 }}>
        <h3 className="section-title">
          <span className="section-num">1</span>
          {t.secProfile}
        </h3>
        <div className="field">
          <label htmlFor="biz-name">{t.businessName}</label>
          <input id="biz-name" value={form.name} onChange={set("name")} placeholder="Osh Markazi" />
        </div>
        <div className="field">
          <label htmlFor="biz-category">{t.allCategories}</label>
          <select id="biz-category" value={form.category} onChange={set("category")}>
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
          <span className="section-num">2</span>
          {t.secAbout}
        </h3>
        <div className="field">
          <label htmlFor="biz-desc">{t.adText}</label>
          <textarea id="biz-desc" value={form.description} onChange={set("description")} rows={3} />
        </div>
      </div>

      <div className="form-section">
        <h3 className="section-title">
          <span className="section-num">3</span>
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

      <div className="form-actions">
        <button
          className="btn primary"
          disabled={mutation.isPending || !form.name || !form.category}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? t.saving : t.save}
        </button>
        {mutation.isSuccess && !error && <span className="ok"><IconCheck size={12} /> {t.saved}</span>}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
