// Parol maydoni — ko'rsatish/yashirish tugmasi bilan.
import { useState } from "react";
import s from "./PasswordInput.module.css";

interface Props {
  id?:            string;
  value:          string;
  onChange:       (value: string) => void;
  placeholder?:   string;
  autoComplete?:  string;
  disabled?:      boolean;
  required?:      boolean;
  className?:     string;
}

export default function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete = "current-password",
  disabled = false,
  required = false,
  className,
}: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`${s.wrap} ${className ?? ""}`}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        className={s.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
      />
      <button
        type="button"
        className={s.eyeBtn}
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        disabled={disabled}
        aria-label={visible ? "Parolni yashirish" : "Parolni ko'rsatish"}
      >
        {visible ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  );
}
