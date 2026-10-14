import { useId } from "react";

/** Brand logo mark — flat map pin on a blue gradient with a white ring and
 *  orange "beacon" dot (brand: --primary #1d4ed8 / --accent-strong #ea580c).
 *  Scales from favicon (16px) to login hero (56px+) without rasterization.
 *  Decorative by contract: containers pass aria-hidden. */
export function LogoMark({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const id = useId();
  const grad = `${id}-g`;
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={grad} x1="6" y1="2" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {/* pin body */}
      <path
        d="M16 2.5c-5.66 0-10.25 4.52-10.25 10.1 0 7.53 8.4 15.63 9.53 16.7a1.03 1.02 0 0 0 1.44 0c1.13-1.07 9.53-9.17 9.53-16.7 0-5.58-4.59-10.1-10.25-10.1z"
        fill={`url(#${grad})`}
      />
      {/* white ring + orange beacon dot */}
      <circle cx="16" cy="12.4" r="4.7" fill="#fff" />
      <circle cx="16" cy="12.4" r="2.6" fill="#ea580c" />
    </svg>
  );
}
