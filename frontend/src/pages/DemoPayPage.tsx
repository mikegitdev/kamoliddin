import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useOrder, useSession } from "@/shared/api/queries";
import { ApiError } from "@/shared/api/client";
import { completeFakePayment } from "@/features/advertiser/api";
import {
  ACCEPTED_NETWORKS,
  NETWORK_LABEL,
  PROVIDER_NAME,
  ProviderWordmark,
  TEST_CARDS,
  detectNetwork,
  digitsOnly,
  expiryValid,
  formatCardNumber,
  formatExpiry,
  isInternational,
  isPayMethod,
  maskCard,
  type PayMethod,
} from "@/features/payments/providers";
import { formatDateTime, formatMinor } from "@/shared/format";
import { IconAlert, IconCheck, IconLock } from "@/shared/icons";
import { LanguageSwitcher, useI18n } from "@/shared/i18n";

/** Handed over by CheckoutPage after the (fake-gateway) checkout session. */
export interface DemoPayState {
  redirectUrl: string;
  paymentId: string;
}

type Step = "card" | "confirm" | "processing" | "done" | "failed";

const MERCHANT = "Local Ads";
const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;
const RETURN_SECONDS = 5;
const PAYABLE = ["draft_quote", "awaiting_payment"];

/** Mock of a provider-hosted card page (Click / Payme / Octobank) for demos.
 *  Only reachable from checkout on a fake-gateway stack: without the session
 *  it hands back to checkout. Paying fires the fake gateway's callback, so the
 *  order settles through the real webhook path. */
export function DemoPayPage() {
  const { provider, orderId } = useParams<{ provider: string; orderId: string }>();
  const session = useLocation().state as DemoPayState | null;
  if (!orderId) return <Navigate to="/app" replace />;
  if (!isPayMethod(provider) || !session?.redirectUrl) {
    return <Navigate to={`/app/checkout/${orderId}`} replace />;
  }
  return <DemoPayFlow method={provider} orderId={orderId} session={session} />;
}

