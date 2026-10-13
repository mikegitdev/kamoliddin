/** Premium icon set — web-sourced, two visual tiers:
 *
 *  1. 3D gradient renders from **3dicons** by Vijay Verma (3dicons.co),
 *     CC0 1.0 (github.com/realvjy/3dicons) — free commercial, no attribution.
 *  2. Gradient-badge glyphs: local squircle template + paths from
 *     Bootstrap Icons (MIT), simple-icons (CC0) and Lucide (ISC).
 *
 *  All icons are decorative (aria-hidden): every interactive control that
 *  uses one must also carry a text/aria label. */
import { useId, type ReactNode } from "react";

import zoom96 from "@/assets/icons/zoom@96.webp";
import zoom192 from "@/assets/icons/zoom@192.webp";
import pin96 from "@/assets/icons/pin@96.webp";
import pin192 from "@/assets/icons/pin@192.webp";
import forward96 from "@/assets/icons/forward@96.webp";
import forward192 from "@/assets/icons/forward@192.webp";
import back96 from "@/assets/icons/back@96.webp";
import back192 from "@/assets/icons/back@192.webp";
import target96 from "@/assets/icons/target@96.webp";
import target192 from "@/assets/icons/target@192.webp";
import phone96 from "@/assets/icons/phone-only@96.webp";
import phone192 from "@/assets/icons/phone-only@192.webp";
import link96 from "@/assets/icons/link@96.webp";
import link192 from "@/assets/icons/link@192.webp";
import clock96 from "@/assets/icons/clock@96.webp";
import clock192 from "@/assets/icons/clock@192.webp";
import plus96 from "@/assets/icons/plus@96.webp";
import plus192 from "@/assets/icons/plus@192.webp";
import bulb96 from "@/assets/icons/bulb@96.webp";
import bulb192 from "@/assets/icons/bulb@192.webp";
import money96 from "@/assets/icons/money@96.webp";
import money192 from "@/assets/icons/money@192.webp";
import megaphone96 from "@/assets/icons/megaphone@96.webp";
import megaphone192 from "@/assets/icons/megaphone@192.webp";
import rocket96 from "@/assets/icons/rocket@96.webp";
import rocket192 from "@/assets/icons/rocket@192.webp";
import gift96 from "@/assets/icons/gift@96.webp";
import gift192 from "@/assets/icons/gift@192.webp";
import lock96 from "@/assets/icons/lock@96.webp";
import lock192 from "@/assets/icons/lock@192.webp";
import shield96 from "@/assets/icons/sheild@96.webp";
import shield192 from "@/assets/icons/sheild@192.webp";
import flag96 from "@/assets/icons/flag@96.webp";
import flag192 from "@/assets/icons/flag@192.webp";
import lab96 from "@/assets/icons/lab@96.webp";
import lab192 from "@/assets/icons/lab@192.webp";
import card96 from "@/assets/icons/card@96.webp";
import card192 from "@/assets/icons/card@192.webp";
import calendar96 from "@/assets/icons/calender@96.webp";
import calendar192 from "@/assets/icons/calender@192.webp";
import pencil96 from "@/assets/icons/pencil@96.webp";
import pencil192 from "@/assets/icons/pencil@192.webp";
import bag96 from "@/assets/icons/bag@96.webp";
import bag192 from "@/assets/icons/bag@192.webp";

export interface IconProps {
  /** Rendered box size in px (default 18). */
  size?: number;
  className?: string;
}

/* ---------- Tier 1: 3D renders (3dicons, CC0) ---------- */

