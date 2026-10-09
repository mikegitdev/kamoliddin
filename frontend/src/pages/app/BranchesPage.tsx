import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBusinessLocations, useBusinesses } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { createLocation } from "@/features/advertiser/api";
import { MapLibreAdapter, type MapAdapter } from "@/map-adapters";
import { useI18n } from "@/shared/i18n";

function MapPicker({
  lng,
  lat,
  onPick,
}: {
  lng: number | null;
  lat: number | null;
  onPick: (lng: number, lat: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<MapAdapter | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const adapter = new MapLibreAdapter();
    adapter.initialize(containerRef.current);
    adapter.onMapClick((clickedLng, clickedLat) => onPick(clickedLng, clickedLat));
    adapterRef.current = adapter;
    return () => {
      adapter.destroy();
      adapterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (adapterRef.current && lng !== null && lat !== null) {
      adapterRef.current.setMarkers([{ id: "picked", lng, lat, activeAdsCount: 0 }]);
    }
  }, [lng, lat]);

  return <div className="map-picker" ref={containerRef} role="img" aria-label="map picker" />;
}

export function BranchesPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: businesses } = useBusinesses();
  const business = businesses?.[0];
  const { data: locations } = useBusinessLocations(business?.id);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [point, setPoint] = useState<{ lng: number; lat: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createLocation(business!.id, {
        name,
        address,
        phone: phone || undefined,
        lon: point!.lng,
        lat: point!.lat,
      }),
    onSuccess: () => {
      setName("");
      setAddress("");
      setPhone("");
      setPoint(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["business-locations", business?.id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t.error),
  });

  if (!business) {
    return (
      <section>
        <p className="callout">
          ℹ️ {t.createBusinessHint} — <Link to="/app/business">{t.business}</Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>{t.branches}</h2>
      {locations && locations.length === 0 && <p className="muted">{t.noBranches}</p>}
      <ul className="list">
        {locations?.map((loc) => (
          <li key={loc.id}>
            <strong>{loc.name}</strong>
            <span className="muted">{loc.address}</span>
          </li>
        ))}
      </ul>

      <div className="form card-form">
        <h3>{t.addBranch}</h3>
        <div className="field">
          <label htmlFor="br-name">{t.branchName}</label>
          <input id="br-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="br-address">{t.streetAddress}</label>
          <input id="br-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="br-phone">{t.phone}</label>
          <input
            id="br-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+998 …"
          />
        </div>

        <div className="field">
          <label htmlFor="br-map">{t.pickOnMap}</label>
          <div id="br-map">
            <MapPicker
              lng={point?.lng ?? null}
              lat={point?.lat ?? null}
              onPick={(lng, lat) => setPoint({ lng, lat })}
            />
          </div>
          {point && (
            <p className="muted-2">
              {t.pickedCoords}: {point.lng.toFixed(5)}, {point.lat.toFixed(5)}
            </p>
          )}
        </div>
        <div className="form-actions">
          <button
            className="btn primary"
            disabled={mutation.isPending || !name || !address || !point}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? t.saving : t.save}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
