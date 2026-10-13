import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/client";
import { useSession } from "@/shared/api/queries";
import { deleteAccount, requestPhoneChange, verifyPhoneChange } from "@/features/auth/account";
import { useI18n } from "@/shared/i18n";

/** Account settings: phone change (OTP to the NEW phone, spec §9) and
 * soft account deletion (anonymize + stop charges, spec §14). */

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return raw.trim();
}

export function AccountPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useSession();

  const [newPhone, setNewPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirmText, setConfirmText] = useState("");

  const requestCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const normalized = normalizePhone(newPhone);
    try {
      await requestPhoneChange(normalized);
      setNewPhone(normalized);
      setStage("code");
      setCode("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.error);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyPhoneChange(normalizePhone(newPhone), code);
      setNotice(t.phoneChanged);
      setStage("phone");
      setNewPhone("");
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (e) {
      if (e instanceof ApiError && e.code === "phone_in_use") setError(t.phoneInUse);
      else setError(e instanceof ApiError ? e.message : t.error);
      if (e instanceof ApiError && e.code === "phone_in_use") setStage("phone");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || confirmText !== "DELETE") return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      queryClient.clear();
      navigate("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.error);
      setBusy(false);
    }
  };

  return (
    <section className="form">
      <h2>{t.account}</h2>

      <div className="form-section" style={{ borderTop: "none", marginTop: 8, paddingTop: 0 }}>
        <h3 className="section-title">{t.accountPhone}</h3>
        <p className="muted">{user?.phone_e164 ?? "…"}</p>

        {stage === "phone" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newPhone.replace(/\D/g, "").length >= 9) requestCode();
            }}
          >
            <div className="field">
              <label htmlFor="new-phone">{t.newPhone}</label>
              <input
                id="new-phone"
                name="new-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+998 90 123 45 67"
              />
            </div>
            <button
              className="btn primary"
              type="submit"
              disabled={busy || newPhone.replace(/\D/g, "").length < 9}
            >
              {busy ? t.sending : t.sendCode}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length >= 4) verify();
            }}
          >
            <p className="muted">
              {t.codeSentNew} → {newPhone}
            </p>
            <div className="field">
              <label htmlFor="change-code">{t.smsCode}</label>
              <input
                id="change-code"
                name="change-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                autoFocus
              />
            </div>
            <div className="row">
              <button className="btn primary" type="submit" disabled={busy || code.length < 4}>
                {busy ? t.verifying : t.verify}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setStage("phone")}
                disabled={busy}
              >
                {t.cancel}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="form-section">
        <h3 className="section-title">{t.deleteAccount}</h3>
        <p className="muted">{t.deleteAccountHint}</p>
        <div className="field">
          <label htmlFor="delete-confirm">{t.deleteConfirmType}</label>
          <input
            id="delete-confirm"
            name="delete-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
        </div>
        <button
          className="btn danger"
          type="button"
          onClick={remove}
          disabled={busy || confirmText !== "DELETE"}
        >
          {t.deleteAccount}
        </button>
      </div>

      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
