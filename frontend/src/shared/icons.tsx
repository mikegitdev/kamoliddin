/** Icon set — one visual tier: 24px line glyphs drawn with currentColor, so
 *  every icon takes the color of the text/control it sits in.
 *
 *  Paths: Lucide (github.com/lucide-icons/lucide, ISC); Telegram/WhatsApp
 *  marks: simple-icons (CC0).
 *
 *  All icons are decorative (aria-hidden): every interactive control that
 *  uses one must also carry a text/aria label. */
import type { ReactNode } from "react";

export interface IconProps {
  /** Rendered box size in px (default 18). */
  size?: number;
  className?: string;
}

function Line({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className ? `ico ${className}` : "ico"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Mark({ size = 18, className, d }: IconProps & { d: string }) {
  return (
    <svg
      className={className ? `ico ${className}` : "ico"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const paths = (...ds: string[]) => ds.map((d, i) => <path key={i} d={d} />);

export const IconSearch = (p: IconProps) => (
  <Line {...p}>
    <circle cx="11" cy="11" r="8" />
    {paths("m21 21-4.3-4.3")}
  </Line>
);
export const IconPin = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
    )}
    <circle cx="12" cy="10" r="3" />
  </Line>
);
export const IconDirections = (p: IconProps) => (
  <Line {...p}>{paths("M3 11 22 2l-9 19-2-8z")}</Line>
);
export const IconBack = (p: IconProps) => <Line {...p}>{paths("m12 19-7-7 7-7", "M19 12H5")}</Line>;
export const IconLocate = (p: IconProps) => (
  <Line {...p}>
    {paths("M2 12h3", "M19 12h3", "M12 2v3", "M12 19v3")}
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="3" />
  </Line>
);
export const IconPhone = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
    )}
  </Line>
);
export const IconShare = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
      "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    )}
  </Line>
);
export const IconClock = (p: IconProps) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="10" />
    {paths("M12 6v6l4 2")}
  </Line>
);
export const IconList = (p: IconProps) => (
  <Line {...p}>{paths("M3 6h.01", "M3 12h.01", "M3 18h.01", "M8 6h13", "M8 12h13", "M8 18h13")}</Line>
);
export const IconPlus =(p: IconProps) => <Line {...p}>{paths("M5 12h14", "M12 5v14")}</Line>;
export const IconBulb = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",
      "M9 18h6",
      "M10 22h4",
    )}
  </Line>
);
export const IconMoney = (p: IconProps) => (
  <Line {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2" />
    {paths("M6 12h.01M18 12h.01")}
  </Line>
);
export const IconMegaphone = (p: IconProps) => (
  <Line {...p}>{paths("m3 11 18-5v12L3 14v-3z", "M11.6 16.8a3 3 0 1 1-5.8-1.6")}</Line>
);
export const IconRocket = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
      "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
      "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",
      "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
    )}
  </Line>
);
export const IconGift = (p: IconProps) => (
  <Line {...p}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    {paths(
      "M12 8v13",
      "M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7",
      "M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5",
    )}
  </Line>
);
export const IconLock = (p: IconProps) => (
  <Line {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    {paths("M7 11V7a5 5 0 0 1 10 0v4")}
  </Line>
);
export const IconShield = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    )}
  </Line>
);
export const IconFlag = (p: IconProps) => (
  <Line {...p}>
    {paths("M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z", "M4 22v-7")}
  </Line>
);
export const IconLab = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2",
      "M8.5 2h7",
      "M7 16h10",
    )}
  </Line>
);
export const IconCard = (p: IconProps) => (
  <Line {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    {paths("M2 10h20")}
  </Line>
);
export const IconCalendar = (p: IconProps) => (
  <Line {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    {paths("M16 2v4", "M8 2v4", "M3 10h18")}
  </Line>
);
export const IconPencil = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      "m15 5 4 4",
    )}
  </Line>
);
export const IconBag = (p: IconProps) => (
  <Line {...p}>
    {paths("M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z", "M3 6h18", "M16 10a4 4 0 0 1-8 0")}
  </Line>
);
export const IconClose = (p: IconProps) => <Line {...p}>{paths("M18 6 6 18", "m6 6 12 12")}</Line>;
export const IconCheck = (p: IconProps) => <Line {...p}>{paths("M20 6 9 17l-5-5")}</Line>;
export const IconReject = IconClose;
export const IconBlock = (p: IconProps) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="10" />
    {paths("m4.9 4.9 14.2 14.2")}
  </Line>
);
export const IconAlert = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      "M12 9v4",
      "M12 17h.01",
    )}
  </Line>
);
/** Solid status dot ("live"); takes the success color unless restyled. */
export const IconOrb = ({ size = 18, className }: IconProps) => (
  <svg
    className={className ? `ico orb ${className}` : "ico orb"}
    viewBox="0 0 24 24"
    width={size}
    height={size}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="6" fill="currentColor" />
  </svg>
);
export const IconChevronDown = (p: IconProps) => <Line {...p}>{paths("m6 9 6 6 6-6")}</Line>;
export const IconChevronUp = (p: IconProps) => <Line {...p}>{paths("m18 15-6-6-6 6")}</Line>;
export const IconArrowLeft = IconBack;
export const IconArrowRight = (p: IconProps) => <Line {...p}>{paths("M5 12h14", "m12 5 7 7-7 7")}</Line>;
export const IconExternal = (p: IconProps) => (
  <Line {...p}>
    {paths("M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6")}
  </Line>
);
export const IconEye = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
    )}
    <circle cx="12" cy="12" r="3" />
  </Line>
);
export const IconSave = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
      "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",
      "M7 3v4a1 1 0 0 0 1 1h7",
    )}
  </Line>
);
export const IconUsers = (p: IconProps) => (
  <Line {...p}>
    {paths("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75")}
    <circle cx="9" cy="7" r="4" />
  </Line>
);
export const IconGlobe = (p: IconProps) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="10" />
    {paths("M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20")}
  </Line>
);
export const IconScale = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M12 3v18",
      "m19 8 3 8a5 5 0 0 1-6 0zV7",
      "M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1",
      "m5 8 3 8a5 5 0 0 1-6 0zV7",
      "M7 21h10",
    )}
  </Line>
);
export const IconUser = (p: IconProps) => (
  <Line {...p}>
    {paths("M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2")}
    <circle cx="12" cy="7" r="4" />
  </Line>
);
export const IconCopy = (p: IconProps) => (
  <Line {...p}>
    <rect x="8" y="8" width="14" height="14" rx="2" />
    {paths("M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2")}
  </Line>
);
export const IconPrint = (p: IconProps) => (
  <Line {...p}>
    {paths(
      "M6 9V2h12v7",
      "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",
      "M6 14h12v8H6z",
    )}
  </Line>
);

/* Brand marks (simple-icons, CC0) — solid, in the surrounding text color. */
export const IconTelegram = (p: IconProps) => (
  <Mark
    {...p}
    d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
  />
);
export const IconWhatsapp = (p: IconProps) => (
  <Mark
    {...p}
    d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
  />
);
