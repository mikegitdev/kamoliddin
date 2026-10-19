import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LanguageSwitcher, useI18n } from "@/shared/i18n";
import { api, ApiError } from "@/shared/api/client";
import { IconArrowLeft, IconPin } from "@/shared/icons";
import { requestOtp, verifyOtp } from "@/features/auth/otp";
import { formatPhone } from "@/shared/format";
import { OtpInput } from "@/shared/otp-input";

const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

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
  const queryClient = useQueryClient();
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
      // A new identity: nothing cached under a previous session (another
      // account in this tab, or the logged-out state) may be shown.
      queryClient.clear();
      navigate("/app");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.error);
      setBusy(false);
    }
  };

  // Auto-verify shortly after the full 6-digit code is entered — the small
  // delay leaves the explicit button click a clear path (and feels deliberate).
  useEffect(() => {
    if (stage !== "code" || code.length !== 6 || busy) return;
    const timer = setTimeout(() => void verify(), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, stage]);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-top">
          <Link to="/" className="muted">
            <IconArrowLeft size={14} /> {t.toHomepage}
          </Link>
          <LanguageSwitcher />
        </div>
        <div className="login-logo" aria-hidden="true">
          <IconPin size={52} />
        </div>
        <h1>{t.loginIntro}</h1>
        <p className="login-sub">{stage === "phone" ? t.tagline : `${t.codeSent} → ${formatPhone(phone)}`}</p>
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
              aria-describedby={error ? "login-error" : undefined}
            />
            <span className="field-hint">{t.phoneHint}</span>
            <button
              className="btn primary mt-12 w-full"
              type="submit"
              disabled={busy || phone.replace(/\D/g, "").length < 9}
            >
              {busy ? t.sending : t.sendCode}
            </button>
            <p className="login-consent muted-2">{t.loginConsent}</p>
            {error && (
              <p className="error" id="login-error" role="alert">
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
            <label htmlFor="login-otp">{t.smsCode}</label>
            <div className="login-code-row">
              <OtpInput
                id="login-otp"
                value={code}
                onChange={(next) => {
                  setCode(next);
                  setError(null);
                }}
                ariaDescribedBy={error ? "login-error" : undefined}
              />
            </div>
            <button
              className="btn primary mt-12 w-full"
              type="submit"
              disabled={busy || code.length < CODE_LENGTH}
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
            <div className="otp-countdown">
              <button
                type="button"
                className="link-button"
                onClick={() => setStage("phone")}
                disabled={busy}
              >
                {t.changeNumber}
              </button>
            </div>
            {error && (
              <p className="error" id="login-error" role="alert">
                {error}
              </p>
            )}
          </form>
        )}

      </div>
    </div>
  );
}
