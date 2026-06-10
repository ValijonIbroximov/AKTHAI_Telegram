/**

 * Biriktirma tasdiqlash modali — Telegram Desktop uslubi.

 * Bir nechta fayl qo'shish va guruh sifatida yuborish.

 * Created by Valijon Ibroximov

 */

import {

  useCallback, useEffect, useMemo, useRef, useState,

} from "react";

import { createPortal } from "react-dom";

import { formatFileSize } from "@/crypto/fileCrypto";

import s from "./AttachmentModal.module.css";



export type AttachmentKind = "image" | "video" | "file";



export interface AttachmentItem {

  id:      string;

  file:    File;

  spoiler: boolean;

}



export interface AttachmentSendOptions {

  items:       AttachmentItem[];

  caption:     string;

  asDocument:  boolean;

}



interface Props {

  seedFiles:     File[];

  open:          boolean;

  sending?:      boolean;

  onClose:       () => void;

  onSend:        (opts: AttachmentSendOptions) => void;

}



function newItem(file: File): AttachmentItem {

  return { id: crypto.randomUUID(), file, spoiler: false };

}



function detectKind(file: File): AttachmentKind {

  if (file.type.startsWith("image/")) return "image";

  if (file.type.startsWith("video/")) return "video";

  return "file";

}



function headerTitle(items: AttachmentItem[], active: AttachmentItem): string {

  if (items.length > 1) {

    const images = items.filter((i) => detectKind(i.file) === "image").length;

    const videos = items.filter((i) => detectKind(i.file) === "video").length;

    if (images === items.length) return `Send ${items.length} photos`;

    if (videos === items.length) return `Send ${items.length} videos`;

    return `Send ${items.length} files`;

  }

  const kind = detectKind(active.file);

  if (kind === "image") return "Send an image";

  if (kind === "video") return "Send a video";

  return "Send a file";

}



const PREVIEW_MENU = [

  { id: "replace", label: "Replace attachment" },

  { id: "edit",    label: "Edit Image" },

  { id: "spoiler", label: "Hide with Spoiler" },

] as const;



