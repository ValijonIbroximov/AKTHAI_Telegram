import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MediaPayload } from "@/crypto/fileCrypto";
import { formatFileSize } from "@/crypto/fileCrypto";
import { loadDecryptedMedia } from "@/utils/mediaLoader";
import s from "./ImageViewer.module.css";

export interface ViewerImage {
  messageId: string;
  payload:   MediaPayload;
}

interface Props {
  images:           ViewerImage[];
  initialMessageId: string;
  token:            string;
  onClose:          () => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; objectUrl: string }
  | { status: "error"; message: string };

const MIN_SCALE    = 1;
const MAX_SCALE    = 8;
const ZOOM_FACTOR  = 1.12;

function clampScale(v: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
}

/** Sichqoncha nuqtasi ostida qoladigan zoom + pan */
function zoomAtPoint(
  scale: number,
  panX: number,
  panY: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
  factor: number,
): { scale: number; panX: number; panY: number } {
  const newScale = clampScale(scale * factor);
  if (newScale === scale) return { scale, panX, panY };

  const localX = (px - cx - panX) / scale;
  const localY = (py - cy - panY) / scale;

  let newPanX = px - cx - localX * newScale;
  let newPanY = py - cy - localY * newScale;

  if (newScale <= MIN_SCALE) {
    newPanX = 0;
    newPanY = 0;
  }

  return { scale: newScale, panX: newPanX, panY: newPanY };
}

