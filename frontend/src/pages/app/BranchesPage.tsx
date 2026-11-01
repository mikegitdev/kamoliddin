import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessLocations, useBusinesses } from "@/shared/api/queries";
import { useCurrentBusiness } from "@/features/advertiser/currentBusiness";
import { ApiError } from "@/shared/api/client";
import { createLocation, deleteLocation, updateLocation } from "@/features/advertiser/api";
import { MapLibreAdapter, mapAdapterOptions, type MapAdapter } from "@/map-adapters";
import { useI18n, plural } from "@/shared/i18n";
import { toast } from "@/shared/toast";
import { confirmDialog } from "@/shared/dialog";
import { WEEK_DAYS, weekdayLabel, type WeekDay } from "@/shared/format";
import { useDirtyRouteGuard } from "@/shared/route-guard";
import {
  IconAlert,
  IconCheck,
  IconExternal,
  IconPhone,
  IconPencil,
  IconPin,
  IconTrash,
} from "@/shared/icons";
import { ContactActions, directionsUrl } from "@/shared/ui";
import type { ApiBusiness, ApiOwnerLocation } from "@/entities/types";

/* ---------- Map picker: click to place, drag to fine-tune (spec §13) ---------- */

function MapPicker({
  point,
  onPick,
  label,
}: {
  point: { lng: number; lat: number } | null;
  onPick: (lng: number, lat: number) => void;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  // Latest callback without re-initializing the map on every pick.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // True only when the component mounts with a pre-filled point (edit mode);
  // consumed by the point effect to fly in exactly once.
  const prefillRef = useRef(point !== null);

  useEffect(() => {
    if (!containerRef.current) return;
    const adapter = new MapLibreAdapter();
    adapter.initialize(containerRef.current, mapAdapterOptions());
    // Street-picking needs closer zoom than the shared city default; 260px of
    // map at z11.5 makes precise placement impractical without zooming first.
    adapter.setCenterZoom([69.2401, 41.2995], 13);
    // Double-click is the native map zoom gesture. Without this guard its
    // first click also drops/moves the pin, so every zoom attempt leaves a
    // stray pin behind. Debounce: a second click within 300ms cancels the pick.
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    adapter.onMapClick((lng, lat) => {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        onPickRef.current(lng, lat);
      }, 300);
    });
    adapterRef.current = adapter;
    return () => {
      if (clickTimer) clearTimeout(clickTimer);
      adapter.destroy();
      adapterRef.current = null;
    };
  }, []);

  // Keep the draggable pin in sync with form state (drag, click, and edit prefill).
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (!point) {
      adapter.setPickMarker(null);
      return;
    }
    adapter.setPickMarker(point, (lng, lat) => onPickRef.current(lng, lat));
    // Fly in ONCE on mount-prefill (edit mode) so an existing position can be
    // confirmed. Never on user clicks or marker drags: jumping the camera after
    // a click moves the map out from under the spot the user just aimed at —
    // the pin must land exactly where they clicked, camera stays put.
    if (prefillRef.current) {
      prefillRef.current = false;
      const cam = adapter.getCenterZoom();
      if (cam && cam.zoom < 13.5) adapter.flyTo([point.lng, point.lat], 14.5);
    }
  }, [point]);

  return <div className="map-picker" ref={containerRef} role="img" aria-label={label} />;
}

/* ---------- Public listing preview: what visitors will see ---------- */