function Render({
  x1,
  x2,
  size = 18,
  className,
}: IconProps & { x1: string; x2: string }) {
  return (
    <img
      className={className ? `i3d ${className}` : "i3d"}
      src={x1}
      srcSet={`${x2} 2x`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
    />
  );
}

export const IconSearch = (p: IconProps) => <Render {...p} x1={zoom96} x2={zoom192} />;
export const IconPin = (p: IconProps) => <Render {...p} x1={pin96} x2={pin192} />;
export const IconDirections = (p: IconProps) => <Render {...p} x1={forward96} x2={forward192} />;
export const IconBack = (p: IconProps) => <Render {...p} x1={back96} x2={back192} />;
export const IconLocate = (p: IconProps) => <Render {...p} x1={target96} x2={target192} />;
export const IconPhone = (p: IconProps) => <Render {...p} x1={phone96} x2={phone192} />;
export const IconShare = (p: IconProps) => <Render {...p} x1={link96} x2={link192} />;
export const IconClock = (p: IconProps) => <Render {...p} x1={clock96} x2={clock192} />;
export const IconPlus = (p: IconProps) => <Render {...p} x1={plus96} x2={plus192} />;
export const IconBulb = (p: IconProps) => <Render {...p} x1={bulb96} x2={bulb192} />;
export const IconMoney = (p: IconProps) => <Render {...p} x1={money96} x2={money192} />;
export const IconMegaphone = (p: IconProps) => <Render {...p} x1={megaphone96} x2={megaphone192} />;
export const IconRocket = (p: IconProps) => <Render {...p} x1={rocket96} x2={rocket192} />;
export const IconGift = (p: IconProps) => <Render {...p} x1={gift96} x2={gift192} />;
export const IconLock = (p: IconProps) => <Render {...p} x1={lock96} x2={lock192} />;
export const IconShield = (p: IconProps) => <Render {...p} x1={shield96} x2={shield192} />;
export const IconFlag = (p: IconProps) => <Render {...p} x1={flag96} x2={flag192} />;
export const IconLab = (p: IconProps) => <Render {...p} x1={lab96} x2={lab192} />;
export const IconCard = (p: IconProps) => <Render {...p} x1={card96} x2={card192} />;
export const IconCalendar = (p: IconProps) => <Render {...p} x1={calendar96} x2={calendar192} />;
export const IconPencil = (p: IconProps) => <Render {...p} x1={pencil96} x2={pencil192} />;
export const IconBag = (p: IconProps) => <Render {...p} x1={bag96} x2={bag192} />;

/* ---------- Tier 2: gradient badges (glossy squircle + white glyph) ----------
 * Glyph paths: Bootstrap Icons (github.com/twbs/icons, MIT), simple-icons
 * (CC0), Lucide (github.com/lucide-icons/lucide, ISC). */

type Tone = "blue" | "green" | "red" | "orange" | "slate" | "violet" | "teal" | "telegram" | "whatsapp";

const TONES: Record<Tone, [string, string]> = {
  blue: ["#60a5fa", "#1d4ed8"],
  green: ["#4ade80", "#15803d"],
  red: ["#f87171", "#b91c1c"],
  orange: ["#fb923c", "#c2410c"],
  slate: ["#94a3b8", "#475569"],
  violet: ["#a78bfa", "#6d28d9"],
  teal: ["#2dd4bf", "#0f766e"],
  telegram: ["#2facf5", "#1a7fc1"],
  whatsapp: ["#3ee07c", "#129c62"],
};

function Badge({
  tone,
  vb,
  size = 18,
  className,
  children,
  round = false,
}: IconProps & { tone: Tone; vb: 16 | 24; children?: ReactNode; round?: boolean }) {
  const id = useId();
  const grad = `${id}-g`;
  const gloss = `${id}-l`;
  const [c1, c2] = TONES[tone];
  const side = vb - 1.2;
  const radius = round ? side / 2 : vb === 16 ? 4.4 : 6.4;
  return (
    <svg
      className={className ? `i3d badge ${className}` : "i3d badge"}
      viewBox={`0 0 ${vb} ${vb}`}
      width={size}
      height={size}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
        <linearGradient id={gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect
        x="0.6"
        y="0.6"
        width={side}
        height={side}
        rx={radius}
        fill={`url(#${grad})`}
      />
      <rect
        x="0.6"
        y="0.6"
        width={side}
        height={side * 0.62}
        rx={radius}
        fill={`url(#${gloss})`}
      />
      <rect
        x="0.6"
        y="0.6"
        width={side}
        height={side}
        rx={radius}
        fill="none"
        stroke="#fff"
        strokeOpacity="0.35"
        strokeWidth={vb === 16 ? 0.7 : 0.6}
      />
      {children}
    </svg>
  );
}

/* Glyphs (viewBox 0 0 16 16 — Bootstrap Icons, MIT) */
const G_CLOSE = "M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z";
const G_CHECK = "M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425z";
const G_CHEVRON_DOWN = "M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708";
const G_CHEVRON_UP = "M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708z";
const G_ARROW_LEFT = "M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8";
const G_ARROW_RIGHT = "M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8";
const G_WARN_1 = "M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.15.15 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.2.2 0 0 1-.054.06.1.1 0 0 1-.066.017H1.146a.1.1 0 0 1-.066-.017.2.2 0 0 1-.054-.06.18.18 0 0 1 .002-.183L7.884 2.073a.15.15 0 0 1 .054-.057m1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767z";
const G_WARN_2 = "M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z";
const G_BAN_1 = "M15 8a6.97 6.97 0 0 0-1.71-4.584l-9.874 9.875A7 7 0 0 0 15 8M2.71 12.584l9.874-9.875a7 7 0 0 0-9.874 9.874ZM16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0";
const G_EYE_1 = "M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z";
const G_EYE_2 = "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0";
const G_SAVE = "M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H9.5a1 1 0 0 0-1 1v7.293l2.646-2.647a.5.5 0 0 1 .708.708l-3.5 3.5a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L7.5 9.293V2a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1z";
const G_EXTERNAL_1 = "M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5";
const G_EXTERNAL_2 = "M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0z";
const G_PEOPLE_1 = "M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1zm-7.978-1L7 12.996c.001-.264.167-1.03.76-1.72C8.312 10.629 9.282 10 11 10c1.717 0 2.687.63 3.24 1.276.593.69.758 1.457.76 1.72l-.008.002-.014.002zM11 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4m3-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0M6.936 9.28a6 6 0 0 0-1.23-.247A7 7 0 0 0 5 9c-4 0-5 3-5 4q0 1 1 1h4.216A2.24 2.24 0 0 1 5 13c0-1.01.377-2.042 1.09-2.904.243-.294.526-.569.846-.816M4.92 10A5.5 5.5 0 0 0 4 13H1c0-.26.164-1.03.76-1.724.545-.636 1.492-1.256 3.16-1.275ZM1.5 5.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0m3-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4";
const GLOBE_SCALE = "scale(0.68) translate(3.8 3.8)";
const G_GLOBE = "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.5-6.923c-.67.204-1.335.82-1.887 1.855A8 8 0 0 0 5.145 4H7.5zM4.09 4a9.3 9.3 0 0 1 .64-1.539 7 7 0 0 1 .597-.933A7.03 7.03 0 0 0 2.255 4zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a7 7 0 0 0-.656 2.5zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5zM8.5 5v2.5h2.99a12.5 12.5 0 0 0-.337-2.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5zM5.145 12q.208.58.468 1.068c.552 1.035 1.218 1.65 1.887 1.855V12zm.182 2.472a7 7 0 0 1-.597-.933A9.3 9.3 0 0 1 4.09 12H2.255a7 7 0 0 0 3.072 2.472M3.82 11a13.7 13.7 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5zm6.853 3.472A7 7 0 0 0 13.745 12H11.91a9.3 9.3 0 0 1-.64 1.539 7 7 0 0 1-.597.933M8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855q.26-.487.468-1.068zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.7 13.7 0 0 1-.312 2.5m2.802-3.5a7 7 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7 7 0 0 0-3.072-2.472c.218.284.418.598.597.933M10.855 4a8 8 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4z";

/* Glyphs (viewBox 0 0 24 24 — simple-icons, CC0) */
const G_TELEGRAM = "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z";
const G_WHATSAPP = "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z";

/* Lucide "scale" (ISC), stroke-based */
const SCALE_PATHS = [
  "M12 3v18",
  "m19 8 3 8a5 5 0 0 1-6 0zV7",
  "M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1",
  "m5 8 3 8a5 5 0 0 1-6 0zV7",
  "M7 21h10",
];

export const IconClose = (p: IconProps) => (
  <Badge {...p} tone="slate" vb={16}>
    <path d={G_CLOSE} fill="#fff" />
  </Badge>
);

export const IconCheck = (p: IconProps) => (
  <Badge {...p} tone="green" vb={16}>
    <path d={G_CHECK} fill="#fff" />
  </Badge>
);

export const IconReject = (p: IconProps) => (
  <Badge {...p} tone="red" vb={16}>
    <path d={G_CLOSE} fill="#fff" />
  </Badge>
);

export const IconBlock = (p: IconProps) => (
  <Badge {...p} tone="red" vb={16}>
    <path d={G_BAN_1} fill="#fff" />
  </Badge>
);

export const IconAlert = (p: IconProps) => (
  <Badge {...p} tone="orange" vb={16}>
    <path d={G_WARN_1} fill="#fff" />
    <path d={G_WARN_2} fill="#fff" />
  </Badge>
);

export const IconOrb = (p: IconProps) => (
  <Badge {...p} tone="green" vb={16} round />
);

export const IconChevronDown = (p: IconProps) => (
  <Badge {...p} tone="blue" vb={16}>
    <path d={G_CHEVRON_DOWN} fill="#fff" />
  </Badge>
);

export const IconChevronUp = (p: IconProps) => (
  <Badge {...p} tone="blue" vb={16}>
    <path d={G_CHEVRON_UP} fill="#fff" />
  </Badge>
);

export const IconArrowLeft = (p: IconProps) => (
  <Badge {...p} tone="slate" vb={16}>
    <path d={G_ARROW_LEFT} fill="#fff" />
  </Badge>
);

export const IconArrowRight = (p: IconProps) => (
  <Badge {...p} tone="slate" vb={16}>
    <path d={G_ARROW_RIGHT} fill="#fff" />
  </Badge>
);

export const IconExternal = (p: IconProps) => (
  <Badge {...p} tone="blue" vb={16}>
    <path d={G_EXTERNAL_1} fill="#fff" />
    <path d={G_EXTERNAL_2} fill="#fff" />
  </Badge>
);

export const IconEye = (p: IconProps) => (
  <Badge {...p} tone="violet" vb={16}>
    <path d={G_EYE_1} fill="#fff" />
    <path d={G_EYE_2} fill="#fff" />
  </Badge>
);

export const IconSave = (p: IconProps) => (
  <Badge {...p} tone="violet" vb={16}>
    <path d={G_SAVE} fill="#fff" />
  </Badge>
);

export const IconUsers = (p: IconProps) => (
  <Badge {...p} tone="teal" vb={16}>
    <path d={G_PEOPLE_1} fill="#fff" />
  </Badge>
);

export const IconGlobe = (p: IconProps) => (
  <Badge {...p} tone="blue" vb={16}>
    <path d={G_GLOBE} fill="#fff" transform={GLOBE_SCALE} />
  </Badge>
);

export const IconScale = (p: IconProps) => (
  <Badge {...p} tone="slate" vb={24}>
    <g fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {SCALE_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
  </Badge>
);

export const IconTelegram = (p: IconProps) => (
  <Badge {...p} tone="telegram" vb={24}>
    <path d={G_TELEGRAM} fill="#fff" transform="scale(0.66) translate(6.2 6.2)" />
  </Badge>
);

export const IconWhatsapp = (p: IconProps) => (
  <Badge {...p} tone="whatsapp" vb={24}>
    <path d={G_WHATSAPP} fill="#fff" transform="scale(0.66) translate(6.2 6.2)" />
  </Badge>
);
