import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessLocations, useBusinesses } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { createLocation, updateLocation } from "@/features/advertiser/api";
import { MapLibreAdapter, type MapAdapter } from "@/map-adapters";
import { useI18n, plural } from "@/shared/i18n";
import {
  IconAlert,
  IconCheck,
  IconExternal,
  IconPhone,
  IconPencil,
  IconPin,
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

  useEffect(() => {
    if (!containerRef.current) return;
    const adapter = new MapLibreAdapter();
    adapter.initialize(containerRef.current, {
      tilesUrl: import.meta.env.VITE_MAP_TILES_URL || undefined,
    });
    adapter.onMapClick((lng, lat) => onPickRef.current(lng, lat));
    adapterRef.current = adapter;
    return () => {
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
    // First placement (or edit prefill): zoom in so the position can be confirmed.
    const cam = adapter.getCenterZoom();
    if (cam && cam.zoom < 13.5) adapter.flyTo([point.lng, point.lat], 14.5);
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
          <Link className="btn small" to={`/locations/${form.id}`} target="_blank" rel="noreferrer">
            <IconExternal size={12} /> {t.openPublicPage}
          </Link>
        )}
      </div>
      <div className="detail-head">
        <div style={{ minWidth: 0 }}>
          <h1>{business?.name ?? "…"}</h1>
          <p className="muted">{form.name.trim() || "…"}</p>
        </div>
      </div>
      <ContactActions
        directionsUrl={previewDirectionsUrl}
        phone={form.phone || null}
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
  point: { lng: number; lat: number } | null;
}

const EMPTY_FORM: BranchForm = { id: null, name: "", address: "", phone: "", point: null };

function statusLabel(status: string, t: ReturnType<typeof useI18n>["t"]): string | null {
  if (status === "under_review") return t.stUnderReview;
  if (status === "disabled") return t.stDisabled;
  return null;
}

export function BranchesPage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const businessesQuery = useBusinesses();
  const business = businessesQuery.data?.[0];
  const locationsQuery = useBusinessLocations(business?.id);
  const locations = locationsQuery.data;

  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement>(null);

  const applyError = (e: unknown) => {
    if (e instanceof ApiError) {
      setError(e.message);
      const flat: Record<string, string> = {};
      for (const [key, messages] of Object.entries(e.fields ?? {})) {
        flat[key] = messages.join(" ");
      }
      setFieldErrors(flat);
    } else {
      setError(t.error);
    }
  };

  const save = useMutation({
    mutationFn: (): Promise<ApiOwnerLocation> => {
      const base = {
        name: form.name,
        address: form.address,
        phone: form.phone || undefined,
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
      queryClient.invalidateQueries({ queryKey: ["business-locations", business?.id] });
      queryClient.invalidateQueries({ queryKey: ["location-pins"] }); // public map
    },
    onError: applyError,
  });

  const set =
    (key: "name" | "address" | "phone") => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const startEdit = (loc: ApiOwnerLocation) => {
    setForm({
      id: loc.id,
      name: loc.name,
      address: loc.address,
      phone: loc.phone ?? "",
      point: { lng: loc.lon, lat: loc.lat },
    });
    setStatus(null);
    setError(null);
    setFieldErrors({});
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Loading / error / no-business states — an existing advertiser must never be
  // told to "create a business" while their data is still loading.
  if (businessesQuery.isLoading) {
    return (
      <section>
        <h2>{t.branches}</h2>
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" style={{ marginTop: 10 }} />
        <div className="skeleton skeleton-card" style={{ marginTop: 10, height: 160 }} />
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
          className="btn"
          style={{ marginTop: 12 }}
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
          <div className="skeleton skeleton-card" style={{ marginTop: 10 }} />
        </>
      )}
      {locationsQuery.isError && (
        <>
          <p className="callout danger" role="alert">
            <IconAlert size={14} /> {t.loadError}
          </p>
          <button
            className="btn"
            style={{ marginTop: 12 }}
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
              <div style={{ minWidth: 0 }}>
                <strong>{loc.name}</strong>
                <span className="muted">{loc.address}</span>
                {loc.phone && <span className="muted-2"><IconPhone size={12} /> {loc.phone}</span>}
              </div>
              <div className="branch-row-actions">
                {chip && <span className="chip gray">{chip}</span>}
                <Link
                  className="btn small"
                  to={`/locations/${loc.id}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t.openPublicPage}
                  title={t.openPublicPage}
                >
                  <IconExternal size={12} aria-label={t.openPublicPage} />
                </Link>
                <button className="btn small" onClick={() => startEdit(loc)}>
                  <IconPencil size={12} /> {t.editBranch}
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

        <div className="field">
          <label htmlFor="br-map">{t.pickOnMap}</label>
          <span className="field-hint" id="br-map-hint">
            {t.pinHint}
          </span>
          <div id="br-map">
            <MapPicker
              point={form.point}
              label={t.pickOnMap}
              onPick={(lng, lat) => setForm((f) => ({ ...f, point: { lng, lat } }))}
            />
          </div>
          {form.point ? (
            <p className="pin-confirm">
              <IconCheck size={12} /> {t.pinConfirmed}
              {form.address.trim() && <span>· <IconPin size={12} /> {form.address.trim()}</span>}
              <span className="coords">
                {form.point.lng.toFixed(5)}, {form.point.lat.toFixed(5)}
              </span>
            </p>
          ) : (
            <p className="field-hint"><IconAlert size={12} /> {t.pinHint}</p>
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
          {form.id && (
            <button
              className="btn"
              onClick={() => {
                setForm(EMPTY_FORM);
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

      <PublicPreview business={business} form={form} />
    </section>
  );
}
