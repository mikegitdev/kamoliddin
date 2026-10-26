import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/shared/api/client";
import { useAdLimit } from "@/shared/api/queries";
import { useI18n } from "@/shared/i18n";
import { IconCheck } from "@/shared/icons";
import { QueryError } from "@/shared/ui";

export function SettingsTab({ onError }: { onError: (e: string | null) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data, isError, refetch } = useAdLimit(true);
  const [value, setValue] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  const current = value === "" ? data?.value ?? 5 : value;

  const save = async () => {
    setBusy(true);
    onError(null);
    setOk(false);
    try {
      await api("/api/v1/admin/settings/ad-limit", {
        method: "PATCH",
        json: { value: current },
      });
      setOk(true);
      setValue("");
      qc.invalidateQueries({ queryKey: ["staff", "ad-limit"] });
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card max-w-560 form">
      <h2>{t.settings}</h2>
      {/* Without the live value the input would show a made-up default. */}
      {isError && !data && <QueryError onRetry={() => refetch()} />}
      {ok && <p className="callout ok"><IconCheck size={16} /> {t.saved}</p>}
      <div className="field">
        <label htmlFor="ad-limit">{t.adLimit}</label>
        <input
          id="ad-limit"
          type="number"
          min={1}
          max={50}
          value={current}
          onChange={(e) => setValue(Number(e.target.value))}
        />
        <p className="muted-2">{t.adLimitHint}</p>
      </div>
      {/* The API accepts 1..50; an emptied field reads as 0. */}
      <button className="btn primary mt-8" disabled={busy || !(current >= 1 && current <= 50)} onClick={save}>
        {busy ? "…" : t.save}
      </button>
    </section>
  );
}
