import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MediaPayload } from "@/crypto/fileCrypto";
import { formatFileSize } from "@/crypto/fileCrypto";
import { loadDecryptedMedia } from "@/utils/mediaLoader";
import { useRegisterBackHandler, BACK_PRIORITY } from "@/contexts/BackNavigationContext";
import s from "./ImageViewer.module.css";

export interface ViewerMedia {
  messageId: string;
  payload:   MediaPayload;
  kind:      "image" | "video";
}

/** @deprecated ViewerMedia ishlating */
export type ViewerImage = ViewerMedia;

interface Props {
  items:            ViewerMedia[];
  /** @deprecated items ishlating */
  images?:            ViewerMedia[];
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

export default function ImageViewer({ items, images, initialMessageId, token, onClose }: Props) {
  const mediaItems = items ?? images ?? [];
  const startIndex = Math.max(0, mediaItems.findIndex((i) => i.messageId === initialMessageId));
  const [index, setIndex] = useState(startIndex);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [scale, setScale]   = useState(MIN_SCALE);
  const [panX, setPanX]     = useState(0);
  const [panY, setPanY]     = useState(0);
  const [panning, setPanning] = useState(false);

  const cacheRef      = useRef<Map<string, string>>(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);
  const stageRef      = useRef<HTMLDivElement>(null);
  const thumbStripRef = useRef<HTMLDivElement>(null);
  const videoRef      = useRef<HTMLVideoElement>(null);
  const pointerRef    = useRef({ x: 0, y: 0 });
  const dragRef       = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const zoomStateRef  = useRef({ scale: MIN_SCALE, panX: 0, panY: 0 });

  const current = mediaItems[index];
  const isVideo = current?.kind === "video";

  zoomStateRef.current = { scale, panX, panY };

  const resetZoom = useCallback(() => {
    setScale(MIN_SCALE);
    setPanX(0);
    setPanY(0);
  }, []);

  const handleEscapeBack = useCallback(() => {
    onClose();
    return true;
  }, [onClose]);
  useRegisterBackHandler(handleEscapeBack, true, BACK_PRIORITY.imageViewer);

  useEffect(() => {
    const i = mediaItems.findIndex((img) => img.messageId === initialMessageId);
    if (i >= 0) setIndex(i);
  }, [initialMessageId, mediaItems]);

  // Album / guruh media oldindan yuklash (thumbnail strip)
  useEffect(() => {
    if (mediaItems.length <= 1) return;
    let cancelled = false;
    for (const item of mediaItems) {
      if (cacheRef.current.has(item.messageId)) continue;
      loadDecryptedMedia(token, item.payload)
        .then((blob) => {
          if (cancelled) return;
          cacheRef.current.set(item.messageId, URL.createObjectURL(blob));
          setCacheVersion((v) => v + 1);
        })
        .catch(() => { /* placeholder */ });
    }
    return () => { cancelled = true; };
  }, [mediaItems, token]);

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

  useEffect(() => {
    if (mediaItems.length <= 1) return;
    const strip = thumbStripRef.current;
    if (!strip) return;
    const active = strip.querySelector(`.${s.thumbActive}`) as HTMLElement | null;
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index, mediaItems.length]);

  useEffect(() => {
    videoRef.current?.pause();
  }, [index]);

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
        setCacheVersion((v) => v + 1);
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
    setIndex((i) => Math.min(mediaItems.length - 1, i + 1));
  }, [mediaItems.length]);

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
      if (isVideo) return;
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
  }, [loadState.status, applyZoom, trackPointer, isVideo]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (isVideo) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if (loadState.status !== "ready" || scale <= MIN_SCALE) return;
    if (e.button !== 0) return;
    trackPointer(e.clientX, e.clientY);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX, panY };
    setPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [loadState.status, scale, panX, panY, trackPointer, isVideo]);

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

  // Klaviatura: ← →, Ctrl + +/-
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && (e.key === "+" || e.key === "=" || e.key === "-")) {
        e.preventDefault();
        e.stopPropagation();
        if (loadState.status !== "ready" || isVideo) return;
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
  const hasNext = index < mediaItems.length - 1;
  const zoomed  = !isVideo && scale > MIN_SCALE;
  void cacheVersion;

  return createPortal(
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label="Media ko'rish">
      <div className={s.toolbar}>
        <span className={s.title} title={current.payload.file_name}>
          {current.payload.file_name}
        </span>
        {mediaItems.length > 1 && (
          <span className={s.counter}>
            {index + 1} / {mediaItems.length}
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
          title="Saqlash"
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
        className={`${s.stage} ${zoomed ? s.stageZoomed : ""} ${panning ? s.stagePanning : ""} ${isVideo ? s.stageVideo : ""}`}
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
          aria-label="Oldingi"
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
            <span>{isVideo ? "Videoni ochib bo'lmadi" : "Rasmni ochib bo'lmadi"}</span>
            <span>{loadState.message}</span>
          </div>
        )}

        {loadState.status === "ready" && isVideo && (
          <div className={s.videoWrap}>
            <video
              ref={videoRef}
              key={current.messageId}
              src={loadState.objectUrl}
              className={s.video}
              controls
              autoPlay
              playsInline
              title={`${current.payload.file_name} (${formatFileSize(current.payload.size)})`}
            />
          </div>
        )}

        {loadState.status === "ready" && !isVideo && (
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
          aria-label="Keyingi"
          title="Keyingi"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {mediaItems.length > 1 && (
        <div className={s.thumbStrip}>
          <div className={s.thumbScroll} ref={thumbStripRef}>
            {mediaItems.map((item, i) => {
              const thumbUrl = cacheRef.current.get(item.messageId);
              return (
                <button
                  key={item.messageId}
                  type="button"
                  className={`${s.thumb} ${i === index ? s.thumbActive : ""}`}
                  onClick={() => setIndex(i)}
                  aria-label={`${item.kind === "video" ? "Video" : "Rasm"} ${i + 1}`}
                  title={item.payload.file_name}
                >
                  {thumbUrl ? (
                    item.kind === "video" ? (
                      <span className={s.thumbVideoWrap}>
                        <video
                          src={thumbUrl}
                          className={s.thumbImg}
                          muted
                          playsInline
                          preload="metadata"
                        />
                        <span className={s.thumbPlay} aria-hidden>▶</span>
                      </span>
                    ) : (
                      <img src={thumbUrl} alt="" className={s.thumbImg} draggable={false} />
                    )
                  ) : (
                    <span className={s.thumbPlaceholder}>
                      {item.kind === "video" ? "▶" : ""}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