function PublicPreview({
  business,
  form,
}: {
  business: ApiBusiness | undefined;
  form: BranchForm;
}) {
  const { t } = useI18n();
  const previewDirectionsUrl = form.point
    ? directionsUrl(form.point.lng, form.point.lat)
    : undefined;

  return (
    <div className="public-preview">
      <div className="row-between">
        <h3>{t.publicPreviewTitle}</h3>
        {form.id && (
          <Link className="btn small" to={`/locations/${form.id}`}>
            <IconExternal size={12} /> {t.openPublicPage}
          </Link>
        )}
      </div>
      <div className="detail-head">
        <div className="min-w-0">
          <h1>{business?.name ?? "…"}</h1>
          <p className="muted">{form.name.trim() || "…"}</p>
        </div>
      </div>
      <ContactActions
        directionsUrl={previewDirectionsUrl}
        phone={form.phone || null}
        telegram={form.telegram || null}
        whatsapp={form.whatsapp || null}
        site={business?.site || null}
      />
      <div className="info-grid">
        <div className="info-card">
          <div className="label">{t.address}</div>
          <div className="value">{form.address.trim() || "…"}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

interface BranchForm {
  id: string | null; // set = edit an existing branch
  name: string;
  address: string;
  phone: string;
  telegram: string;
  whatsapp: string;
  /** mon..sun -> [open, close]; undefined = closed that day. */
  hours: Partial<Record<WeekDay, [string, string]>>;
  point: { lng: number; lat: number } | null;
}

const EMPTY_FORM: BranchForm = {
  id: null, name: "", address: "", phone: "", telegram: "", whatsapp: "",
  hours: {}, point: null,
};

function normalizeHours(raw: unknown): Partial<Record<WeekDay, [string, string]>> {
  const out: Partial<Record<WeekDay, [string, string]>> = {};
  if (raw && typeof raw === "object") {
    for (const [day, range] of Object.entries(raw as Record<string, unknown>)) {
      if (WEEK_DAYS.includes(day as WeekDay) && Array.isArray(range)) {
        const [from, to] = range as string[];
        if (from && to) out[day as WeekDay] = [from, to];
      }
    }
  }
  return out;
}

function statusLabel(status: string, t: ReturnType<typeof useI18n>["t"]): string | null {
  if (status === "under_review") return t.stUnderReview;
  if (status === "disabled") return t.stDisabled;
  return null;
}

export function BranchesPage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const businessesQuery = useBusinesses();
  const business = useCurrentBusiness(businessesQuery.data);
  const locationsQuery = useBusinessLocations(business?.id);
  const locations = locationsQuery.data;

  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement>(null);
  // Snapshot of the form when it was loaded — the route-leave guard and the
  // cancel affordance both key off real dirtiness, not "any content".
  const [baseline, setBaseline] = useState<string>(JSON.stringify(EMPTY_FORM));
  const dirty = JSON.stringify(form) !== baseline;
  useDirtyRouteGuard(dirty);

  const applyError = (e: unknown) => {
    if (e instanceof ApiError) {
      setError(e.message);
      setFieldErrors(e.fieldMessages());
    } else {
      setError(t.error);
    }
  };

  const save = useMutation({
    mutationFn: (): Promise<ApiOwnerLocation> => {
      // Empty strings clear fields on PATCH; omitting them would keep stale
      // values (open-questions.md #13). `hours: {}` clears the schedule.
      const base = {
        name: form.name,
        address: form.address,
        phone: form.phone,
        telegram: form.telegram,
        whatsapp: form.whatsapp,
        hours: form.hours,
      };
      return form.id
        ? updateLocation(form.id, { ...base, lon: form.point!.lng, lat: form.point!.lat })
        : createLocation(business!.id, { ...base, lon: form.point!.lng, lat: form.point!.lat });
    },
    onSuccess: () => {
      setStatus(t.branchSaved);
      setError(null);
      setFieldErrors({});
      setForm(EMPTY_FORM);
      setBaseline(JSON.stringify(EMPTY_FORM));
      queryClient.invalidateQueries({ queryKey: ["business-locations", business?.id] });
      queryClient.invalidateQueries({ queryKey: ["location-pins"] }); // public map
    },
    onError: applyError,
  });

  const removeBranch = useMutation({
    mutationFn: (id: string) => deleteLocation(id),
    onSuccess: () => {
      toast.success(t.branchDeleted);
      void queryClient.invalidateQueries({ queryKey: ["business-locations", business?.id] });
      void queryClient.invalidateQueries({ queryKey: ["location-pins"] }); // public map
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t.error),
  });

  const confirmDeleteBranch = (id: string) => {
    void confirmDialog({
      t,
      title: t.deleteBranchTitle,
      body: t.deleteBranchBody,
      confirmLabel: t.deleteBranchConfirm,
      cancelLabel: t.cancel,
      danger: true,
    }).then((ok) => {
      if (ok) removeBranch.mutate(id);
    });
  };

  const set =
    (key: "name" | "address" | "phone" | "telegram" | "whatsapp") =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const setHour = (day: WeekDay, field: 0 | 1, value: string) =>
    setForm((f) => {
      const current = f.hours[day] ?? ["", ""];
      const next: [string, string] = [current[0], current[1]];
      next[field] = value;
      const hours = { ...f.hours };
      if (next[0] && next[1]) hours[day] = next;
      else delete hours[day];
      return { ...f, hours };
    });

  const startEdit = (loc: ApiOwnerLocation) => {
    const next: BranchForm = {
      id: loc.id,
      name: loc.name,
      address: loc.address,
      phone: loc.phone ?? "",
      telegram: loc.telegram ?? "",
      whatsapp: loc.whatsapp ?? "",
      hours: normalizeHours(loc.hours),
      point: { lng: loc.lon, lat: loc.lat },
    };
    setForm(next);
    setBaseline(JSON.stringify(next));
    setStatus(null);
    setError(null);
    setFieldErrors({});
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /** Copy the first defined day's range to the whole week — 14 empty time
      inputs is the most tedious part of branch setup. */
  const copyHoursToAll = () => {
    const first = WEEK_DAYS.map((d) => form.hours[d]).find((r): r is [string, string] => !!r);
    if (!first) return;
    const hours: Partial<Record<WeekDay, [string, string]>> = {};
    for (const d of WEEK_DAYS) hours[d] = first;
    setForm((f) => ({ ...f, hours }));
  };

  // Loading / error / no-business states — an existing advertiser must never be
  // told to "create a business" while their data is still loading.
  if (businessesQuery.isLoading) {
    return (
      <section>
        <h2>{t.branches}</h2>
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card mt-10" />
        <div className="skeleton skeleton-card mt-10 h160" />
      </section>
    );
  }
  if (businessesQuery.isError) {
    return (
      <section>
        <h2>{t.branches}</h2>
        <p className="callout danger" role="alert">
          <IconAlert size={14} /> {t.loadError}
        </p>
        <button
          className="btn mt-12"
          onClick={() => businessesQuery.refetch()}
        >
          {t.retry}
        </button>
      </section>
    );
  }
  if (!business) {
    return (
      <section>
        <h2>{t.branches}</h2>
        <div className="setup-next">
          <div>
            <strong>{t.setupStep1}</strong>
            <div className="muted-2">{t.createBusinessHint}</div>
          </div>
          <Link className="btn primary" to="/app/business">
            {t.createBusiness}
          </Link>
        </div>
      </section>
    );
  }

  const canSave =
    !save.isPending && form.name.trim().length > 0 && form.address.trim().length > 0 && !!form.point;

  return (
    <section>
      <div className="row-between">
        <h2>{t.branches}</h2>
        {locations && locations.length > 0 && (
          <span className="chip gray">
            {locations.length} {plural(locale, "locations", locations.length)}
          </span>
        )}
      </div>

      {locationsQuery.isLoading && (
        <>
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card mt-10" />
        </>
      )}
      {locationsQuery.isError && (
        <>
          <p className="callout danger" role="alert">
            <IconAlert size={14} /> {t.loadError}
          </p>
          <button
            className="btn mt-12"
            onClick={() => locationsQuery.refetch()}
          >
            {t.retry}
          </button>
        </>
      )}
      {locations && locations.length === 0 && <p className="callout"><IconPin size={14} /> {t.noBranches}</p>}

      <ul className="list">
        {locations?.map((loc) => {
          const chip = statusLabel(loc.status, t);
          return (
            <li key={loc.id} className="row-between">
              <div className="min-w-0 stack-text">
                <strong>{loc.name}</strong>
                <span className="muted">{loc.address}</span>
                {loc.phone && <span className="muted-2"><IconPhone size={12} /> {loc.phone}</span>}
              </div>
              <div className="branch-row-actions">
                {chip && (
                  <span className="chip gray" title={t.branchStatusHint}>
                    {chip}
                  </span>
                )}
                <Link
                  className="btn small"
                  to={`/locations/${loc.id}`}
                  aria-label={t.openPublicPage}
                  title={t.openPublicPage}
                >
                  <IconExternal size={12} aria-label={t.openPublicPage} />
                </Link>
                <button className="btn small" onClick={() => startEdit(loc)}>
                  <IconPencil size={12} /> {t.editBranch}
                </button>
                <button
                  className="btn small danger"
                  aria-label={t.deleteBranch}
                  title={t.deleteBranch}
                  disabled={removeBranch.isPending && removeBranch.variables === loc.id}
                  onClick={() => confirmDeleteBranch(loc.id)}
                >
                  <IconTrash size={12} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="form card-form" ref={formRef}>
        <h3>{form.id ? t.editBranchTitle : t.addBranch}</h3>
        <div className="field">
          <label htmlFor="br-name">{t.branchName}</label>
          <input id="br-name" value={form.name} onChange={set("name")} />
          {fieldErrors.name && (
            <span className="field-error" role="alert">
              {fieldErrors.name}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="br-address">{t.streetAddress}</label>
          <input id="br-address" value={form.address} onChange={set("address")} />
          {fieldErrors.address && (
            <span className="field-error" role="alert">
              {fieldErrors.address}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="br-phone">{t.phone}</label>
          <input
            id="br-phone"
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            placeholder="+998 …"
          />
        </div>
        <div className="two-cols">
          <div className="field">
            <label htmlFor="br-telegram">{t.branchTelegram}</label>
            <input
              id="br-telegram"
              value={form.telegram}
              onChange={set("telegram")}
              placeholder="@username"
            />
          </div>
          <div className="field">
            <label htmlFor="br-whatsapp">{t.branchWhatsapp}</label>
            <input
              id="br-whatsapp"
              type="tel"
              value={form.whatsapp}
              onChange={set("whatsapp")}
              placeholder="+998 90 123 45 67"
            />
          </div>
        </div>
        <span className="field-hint">{t.contactsLevelHint}</span>

        <div className="field">
          <label htmlFor="br-hours">{t.hours}</label>
          <span className="field-hint" id="br-hours-hint">
            {t.hoursOptionalHint}
          </span>
          <div className="row-between hours-toolbar">
            <span />
            <button
              type="button"
              className="btn subtle small"
              disabled={!WEEK_DAYS.some((d) => form.hours[d])}
              onClick={copyHoursToAll}
            >
              <IconCheck size={12} /> {t.hoursCopyToAll}
            </button>
          </div>
          <div className="hours-editor" id="br-hours" aria-describedby="br-hours-hint">
            {WEEK_DAYS.map((day) => {
              const range = form.hours[day];
              return (
                <div key={day} className="hours-editor-row">
                  <span className="he-day">{weekdayLabel(day, locale)}</span>
                  <input
                    type="time"
                    aria-label={`${weekdayLabel(day, locale)} — ${t.hours}`}
                    value={range?.[0] ?? ""}
                    onChange={(e) => setHour(day, 0, e.target.value)}
                  />
                  <span className="muted-2">—</span>
                  <input
                    type="time"
                    aria-label={`${weekdayLabel(day, locale)}`}
                    value={range?.[1] ?? ""}
                    onChange={(e) => setHour(day, 1, e.target.value)}
                  />
                  {!range && <span className="muted-2 he-closed">{t.closedDay}</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label htmlFor="br-map">{t.pickOnMap}</label>
          <span className="field-hint" id="br-map-hint">
            {t.pinHint} {t.locationPrecisionHint}
          </span>
          <div id="br-map">
            <MapPicker
              point={form.point}
              label={t.pickOnMap}
              onPick={(lng, lat) => setForm((f) => ({ ...f, point: { lng, lat } }))}
            />
          </div>
          {form.point && (
            <p className="pin-confirm">
              <IconCheck size={12} /> {t.pinConfirmed}
              {form.address.trim() && <span>· <IconPin size={12} /> {form.address.trim()}</span>}
              <span className="coords">
                {form.point.lng.toFixed(5)}, {form.point.lat.toFixed(5)}
              </span>
            </p>
          )}
          {fieldErrors.lat && (
            <span className="field-error" role="alert">
              {fieldErrors.lat}
            </span>
          )}
        </div>

        <div className="form-actions">
          <button className="btn primary" disabled={!canSave} onClick={() => save.mutate()}>
            {save.isPending ? t.saving : t.save}
          </button>
          {(form.id || dirty) && (
            <button
              className="btn"
              onClick={() => {
                setForm(EMPTY_FORM);
                setBaseline(JSON.stringify(EMPTY_FORM));
                setError(null);
                setFieldErrors({});
              }}
            >
              {t.cancel}
            </button>
          )}
          {status && !error && (
            <span className="ok" role="status">
              <IconCheck size={12} /> {status}
            </span>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Live public preview — only once there is something to preview. */}
      {(form.name.trim() || form.address.trim() || form.point) && (
        <PublicPreview business={business} form={form} />
      )}
    </section>
  );
}