export default function ImageViewer({ images, initialMessageId, token, onClose }: Props) {
  const startIndex = Math.max(0, images.findIndex((i) => i.messageId === initialMessageId));
  const [index, setIndex] = useState(startIndex);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [scale, setScale]   = useState(MIN_SCALE);
  const [panX, setPanX]     = useState(0);
  const [panY, setPanY]     = useState(0);
  const [panning, setPanning] = useState(false);

  const cacheRef      = useRef<Map<string, string>>(new Map());
  const stageRef      = useRef<HTMLDivElement>(null);
  const pointerRef    = useRef({ x: 0, y: 0 });
  const dragRef       = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const zoomStateRef  = useRef({ scale: MIN_SCALE, panX: 0, panY: 0 });

  const current = images[index];

  zoomStateRef.current = { scale, panX, panY };

  const resetZoom = useCallback(() => {
    setScale(MIN_SCALE);
    setPanX(0);
    setPanY(0);
  }, []);

  const applyZoom = useCallback((px: number, py: number, factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const mx = px - rect.left;
    const my = py - rect.top;

    const next = zoomAtPoint(
      zoomStateRef.current.scale,
      zoomStateRef.current.panX,
      zoomStateRef.current.panY,
      cx, cy, mx, my, factor,
    );
    setScale(next.scale);
    setPanX(next.panX);
    setPanY(next.panY);
  }, []);

  // Cache tozalash (unmount)
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  // Rasm almashganda zoom qayta tiklanadi
  useEffect(() => {
    resetZoom();
  }, [index, resetZoom]);

  // Joriy rasmni yuklash
  useEffect(() => {
    if (!current) return;

    let cancelled = false;
    const cached = cacheRef.current.get(current.messageId);
    if (cached) {
      setLoadState({ status: "ready", objectUrl: cached });
      return;
    }

    setLoadState({ status: "loading" });

    loadDecryptedMedia(token, current.payload)
      .then((blob) => {
        if (cancelled) return;
        const objUrl = URL.createObjectURL(blob);
        cacheRef.current.set(current.messageId, objUrl);
        setLoadState({ status: "ready", objectUrl: objUrl });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadState({
          status:  "error",
          message: e instanceof Error ? e.message : "Yuklab bo'lmadi",
        });
      });

    return () => { cancelled = true; };
  }, [current, token]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(images.length - 1, i + 1));
  }, [images.length]);

  const handleSave = useCallback(() => {
    if (loadState.status !== "ready" || !current) return;
    const a = document.createElement("a");
    a.href     = loadState.objectUrl;
    a.download = current.payload.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [loadState, current]);

  const trackPointer = useCallback((clientX: number, clientY: number) => {
    pointerRef.current = { x: clientX, y: clientY };
  }, []);

  // Ctrl + g'ildirak — brauzer zoom emas, rasm zoom
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (loadState.status !== "ready") return;
      e.preventDefault();
      e.stopPropagation();
      trackPointer(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      applyZoom(e.clientX, e.clientY, factor);
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [loadState.status, applyZoom, trackPointer]);

  // Zoom qilinganda sudrab ko'chirish (nav tugmalari bundan mustasno)
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (loadState.status !== "ready" || scale <= MIN_SCALE) return;
    if (e.button !== 0) return;
    trackPointer(e.clientX, e.clientY);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX, panY };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [loadState.status, scale, panX, panY, trackPointer]);

  const stopNavPointer = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    trackPointer(e.clientX, e.clientY);
    const drag = dragRef.current;
    if (!drag) return;
    setPanX(drag.panX + (e.clientX - drag.startX));
    setPanY(drag.panY + (e.clientY - drag.startY));
  }, [trackPointer]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    setPanning(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
  }, []);

  // Klaviatura: Escape, ← →, Ctrl + +/-
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      const mod = e.ctrlKey || e.metaKey;

      if (mod && (e.key === "+" || e.key === "=" || e.key === "-")) {
        e.preventDefault();
        e.stopPropagation();
        if (loadState.status !== "ready") return;
        const factor = (e.key === "-") ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
        const { x, y } = pointerRef.current;
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.getBoundingClientRect();
          const px = rect.left + rect.width / 2;
          const py = rect.top + rect.height / 2;
          applyZoom(x || px, y || py, factor);
        }
        return;
      }

      if (mod) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext, loadState.status, applyZoom]);

  if (!current) return null;

  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;
  const zoomed  = scale > MIN_SCALE;

  return createPortal(
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label="Rasm ko'rish">
      <div className={s.toolbar}>
        <span className={s.title} title={current.payload.file_name}>
          {current.payload.file_name}
        </span>
        {images.length > 1 && (
          <span className={s.counter}>
            {index + 1} / {images.length}
          </span>
        )}
        {zoomed && (
          <span className={s.zoomLevel}>{Math.round(scale * 100)}%</span>
        )}
        <div className={s.toolbarSpacer} />
        {zoomed && (
          <button
            type="button"
            className={`${s.btn} ${s.btnReset}`}
            onClick={resetZoom}
            title="Masshtabni tiklash"
            aria-label="Masshtabni tiklash"
          >
            100%
          </button>
        )}
        <button
          type="button"
          className={`${s.btn} ${s.btnSave}`}
          onClick={handleSave}
          disabled={loadState.status !== "ready"}
          title="Saqlash (Ctrl+scroll — zoom)"
          aria-label="Saqlash"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round"/>
          </svg>
          Saqlash
        </button>
        <button
          type="button"
          className={s.btn}
          onClick={onClose}
          title="Yopish"
          aria-label="Yopish"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round"/>
            <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div
        ref={stageRef}
        className={`${s.stage} ${zoomed ? s.stageZoomed : ""} ${panning ? s.stagePanning : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseMove={(e) => trackPointer(e.clientX, e.clientY)}
      >
        <button
          type="button"
          className={`${s.nav} ${s.navPrev}`}
          onClick={goPrev}
          onPointerDown={stopNavPointer}
          disabled={!hasPrev}
          aria-label="Oldingi rasm"
          title="Oldingi"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {loadState.status === "loading" && (
          <div className={s.loading}>
            <div className={s.spinner} />
            <span>Yuklanmoqda…</span>
          </div>
        )}

        {loadState.status === "error" && (
          <div className={s.error}>
            <span>Rasmni ochib bo'lmadi</span>
            <span>{loadState.message}</span>
          </div>
        )}

        {loadState.status === "ready" && (
          <div
            className={s.imageWrap}
            style={{
              transform: `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${scale})`,
            }}
          >
            <img
              src={loadState.objectUrl}
              alt={current.payload.file_name}
              className={s.image}
              draggable={false}
              title={`${current.payload.file_name} (${formatFileSize(current.payload.size)})`}
            />
          </div>
        )}

        <button
          type="button"
          className={`${s.nav} ${s.navNext}`}
          onClick={goNext}
          onPointerDown={stopNavPointer}
          disabled={!hasNext}
          aria-label="Keyingi rasm"
          title="Keyingi"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}

