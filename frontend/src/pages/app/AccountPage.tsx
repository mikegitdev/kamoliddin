import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/client";
import { useSession } from "@/shared/api/queries";
import { deleteAccount, requestPhoneChange, verifyPhoneChange } from "@/features/auth/account";
import { formatPhone } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { OtpInput } from "@/shared/otp-input";
import { toast } from "@/shared/toast";

const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const requestCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const normalized = normalizePhone(newPhone);
    try {
      await requestPhoneChange(normalized);
      setNewPhone(normalized);
      setStage("code");
      setCode("");
      setCountdown(RESEND_SECONDS);
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
      toast.success(t.phoneChanged);
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
    if (busy || !deleteConfirmed) return;
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

  /** Locale-free typed confirmation: the last 4 digits of the own number. */
  const last4 = (user?.phone_e164 ?? "").replace(/\D/g, "").slice(-4);
  const deleteConfirmed = last4.length === 4 && confirmText.trim() === last4;

  return (
    <section className="form">
      <h2>{t.account}</h2>

      <div className="form-section flush">
        <h3 className="section-title">{t.accountPhone}</h3>
        <p className="muted">{formatPhone(user?.phone_e164)}</p>

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
            <div className="form-actions">
              <button
                className="btn primary"
                type="submit"
                disabled={busy || newPhone.replace(/\D/g, "").length < 9}
              >
                {busy ? t.sending : t.sendCode}
              </button>
            </div>
            {error && (
              <p className="error mt-10" role="alert">
                {error}
              </p>
            )}
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === CODE_LENGTH) verify();
            }}
          >
            <p className="muted">
              {t.codeSentNew} → {newPhone}
            </p>
            <div className="field">
              <label htmlFor="change-otp">{t.smsCode}</label>
              <OtpInput
                id="change-otp"
                value={code}
                onChange={(next) => {
                  setCode(next);
                  setError(null);
                }}
              />
            </div>
            <div className="row">
              <button className="btn primary" type="submit" disabled={busy || code.length < CODE_LENGTH}>
                {busy ? t.verifying : t.verify}
              </button>
              {countdown > 0 ? (
                <span className="muted-2 otp-countdown">
                  {t.resend} — {countdown} {t.seconds}
                </span>
              ) : (
                <button
                  type="button"
                  className="btn subtle"
                  onClick={requestCode}
                  disabled={busy}
                >
                  {t.resend}
                </button>
              )}
              <button
                className="btn"
                type="button"
                onClick={() => setStage("phone")}
                disabled={busy}
              >
                {t.cancel}
              </button>
            </div>
            {error && (
              <p className="error mt-10" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </div>

      <div className="form-section danger-zone">
        <h3 className="section-title">{t.deleteAccount}</h3>
        <p className="muted">{t.deleteAccountHint}</p>
        <p className="muted-2">{t.deleteWhyDigits}</p>
        <div className="field">
          <label htmlFor="delete-confirm">{t.deleteConfirmDigits}</label>
          <input
            id="delete-confirm"
            name="delete-confirm"
            type="text"
            inputMode="numeric"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="••••"
            autoComplete="off"
          />
        </div>
        <div className="form-actions">
          <button
            className={`btn ${deleteConfirmed ? "danger-solid" : "danger"}`}
            type="button"
            onClick={remove}
            disabled={busy || !deleteConfirmed}
          >
            {t.deleteAccount}
          </button>
        </div>
      </div>

    </section>
  );
}
