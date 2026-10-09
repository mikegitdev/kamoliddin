import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LanguageSwitcher, useI18n } from "@/shared/i18n";
import { api, ApiError } from "@/shared/api/client";
import { requestOtp, verifyOtp } from "@/features/auth/otp";

const RESEND_SECONDS = 60;

/** Tolerant UZ phone normalization: 901234567 / 998901234567 / +998 90 123 45 67. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return raw.trim();
}

/** Phone OTP login (spec §13 /login): request code -> verify -> session. */
export function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Ensure the csrftoken cookie exists even if a stale session is present.
  useEffect(() => {
    api("/api/v1/auth/csrf").catch(() => {});
  }, []);

  const requestCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const normalized = normalizePhone(phone);
    try {
      await requestOtp(normalized);
      setPhone(normalized);
      setStage("code");
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
      await verifyOtp(normalizePhone(phone), code);
      navigate("/app");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.error);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-top">
          <Link to="/" className="muted">
            ← {t.toHomepage}
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="login-logo" aria-hidden="true">
          📍
        </div>
        <h1>{t.loginIntro}</h1>
        <p className="login-sub">{stage === "phone" ? t.tagline : `${t.codeSent} → ${phone}`}</p>
        <p className="login-hint">{t.loginHint}</p>

        {stage === "phone" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (phone.replace(/\D/g, "").length >= 9) requestCode();
            }}
          >
            <label htmlFor="phone">{t.phone}</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
              inputMode="tel"
              autoFocus
            />
            <button
              className="btn primary"
              type="submit"
              style={{ marginTop: 12, width: "100%" }}
              disabled={busy || phone.replace(/\D/g, "").length < 9}
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
            <label htmlFor="code">{t.smsCode}</label>
            <div className="login-code-row">
              <input
                id="code"
                name="code"
                type="text"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoFocus
                placeholder="••••••"
              />
            </div>
            <button
              className="btn primary"
              type="submit"
              style={{ marginTop: 12, width: "100%" }}
              disabled={busy || code.length < 4}
            >
              {busy ? t.verifying : t.verify}
            </button>
            <div className="otp-countdown">
              {countdown > 0 ? (
                `${t.resend} — ${countdown} ${t.seconds}`
              ) : (
                <button
                  type="button"
                  className="btn subtle small"
                  onClick={requestCode}
                  disabled={busy}
                >
                  {t.resend}
                </button>
              )}
            </div>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8, width: "100%" }}
              onClick={() => setStage("phone")}
              disabled={busy}
            >
              {t.changeNumber}
            </button>
          </form>
        )}

        {error && (
          <p className="error" style={{ textAlign: "center" }} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
