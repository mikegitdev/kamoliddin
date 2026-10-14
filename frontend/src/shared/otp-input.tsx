/**
 * Segmented 6-digit OTP input (design review: login/account). One digit per
 * box, paste support, arrow/backspace navigation — the pattern users expect
 * for SMS codes. The value stays a plain string for the surrounding forms.
 */
import { useRef } from "react";
import { useI18n } from "@/shared/i18n";

const LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  autoFocus = false,
  id,
  ariaDescribedBy,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  id?: string;
  ariaDescribedBy?: string;
}) {
  const { t } = useI18n();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  const focusAt = (i: number) => refs.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus();

  const setDigit = (i: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    if (!digit) return;
    const next = digits.slice();
    next[i] = digit;
    onChange(next.join(""));
    if (i < LENGTH - 1) focusAt(i + 1);
  };

  return (
    <div className="otp-boxes" id={id} role="group" aria-label={t.smsCode}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          autoFocus={autoFocus && i === 0}
          aria-label={`${t.smsCode} — ${i + 1}`}
          aria-describedby={i === 0 ? ariaDescribedBy : undefined}
          onChange={(e) => setDigit(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) {
              e.preventDefault();
              const next = digits.slice();
              next[i - 1] = "";
              onChange(next.join(""));
              focusAt(i - 1);
            } else if (e.key === "ArrowLeft" && i > 0) {
              e.preventDefault();
              focusAt(i - 1);
            } else if (e.key === "ArrowRight" && i < LENGTH - 1) {
              e.preventDefault();
              focusAt(i + 1);
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
            if (pasted) {
              onChange(pasted);
              focusAt(Math.min(pasted.length, LENGTH - 1));
            }
          }}
        />
      ))}
    </div>
  );
}
