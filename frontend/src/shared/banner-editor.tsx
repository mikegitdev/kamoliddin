import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n";

/**
 * Dependency-free banner editor: crop (drag / handles / arrows), brightness,
 * contrast, output width and a live "as it will appear" preview. Produces a
 * re-encoded File that always satisfies the media endpoint constraints
 * (backend/apps/core/media.py: JPEG/PNG/WEBP, <= 5 MB — never upscaled).
 */

const MAX_BYTES = 5 * 1024 * 1024; // mirrors backend/apps/core/media.py
const QUALITY = 0.85;
const WIDTHS = [1280, 1600, 1920] as const;

type Aspect = "31" | "169" | "free";
type Handle = "nw" | "ne" | "se" | "sw" | "n" | "e" | "s" | "w";
type Rect = { x: number; y: number; w: number; h: number }; // normalized 0..1

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function maxFitRect(target: number, iw: number, ih: number): Rect {
  // Largest centered rect whose pixel aspect == target.
  const k = iw / (ih * target); // h = w * k
  const w = clamp(1 / Math.max(k, 1e-6), 0.02, 1);
  const h = clamp(w * k, 0.02, 1);
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

function fmtBytes(bytes: number, locale: string) {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return bytes < 1024 * 1024
    ? `${n.format(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${n.format(bytes / (1024 * 1024))} MB`;
}

type Props = {
  file: File;
  onApply: (file: File) => void;
  onClose: () => void;
};

export function BannerEditor({ file, onApply, onClose }: Props) {
  const { t, locale } = useI18n();

  const [src, setSrc] = useState<{
    url: string;
    img: ImageBitmap | HTMLImageElement;
    w: number;
    h: number;
  } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [aspect, setAspect] = useState<Aspect>("31");
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [outW, setOutW] = useState<number | "orig">("orig");
  const [preview, setPreview] = useState<string | null>(null);
  const [estBytes, setEstBytes] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  const webp = useMemo(
    () =>
      typeof document !== "undefined" &&
      document
        .createElement("canvas")
        .toDataURL("image/webp")
        .startsWith("data:image/webp"),
    []
  );

  // ---- load the picked file (EXIF-aware when supported) ------------------
  useEffect(() => {
    let url = "";
    let cancelled = false;
    setLoadError(false);
    setSrc(null);
    const done = (img: ImageBitmap | HTMLImageElement, w: number, h: number) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      setSrc({ url, img, w, h });
    };
    url = URL.createObjectURL(file);
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file, { imageOrientation: "from-image" })
        .then((bmp) => done(bmp, bmp.width, bmp.height))
        .catch(() => {
          const im = new Image();
          im.onload = () => done(im, im.naturalWidth, im.naturalHeight);
          im.onerror = () => !cancelled && setLoadError(true);
          im.src = url;
        });
    } else {
      const im = new Image();
      im.onload = () => done(im, im.naturalWidth, im.naturalHeight);
      im.onerror = () => !cancelled && setLoadError(true);
      im.src = url;
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  // Reset crop/adjustments when a new image arrives.
  useEffect(() => {
    if (!src) return;
    setRect(maxFitRect(aspect === "169" ? 16 / 9 : 3, src.w, src.h));
    setBrightness(100);
    setContrast(100);
    setOutW("orig");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const ratio = aspect === "free" ? null : aspect === "169" ? 16 / 9 : 3;
  // h = w * k in normalized coords for the locked pixel aspect.
  const k = src && ratio ? src.w / (src.h * ratio) : 1;

  const switchAspect = (next: Aspect) => {
    setAspect(next);
    if (!src) return;
    if (next === "free") return; // keep current box, just unlock
    setRect(maxFitRect(next === "169" ? 16 / 9 : 3, src.w, src.h));
  };

  // ---- pointer crop manipulation ----------------------------------------
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<false | "move" | Handle>(false);
  const drag = useRef<{
    mode: "move" | Handle;
    sx: number;
    sy: number;
    start: Rect;
    w: number;
    h: number;
  } | null>(null);

  const beginDrag = (mode: "move" | Handle) => (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (!stage || !src) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = {
      mode,
      sx: e.clientX,
      sy: e.clientY,
      start: rect,
      w: stage.clientWidth,
      h: stage.clientHeight,
    };
    setDragging(mode);
  };

  // Window-level listeners while dragging: robust for mouse, touch and pen,
  // independent of pointer capture and re-renders.
  useEffect(() => {
    if (!dragging || !src) return;
    const MIN = 0.04;
    const ratioNow = ratio;
    const kNow = k;
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.sx) / d.w;
      const dy = (e.clientY - d.sy) / d.h;
      const s = d.start;
      let { x, y, w, h } = s;

      if (d.mode === "move") {
        x = clamp(s.x + dx, 0, 1 - s.w);
        y = clamp(s.y + dy, 0, 1 - s.h);
      } else if (ratioNow === null) {
        if (d.mode.includes("e")) w = clamp(s.w + dx, MIN, 1 - s.x);
        if (d.mode.includes("s")) h = clamp(s.h + dy, MIN, 1 - s.y);
        if (d.mode.includes("w")) {
          const nx = clamp(s.x + dx, 0, s.x + s.w - MIN);
          w = s.w + (s.x - nx);
          x = nx;
        }
        if (d.mode.includes("n")) {
          const ny = clamp(s.y + dy, 0, s.y + s.h - MIN);
          h = s.h + (s.y - ny);
          y = ny;
        }
      } else {
        // aspect locked: corner handles only; h follows w (h = w * k)
        const anchorX = d.mode.includes("w") ? s.x + s.w : s.x;
        const anchorY = d.mode.includes("n") ? s.y + s.h : s.y;
        const maxW = Math.min(
          d.mode.includes("e") ? 1 - anchorX : anchorX,
          1 / Math.max(kNow, 1e-6) // keep h = w * k within [0, 1]
        );
        const nw = clamp(d.mode.includes("e") ? s.w + dx : s.w - dx, MIN, maxW);
        w = nw;
        h = clamp(nw * kNow, MIN, 1);
        if (d.mode.includes("w")) x = anchorX - nw;
        if (d.mode.includes("n")) y = anchorY - h;
        x = clamp(x, 0, 1 - w);
        y = clamp(y, 0, 1 - h);
      }
      setRect({ x, y, w, h });
    };
    const end = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging, src, ratio, k]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!src) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    let { x, y } = rect;
    if (e.key === "ArrowLeft") x = clamp(x - step, 0, 1 - rect.w);
    else if (e.key === "ArrowRight") x = clamp(x + step, 0, 1 - rect.w);
    else if (e.key === "ArrowUp") y = clamp(y - step, 0, 1 - rect.h);
    else if (e.key === "ArrowDown") y = clamp(y + step, 0, 1 - rect.h);
    else return;
    e.preventDefault();
    setRect({ ...rect, x, y });
  };

  // ---- render / encode ----------------------------------------------------
  const renderTo = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (!src) return;
      const cropW = Math.max(1, Math.round(rect.w * src.w));
      const cropH = Math.max(1, Math.round(rect.h * src.h));
      const target =
        outW === "orig" ? cropW : Math.min(outW, cropW); // never upscale
      const scale = target / cropW;
      canvas.width = Math.max(1, Math.round(cropW * scale));
      canvas.height = Math.max(1, Math.round(cropH * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff"; // flatten transparency for re-encode
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.filter = `brightness(${brightness / 100}) contrast(${contrast / 100})`;
      ctx.drawImage(
        src.img,
        Math.round(rect.x * src.w),
        Math.round(rect.y * src.h),
        cropW,
        cropH,
        0,
        0,
        canvas.width,
        canvas.height
      );
      ctx.filter = "none";
    },
    [src, rect, brightness, contrast, outW]
  );

  // Debounced preview + estimated output size.
  useEffect(() => {
    if (!src) return;
    const mime = webp ? "image/webp" : "image/jpeg";
    const id = window.setTimeout(() => {
      const c = document.createElement("canvas");
      renderTo(c);
      setPreview(c.toDataURL(mime, QUALITY));
      c.toBlob((b) => b && setEstBytes(b.size), mime, QUALITY);
    }, 180);
    return () => window.clearTimeout(id);
  }, [renderTo, src, webp]);

  const outDims = useMemo(() => {
    if (!src) return null;
    const cropW = Math.max(1, Math.round(rect.w * src.w));
    const cropH = Math.max(1, Math.round(rect.h * src.h));
    const w = outW === "orig" ? cropW : Math.min(outW, cropW);
    return { w, h: Math.max(1, Math.round((w / cropW) * cropH)) };
  }, [src, rect, outW]);

  const reset = () => {
    if (!src) return;
    setRect(maxFitRect(aspect === "169" ? 16 / 9 : 3, src.w, src.h));
    setBrightness(100);
    setContrast(100);
    setOutW("orig");
  };

  const apply = () => {
    const mime = webp ? "image/webp" : "image/jpeg";
    setApplying(true);
    const c = document.createElement("canvas");
    renderTo(c);
    c.toBlob((b) => {
      setApplying(false);
      if (!b) return;
      const name = file.name.replace(/\.[^.]+$/, "") + (webp ? ".webp" : ".jpg");
      onApply(new File([b], name, { type: b.type }));
    }, mime, QUALITY);
  };

  const tooBig = estBytes !== null && estBytes > MAX_BYTES;
  const handles: Handle[] =
    ratio === null
      ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"]
      : ["nw", "ne", "se", "sw"];

  if (loadError) {
    return (
      <div className="banner-editor">
        <p className="field-error" role="alert">
          {t.beBadFile}
        </p>
        <div className="be-actions">
          <button className="btn small" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="banner-editor" role="group" aria-label={t.beTitle}>
      <div className="be-head">
        <strong>{t.beTitle}</strong>
        <span className="muted-2">
          {file.name} · {fmtBytes(file.size, locale)}
        </span>
      </div>

      <div className="be-body">
        <div className="be-stage" ref={stageRef}>
          {src && (
            <div className="be-imgwrap">
              <img src={src.url} alt="" draggable={false} />
              <div
                className="be-crop"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
                tabIndex={0}
                role="application"
                aria-label={t.beCropA11y}
                onKeyDown={onKeyDown}
                onPointerDown={beginDrag("move")}
              >
                {handles.map((h) => (
                  <span
                    key={h}
                    className={`be-h be-h-${h}`}
                    onPointerDown={beginDrag(h)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="be-controls">
          <div className="be-row">
            <span className="be-lab">{t.beAspect}</span>
            <div className="be-seg">
              <button
                type="button"
                className="filter-chip"
                aria-pressed={aspect === "31"}
                onClick={() => switchAspect("31")}
              >
                3:1
              </button>
              <button
                type="button"
                className="filter-chip"
                aria-pressed={aspect === "169"}
                onClick={() => switchAspect("169")}
              >
                16:9
              </button>
              <button
                type="button"
                className="filter-chip"
                aria-pressed={aspect === "free"}
                onClick={() => switchAspect("free")}
              >
                {t.beAspectFree}
              </button>
            </div>
          </div>

          <div className="be-row">
            <label className="be-lab" htmlFor="be-brightness">
              {t.beBrightness}
            </label>
            <input
              id="be-brightness"
              type="range"
              min={60}
              max={140}
              step={1}
              value={brightness}
              aria-valuetext={`${brightness}%`}
              onChange={(e) => setBrightness(Number(e.target.value))}
            />
            <span className="be-val">{brightness}%</span>
          </div>

          <div className="be-row">
            <label className="be-lab" htmlFor="be-contrast">
              {t.beContrast}
            </label>
            <input
              id="be-contrast"
              type="range"
              min={60}
              max={140}
              step={1}
              value={contrast}
              aria-valuetext={`${contrast}%`}
              onChange={(e) => setContrast(Number(e.target.value))}
            />
            <span className="be-val">{contrast}%</span>
          </div>

          <div className="be-row">
            <span className="be-lab">{t.beWidth}</span>
            <div className="be-seg">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="filter-chip"
                  aria-pressed={outW === w}
                  onClick={() => setOutW(w)}
                >
                  {w}
                </button>
              ))}
              <button
                type="button"
                className="filter-chip"
                aria-pressed={outW === "orig"}
                onClick={() => setOutW("orig")}
              >
                {t.beOrigWidth}
              </button>
            </div>
          </div>

          <p className="be-meta">
            {outDims && (
              <span>
                {t.beDims}: {outDims.w} × {outDims.h} px
              </span>
            )}
            {estBytes !== null && (
              <span className={tooBig ? "field-error" : undefined}>
                {t.beSize}: ≈ {fmtBytes(estBytes, locale)} / 5 MB
              </span>
            )}
          </p>

          <div className="be-prevs">
            <figure>
              <figcaption>{t.bePrevCard}</figcaption>
              {preview && <img src={preview} alt={t.bePrevCard} />}
            </figure>
            <figure>
              <figcaption>{t.bePrevPage}</figcaption>
              {preview && <img src={preview} alt={t.bePrevPage} />}
            </figure>
          </div>
        </div>
      </div>

      <p className="field-hint">{t.beHint}</p>

      <div className="be-actions">
        <button type="button" className="btn small" onClick={reset}>
          {t.beReset}
        </button>
        <button type="button" className="btn small" onClick={onClose}>
          {t.cancel}
        </button>
        <button
          type="button"
          className="btn small"
          disabled={file.size > MAX_BYTES || applying}
          onClick={() => onApply(file)}
        >
          {t.beUseOriginal}
        </button>
        <button
          type="button"
          className="btn primary small"
          disabled={!estBytes || tooBig || applying}
          onClick={apply}
        >
          {applying ? t.loading : t.beApply}
        </button>
      </div>
    </div>
  );
}