export default function AttachmentModal({

  seedFiles, open, sending = false, onClose, onSend,

}: Props) {

  const [items, setItems]               = useState<AttachmentItem[]>([]);

  const [activeIndex, setActiveIndex]   = useState(0);

  const [caption, setCaption]             = useState("");

  const [asDocument, setAsDocument]       = useState(false);

  const [headerMenu, setHeaderMenu]       = useState(false);

  const [previewMenu, setPreviewMenu]     = useState(false);

  const [previewUrl, setPreviewUrl]       = useState<string | null>(null);

  const [thumbUrls, setThumbUrls]         = useState<Map<string, string>>(new Map());



  const captionRef     = useRef<HTMLTextAreaElement>(null);

  const replaceRef     = useRef<HTMLInputElement>(null);

  const addRef         = useRef<HTMLInputElement>(null);

  const headerMenuRef  = useRef<HTMLDivElement>(null);

  const previewMenuRef = useRef<HTMLDivElement>(null);



  const active = items[activeIndex] ?? items[0];

  const kind = active ? detectKind(active.file) : "file";

  const isVisual = kind === "image" || kind === "video";

  const showAsDocCheckbox = kind === "image" || kind === "video";



  useEffect(() => {

    if (!open) {

      setCaption("");

      setAsDocument(false);

      setHeaderMenu(false);

      setPreviewMenu(false);

      return;

    }

    if (seedFiles.length > 0) {

      setItems(seedFiles.map(newItem));

      setActiveIndex(0);

    }

  }, [open, seedFiles]);



  useEffect(() => {

    if (!active || !isVisual) {

      setPreviewUrl(null);

      return;

    }

    const url = URL.createObjectURL(active.file);

    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);

  }, [active, isVisual]);



  useEffect(() => {

    const map = new Map<string, string>();

    for (const item of items) {

      if (item.file.type.startsWith("image/")) {

        map.set(item.id, URL.createObjectURL(item.file));

      }

    }

    setThumbUrls(map);

    return () => {

      for (const url of map.values()) URL.revokeObjectURL(url);

    };

  }, [items]);



  useEffect(() => {

    if (!open) return;

    const onKey = (e: KeyboardEvent) => {

      if (e.key === "Escape") onClose();

    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);

  }, [open, onClose]);



  useEffect(() => {

    if (!open) return;

    const prev = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => { document.body.style.overflow = prev; };

  }, [open]);



  useEffect(() => {

    if (!headerMenu && !previewMenu) return;

    const close = (e: MouseEvent) => {

      const t = e.target as Node;

      if (headerMenuRef.current?.contains(t) || previewMenuRef.current?.contains(t)) return;

      setHeaderMenu(false);

      setPreviewMenu(false);

    };

    document.addEventListener("mousedown", close);

    return () => document.removeEventListener("mousedown", close);

  }, [headerMenu, previewMenu]);



  const updateActiveSpoiler = useCallback((value: boolean) => {

    if (!active) return;

    setItems((prev) => prev.map((it) =>

      it.id === active.id ? { ...it, spoiler: value } : it

    ));

  }, [active]);



  const handlePreviewMenu = useCallback((id: string) => {

    setPreviewMenu(false);

    if (id === "replace") replaceRef.current?.click();

    if (id === "edit") window.alert("Edit Image — tez orada");

    if (id === "spoiler") updateActiveSpoiler(!active?.spoiler);

  }, [active?.spoiler, updateActiveSpoiler]);



  const removeItem = useCallback((id: string) => {

    setItems((prev) => {

      if (prev.length <= 1) {

        onClose();

        return prev;

      }

      const next = prev.filter((it) => it.id !== id);

      setActiveIndex((idx) => Math.min(idx, next.length - 1));

      return next;

    });

  }, [onClose]);



  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>, mode: "replace" | "add") => {

    const picked = mode === "add"

      ? Array.from(e.target.files ?? [])

      : e.target.files?.[0] ? [e.target.files[0]] : [];

    e.target.value = "";

    if (picked.length === 0) return;



    if (mode === "replace" && active) {

      setItems((prev) => prev.map((it) =>

        it.id === active.id ? { ...it, file: picked[0]!, spoiler: false } : it

      ));

      return;

    }



    const added = picked.map(newItem);

    setItems((prev) => {

      const next = [...prev, ...added];

      setActiveIndex(next.length - 1);

      return next;

    });

  };



  const insertEmoji = () => {

    const el = captionRef.current;

    if (!el) return;

    const emoji = "😊";

    const start = el.selectionStart ?? caption.length;

    const next = caption.slice(0, start) + emoji + caption.slice(start);

    setCaption(next);

    requestAnimationFrame(() => {

      el.focus();

      el.selectionStart = el.selectionEnd = start + emoji.length;

    });

  };



  const handleSend = () => {

    if (items.length === 0) return;

    onSend({ items, caption: caption.trim(), asDocument });

  };



  const title = useMemo(

    () => (active ? headerTitle(items, active) : "Send a file"),

    [items, active],

  );



  if (!open || !active) return null;



  return createPortal(

    <div className={s.overlay} onClick={onClose} role="presentation">

      <div

        className={s.modal}

        onClick={(e) => e.stopPropagation()}

        role="dialog"

        aria-modal="true"

        aria-labelledby="attach-modal-title"

      >

        <div className={s.header}>

          <h2 id="attach-modal-title" className={s.title}>{title}</h2>

          <div className={s.menuWrap} ref={headerMenuRef}>

            <button

              type="button"

              className={s.iconBtn}

              aria-label="Menu"

              onClick={() => { setHeaderMenu((v) => !v); setPreviewMenu(false); }}

            >

              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">

                <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>

              </svg>

            </button>

            {headerMenu && (

              <div className={s.dropdown}>

                <button type="button" className={s.dropdownItem} onClick={() => replaceRef.current?.click()}>

                  Replace attachment

                </button>

                <button type="button" className={s.dropdownItem} onClick={() => setAsDocument((v) => !v)}>

                  {asDocument ? "✓ Send as a document" : "Send as a document"}

                </button>

              </div>

            )}

          </div>

        </div>



        <div

          className={s.previewWrap}

          onClick={() => {

            if (kind === "image") window.alert("Edit Image — tez orada");

          }}

          title={kind === "image" ? "Left-click on the photo to edit" : undefined}

        >

          <div className={s.previewControls}>

            <button

              type="button"

              className={s.previewControlBtn}

              aria-label="Remove attachment"

              onClick={(e) => { e.stopPropagation(); removeItem(active.id); }}

            >

              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">

                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>

              </svg>

            </button>

            <div className={s.previewMenuWrap} ref={previewMenuRef}>

              <button

                type="button"

                className={s.previewControlBtn}

                aria-label="Preview options"

                onClick={(e) => { e.stopPropagation(); setPreviewMenu((v) => !v); setHeaderMenu(false); }}

              >

                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">

                  <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>

                </svg>

              </button>

              {previewMenu && (

                <div className={s.dropdown}>

                  {PREVIEW_MENU.map((item) => (

                    <button

                      key={item.id}

                      type="button"

                      className={`${s.dropdownItem} ${item.id === "spoiler" && active.spoiler ? s.dropdownItemActive : ""}`}

                      onClick={(e) => { e.stopPropagation(); handlePreviewMenu(item.id); }}

                    >

                      {item.id === "spoiler" && active.spoiler ? "✓ " : ""}{item.label}

                    </button>

                  ))}

                </div>

              )}

            </div>

          </div>



          {kind === "image" && previewUrl && (

            <img

              src={previewUrl}

              alt={active.file.name}

              className={`${s.previewImg} ${active.spoiler ? s.previewSpoiler : ""}`}

              draggable={false}

            />

          )}

          {kind === "video" && previewUrl && (

            <video

              src={previewUrl}

              className={`${s.previewVideo} ${active.spoiler ? s.previewSpoiler : ""}`}

              controls

              muted

            />

          )}

          {kind === "file" && (

            <div className={s.previewDoc}>

              <div className={s.docIcon}>

                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">

                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinejoin="round"/>

                  <polyline points="14 2 14 8 20 8"/>

                </svg>

              </div>

              <div className={s.docName}>{active.file.name}</div>

              <div className={s.docSize}>{formatFileSize(active.file.size)}</div>

            </div>

          )}

        </div>



        {items.length > 0 && (

          <div className={s.thumbStrip}>

            {items.map((item, idx) => {

              const k = detectKind(item.file);

              const thumb = thumbUrls.get(item.id);

              return (

                <button

                  key={item.id}

                  type="button"

                  className={`${s.thumb} ${idx === activeIndex ? s.thumbActive : ""}`}

                  onClick={() => setActiveIndex(idx)}

                  title={item.file.name}

                >

                  {thumb ? (

                    <img src={thumb} alt="" className={s.thumbImg} draggable={false} />

                  ) : (

                    <span className={s.thumbIcon}>

                      {k === "video" ? "▶" : k === "image" ? "🖼" : "📎"}

                    </span>

                  )}

                  {item.spoiler && <span className={s.thumbSpoiler} />}

                </button>

              );

            })}

            <button

              type="button"

              className={s.thumbAdd}

              onClick={() => addRef.current?.click()}

              disabled={sending}

              aria-label="Add attachment"

              title="Add"

            >

              +

            </button>

          </div>

        )}



        <div className={s.footer}>

          {kind === "image" && (

            <p className={s.hint}>Left-click on the photo to edit</p>

          )}



          {showAsDocCheckbox && (

            <label className={s.checkRow}>

              <input

                type="checkbox"

                checked={asDocument}

                onChange={(e) => setAsDocument(e.target.checked)}

              />

              Send as a document

            </label>

          )}



          <div className={s.captionWrap}>

            <textarea

              ref={captionRef}

              className={s.captionInput}

              placeholder="Caption"

              value={caption}

              onChange={(e) => setCaption(e.target.value)}

              rows={2}

              maxLength={1024}

            />

            <button type="button" className={s.emojiBtn} aria-label="Emoji" onClick={insertEmoji}>

              😊

            </button>

          </div>



          <div className={s.actions}>

            <button type="button" className={s.btnAdd} onClick={() => addRef.current?.click()} disabled={sending}>

              Add

            </button>

            <div className={s.spacer} />

            <button type="button" className={s.btnCancel} onClick={onClose} disabled={sending}>

              Cancel

            </button>

            <button type="button" className={s.btnSend} onClick={handleSend} disabled={sending || items.length === 0}>

              {sending ? "Sending…" : items.length > 1 ? `Send ${items.length}` : "Send"}

            </button>

          </div>



          <p className={s.author}>Created by Valijon Ibroximov</p>

        </div>



        <input ref={replaceRef} type="file" hidden accept="*/*" onChange={(e) => onFilePicked(e, "replace")} />

        <input ref={addRef} type="file" hidden multiple accept="*/*" onChange={(e) => onFilePicked(e, "add")} />

      </div>

    </div>,

    document.body,

  );

}


