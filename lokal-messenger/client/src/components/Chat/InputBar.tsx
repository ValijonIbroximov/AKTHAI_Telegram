// Xabar kiritish paneli — Telegram Desktop uslubi.

// Enter → yuborish, Shift+Enter → yangi qator.

// 📎 / Ctrl+V → AttachmentModal orqali tasdiqlash.

import { useState, useRef, useCallback, useEffect, KeyboardEvent, ClipboardEvent } from "react";

import { useChatStore } from "@/store/chatStore";

import AttachmentModal, { type AttachmentSendOptions } from "./AttachmentModal";

import s from "./InputBar.module.css";



interface Props { chatId: string; recipientId: string; token: string; }



const IMAGE_VIDEO_TYPES = "image/*,video/*";
/** Har qanday fayl turi (ps1, exe, json va hokazo) */
const ANY_FILE = "*/*";



interface AttachOption {

  icon:   React.ReactNode;

  label:  string;

  accept: string;

}



const ATTACH_OPTIONS: AttachOption[] = [

  {

    label:  "Rasm yoki video",

    accept: IMAGE_VIDEO_TYPES,

    icon: (

      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">

        <rect x="3" y="3" width="18" height="18" rx="2"/>

        <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>

        <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round"/>

      </svg>

    ),

  },

  {

    label:  "Fayl",

    accept: ANY_FILE,

    icon: (

      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">

        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinejoin="round"/>

        <polyline points="14 2 14 8 20 8" strokeLinejoin="round"/>

        <line x1="16" y1="13" x2="8" y2="13" strokeLinecap="round"/>

        <line x1="16" y1="17" x2="8" y2="17" strokeLinecap="round"/>

        <polyline points="10 9 9 9 8 9" strokeLinecap="round"/>

      </svg>

    ),

  },

  {

    label:  "Joylashuv",

    accept: "",

    icon: (

      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">

        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z" strokeLinejoin="round"/>

        <circle cx="12" cy="10" r="3"/>

      </svg>

    ),

  },

];