function DemoPayFlow({ method, orderId, session }: { method: PayMethod; orderId: string; session: DemoPayState }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: order } = useOrder(orderId);
  const { data: me } = useSession();

  const [step, setStep] = useState<Step>("card");
  const [card, setCard] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paidAt, setPaidAt] = useState<string | null>(null);
  // One countdown, reused: SMS resend on "confirm", auto-return on "done".
  const [countdown, setCountdown] = useState(0);

  const network = detectNetwork(card);
  const international = isInternational(network);
  const checkoutPath = `/app/checkout/${orderId}`;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (step === "done" && countdown === 0) navigate(checkoutPath, { replace: true });
  }, [step, countdown, navigate, checkoutPath]);

  // Paid elsewhere / expired meanwhile: nothing left to pay on this page.
  if (order && step === "card" && !PAYABLE.includes(order.state)) {
    return <Navigate to={checkoutPath} replace />;
  }

  const amount = order ? formatMinor(order.amount_total, order.currency, locale) : null;
  const cardError =
    card.length < 16
      ? t.payCardInvalid
      : !network || !ACCEPTED_NETWORKS[method].includes(network)
        ? t.payCardNotAccepted
        : null;
  const expiryError = expiryValid(expiry) ? null : t.payExpiryInvalid;
  const cvvError = international && cvv.length !== 3 ? t.payCvvInvalid : null;

  const cancel = () => navigate(checkoutPath, { replace: true, state: { paymentCancelled: true } });

  const submitCard = () => {
    setSubmitted(true);
    if (cardError || expiryError || cvvError) return;
    setCode("");
    setCountdown(RESEND_SECONDS);
    setStep("confirm");
  };

  const fillTestCard = () => {
    const test = TEST_CARDS[method];
    setCard(test.number);
    setExpiry(test.expiry);
    setCvv(test.cvv);
  };

  const settle = async () => {
    setStep("processing");
    setError(null);
    try {
      // The short floor keeps the "processing" state readable in a demo.
      await Promise.all([
        completeFakePayment(session.redirectUrl),
        new Promise((resolve) => setTimeout(resolve, 1400)),
      ]);
      setPaidAt(new Date().toISOString());
      setCountdown(RETURN_SECONDS);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : null);
      setStep("failed");
    }
  };

  const onCodeChange = (value: string) => {
    const next = digitsOnly(value).slice(0, CODE_LENGTH);
    setCode(next);
    if (next.length === CODE_LENGTH) void settle();
  };

  return (
    <div className="demo-pay" data-provider={method}>
      <div className="demo-pay-shell">
        <header className="demo-pay-head">
          <ProviderWordmark method={method} />
          <div className="row">
            <span className="demo-pay-badge">{t.payDemoBadge}</span>
            <LanguageSwitcher />
          </div>
        </header>

        <main className="demo-pay-panel">
          <div className="demo-pay-merchant">
            <div>
              <span className="demo-pay-label">{t.payMerchant}</span>
              <strong>{MERCHANT}</strong>
            </div>
            <div className="demo-pay-order">
              <span className="demo-pay-label">{t.payOrder}</span>
              <span className="mono">№ {orderId.slice(0, 8).toUpperCase()}</span>
            </div>
          </div>
          <div className="demo-pay-amount">
            {amount ?? <span className="skeleton skeleton-line w60" />}
          </div>

          {step === "card" && (
            <form
              className="demo-pay-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitCard();
              }}
              noValidate
            >
              <div className="demo-card" data-network={network ?? ""} aria-hidden="true">
                <div className="demo-card-top">
                  <span className="demo-card-chip" />
                  <span className="demo-card-network">{network ? NETWORK_LABEL[network] : ""}</span>
                </div>
                <div className="demo-card-number">
                  {formatCardNumber(card.padEnd(16, "•"))}
                </div>
                <div className="demo-card-bottom">
                  <span>{PROVIDER_NAME[method]}</span>
                  <span>{expiry ? formatExpiry(expiry.padEnd(4, "•")) : "MM/YY"}</span>
                </div>
              </div>

              <label className="demo-pay-field">
                <span>{t.payCardNumber}</span>
                {/* autocomplete off: a mock must never invite saving a real card */}
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0000 0000 0000 0000"
                  value={formatCardNumber(card)}
                  onChange={(e) => setCard(digitsOnly(e.target.value).slice(0, 16))}
                  aria-invalid={submitted && !!cardError}
                />
                {submitted && cardError && <span className="demo-pay-error">{cardError}</span>}
              </label>
              <div className="demo-pay-row">
                <label className="demo-pay-field">
                  <span>{t.payExpiry}</span>
                  <input
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="MM/YY"
                    value={formatExpiry(expiry)}
                    onChange={(e) => setExpiry(digitsOnly(e.target.value).slice(0, 4))}
                    aria-invalid={submitted && !!expiryError}
                  />
                  {submitted && expiryError && <span className="demo-pay-error">{expiryError}</span>}
                </label>
                {international && (
                  <label className="demo-pay-field">
                    <span>CVV / CVC</span>
                    <input
                      inputMode="numeric"
                      autoComplete="off"
                      type="password"
                      placeholder="•••"
                      value={cvv}
                      onChange={(e) => setCvv(digitsOnly(e.target.value).slice(0, 3))}
                      aria-invalid={submitted && !!cvvError}
                    />
                    {submitted && cvvError && <span className="demo-pay-error">{cvvError}</span>}
                  </label>
                )}
              </div>

              <button className="demo-pay-btn" type="submit" disabled={!amount}>
                {t.payAmount} {amount}
              </button>
              <div className="demo-pay-links">
                <button type="button" className="demo-pay-link" onClick={fillTestCard}>
                  {t.payFillTestCard}
                </button>
                <button type="button" className="demo-pay-link" onClick={cancel}>
                  {t.payCancel}
                </button>
              </div>
              <div className="demo-pay-accepts">
                <span>{t.payAccepts}:</span>
                {ACCEPTED_NETWORKS[method].map((n) => (
                  <span key={n} className="demo-net">{NETWORK_LABEL[n]}</span>
                ))}
              </div>
            </form>
          )}

          {step === "confirm" && (
            <form
              className="demo-pay-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === CODE_LENGTH) void settle();
              }}
            >
              <h1 className="demo-pay-title">{international ? t.pay3dsTitle : t.paySmsTitle}</h1>
              <p className="demo-pay-sub">
                {international ? t.pay3dsSub : `${t.paySmsSent} ${maskPhone(me?.phone_e164)}`}
              </p>
              <p className="demo-pay-sub">
                {network && NETWORK_LABEL[network]} {maskCard(card)}
              </p>
              <input
                className="demo-pay-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={t.payCodeLabel}
                placeholder={"•".repeat(CODE_LENGTH)}
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                autoFocus
              />
              <p className="demo-pay-hint">{t.payDemoCodeHint}</p>
              <button className="demo-pay-btn" type="submit" disabled={code.length < CODE_LENGTH}>
                {t.payConfirm}
              </button>
              <div className="demo-pay-links">
                {countdown > 0 ? (
                  <span className="demo-pay-hint">
                    {t.payResendIn} {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <button type="button" className="demo-pay-link" onClick={() => setCountdown(RESEND_SECONDS)}>
                    {t.payResend}
                  </button>
                )}
                <button type="button" className="demo-pay-link" onClick={() => setStep("card")}>
                  {t.payChangeCard}
                </button>
              </div>
            </form>
          )}

          {step === "processing" && (
            <div className="demo-pay-status" role="status">
              <span className="demo-pay-spinner" aria-hidden="true" />
              <strong>{t.payProcessing}</strong>
              <span className="demo-pay-hint">{t.payDoNotClose}</span>
            </div>
          )}

          {step === "done" && (
            <>
              <div className="demo-pay-status ok" role="status">
                <span className="demo-pay-check" aria-hidden="true">
                  <IconCheck size={34} />
                </span>
                <strong>{t.paySuccess}</strong>
              </div>
              <dl className="demo-pay-receipt">
                <div>
                  <dt>{t.payMerchant}</dt>
                  <dd>{MERCHANT}</dd>
                </div>
                <div>
                  <dt>{t.payCard}</dt>
                  <dd>
                    {network && NETWORK_LABEL[network]} {maskCard(card)}
                  </dd>
                </div>
                <div>
                  <dt>{t.payTransaction}</dt>
                  <dd className="mono">{transactionRef(session.paymentId)}</dd>
                </div>
                <div>
                  <dt>{t.payDate}</dt>
                  <dd>{formatDateTime(paidAt, locale)}</dd>
                </div>
              </dl>
              <button
                className="demo-pay-btn"
                type="button"
                onClick={() => navigate(checkoutPath, { replace: true })}
              >
                {t.payReturn}
              </button>
              <p className="demo-pay-hint demo-pay-center">
                {t.payAutoReturn} {countdown} {t.paySecondsShort}
              </p>
            </>
          )}

          {step === "failed" && (
            <>
              <div className="demo-pay-status fail" role="alert">
                <span className="demo-pay-check" aria-hidden="true">
                  <IconAlert size={30} />
                </span>
                <strong>{t.payFailed}</strong>
                {error && <span className="demo-pay-hint">{error}</span>}
              </div>
              <button className="demo-pay-btn" type="button" onClick={() => void settle()}>
                {t.retry}
              </button>
              <div className="demo-pay-links">
                <button type="button" className="demo-pay-link" onClick={cancel}>
                  {t.payCancel}
                </button>
              </div>
            </>
          )}
        </main>

        <footer className="demo-pay-foot">
          <IconLock size={14} />
          <span>
            {t.sandboxNote} {t.payCardStaysLocal}
          </span>
        </footer>
      </div>
    </div>
  );
}

/** "+998901234567" -> "+998 90 ***-**-67" */
function maskPhone(phone: string | undefined): string {
  if (!phone || !/^\+998\d{9}$/.test(phone)) return "+998 ** ***-**-**";
  return `+998 ${phone.slice(4, 6)} ***-**-${phone.slice(-2)}`;
}

/** Short receipt reference from the gateway payment id ("fake-<uuid>"). */
function transactionRef(paymentId: string): string {
  return digitsOnly(paymentId).slice(0, 12).padEnd(12, "0");
}