export default function InputBar({ chatId, recipientId }: Props) {

  const [text, setText]             = useState("");

  const [uploading, setUploading]   = useState(false);

  const [attachOpen, setAttachOpen] = useState(false);

  const [modalOpen, setModalOpen]   = useState(false);

  const [seedFiles, setSeedFiles]   = useState<File[]>([]);

  const [fileAccept, setFileAccept] = useState("*/*");



  const ref     = useRef<HTMLTextAreaElement>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const { sendMessage, sendFileMessages } = useChatStore();



  const getToken = async () => {

    const { token } = (await import("@/store/authStore")).useAuthStore.getState();

    return token ?? "";

  };



  const openAttachmentModal = useCallback((files: File[]) => {

    if (files.length === 0) return;

    setSeedFiles(files);

    setModalOpen(true);

    setAttachOpen(false);

  }, []);



  const closeAttachmentModal = useCallback(() => {

    setModalOpen(false);

    setSeedFiles([]);

    setUploading(false);

  }, []);



  useEffect(() => {

    if (!attachOpen) return;

    const handler = (e: MouseEvent) => {

      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {

        setAttachOpen(false);

      }

    };

    document.addEventListener("mousedown", handler);

    return () => document.removeEventListener("mousedown", handler);

  }, [attachOpen]);



  const send = async () => {

    const t = text.trim();

    if (!t) return;

    setText("");

    if (ref.current) ref.current.style.height = "auto";

    await sendMessage(chatId, recipientId, t, await getToken());

  };



  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {

    if (e.key === "Enter" && !e.shiftKey) {

      e.preventDefault();

      void send();

    }

  };



  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {

    const files = e.clipboardData?.files;

    if (files && files.length > 0) {

      e.preventDefault();

      openAttachmentModal(Array.from(files));

    }

  };



  const onInput = () => {

    const el = ref.current;

    if (!el) return;

    el.style.height = "auto";

    el.style.height = Math.min(el.scrollHeight, 120) + "px";

  };



  const openFilePicker = useCallback((accept: string) => {

    if (!accept || uploading) return;

    setAttachOpen(false);

    setFileAccept(accept);

    if (fileRef.current) {

      fileRef.current.accept = accept;

      fileRef.current.click();

    }

  }, [uploading]);



  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {

    const list = Array.from(e.target.files ?? []);

    e.target.value = "";

    if (list.length === 0) return;

    openAttachmentModal(list);

  }, [openAttachmentModal]);



  const handleModalSend = useCallback(async (opts: AttachmentSendOptions) => {

    if (opts.items.length === 0) return;

    setUploading(true);

    try {

      await sendFileMessages(

        chatId,

        recipientId,

        opts.items.map((it) => ({ file: it.file, spoiler: it.spoiler })),

        await getToken(),

        { caption: opts.caption, asDocument: opts.asDocument },

      );

      closeAttachmentModal();

    } finally {

      setUploading(false);

    }

  }, [chatId, recipientId, sendFileMessages, closeAttachmentModal]);



  const hasText = text.trim().length > 0;



  return (

    <div className={s.root}>

      <input

        ref={fileRef}

        type="file"

        style={{ display: "none" }}

        accept={fileAccept}

        multiple

        onChange={onFileChange}

      />



      <AttachmentModal

        open={modalOpen}

        seedFiles={seedFiles}

        sending={uploading}

        onClose={closeAttachmentModal}

        onSend={(opts) => void handleModalSend(opts)}

      />



      <div className={s.attachWrap} ref={menuRef}>

        {attachOpen && (

          <div className={s.attachMenu}>

            {ATTACH_OPTIONS.map((opt) => (

              <button

                key={opt.label}

                type="button"

                className={s.attachOption}

                onClick={() => openFilePicker(opt.accept)}

                disabled={!opt.accept}

              >

                <span className={s.attachOptionIcon}>{opt.icon}</span>

                <span className={s.attachOptionLabel}>{opt.label}</span>

              </button>

            ))}

          </div>

        )}



        <button

          className={`${s.sideBtn} ${uploading ? s.sideBtnLoading : ""} ${attachOpen ? s.sideBtnActive : ""}`}

          onClick={() => !uploading && setAttachOpen((v) => !v)}

          disabled={uploading}

          aria-label={uploading ? "Yuklanmoqda..." : "Biriktirish"}

          title={uploading ? "Yuklanmoqda..." : "Fayl biriktirish"}

        >

          {uploading ? (

            <svg

              width="20" height="20" viewBox="0 0 24 24" fill="none"

              stroke="currentColor" strokeWidth="2"

              className={s.spinner}

            >

              <circle cx="12" cy="12" r="9" strokeDasharray="56" strokeDashoffset="14"/>

            </svg>

          ) : (

            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"

                 stroke="currentColor" strokeWidth="1.7">

              <path

                d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"

                strokeLinecap="round" strokeLinejoin="round"

              />

            </svg>

          )}

        </button>

      </div>



      <div className={s.inputWrap}>

        <textarea

          ref={ref}

          className={s.textarea}

          placeholder="Xabar yozing..."

          value={text}

          onChange={e => setText(e.target.value)}

          onInput={onInput}

          onKeyDown={onKey}

          onPaste={onPaste}

          rows={1}

          maxLength={4096}

        />

      </div>



      <button

        className={`${s.sendBtn} ${hasText ? s.sendActive : s.micActive}`}

        onClick={hasText ? () => void send() : undefined}

        disabled={!hasText}

        aria-label={hasText ? "Yuborish" : "Ovozli xabar"}

      >

        {hasText ? (

          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">

            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>

          </svg>

        ) : (

          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"

               stroke="currentColor" strokeWidth="1.8">

            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" strokeLinecap="round"/>

            <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" strokeLinecap="round"/>

          </svg>

        )}

      </button>

    </div>

  );

}


