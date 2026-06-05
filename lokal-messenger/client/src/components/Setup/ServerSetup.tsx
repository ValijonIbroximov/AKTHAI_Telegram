import { useState } from "react";
import { setServerUrl } from "@/config/serverConfig";
import styles from "./ServerSetup.module.css";

interface Props {
  onDone: () => void;
}

export default function ServerSetup({ onDone }: Props) {
  const [ip, setIp]       = useState("");
  const [port, setPort]   = useState("8443");
  const [proto, setProto] = useState("https");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = ip.trim();
    if (!trimmed) { setError("IP manzil kiritilmagan"); return; }
    const url = `${proto}://${trimmed}:${port}`;
    setServerUrl(url);
    onDone();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.icon}>🛡</div>
          <h2 className={styles.title}>Server manzilini sozlash</h2>
          <p className={styles.subtitle}>
            Harbiy messenjer serverining LAN IP manzilini kiriting
          </p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.row}>
            <label className={styles.label}>Protokol</label>
            <select
              className={styles.select}
              value={proto}
              onChange={(e) => setProto(e.target.value)}
            >
              <option value="https">HTTPS (TLS)</option>
              <option value="http">HTTP</option>
            </select>
          </div>

          <div className={styles.row}>
            <label className={styles.label}>Server IP manzili</label>
            <input
              className={styles.input}
              type="text"
              placeholder="192.168.1.100"
              value={ip}
              onChange={(e) => { setIp(e.target.value); setError(""); }}
              autoFocus
              spellCheck={false}
            />
          </div>

          <div className={styles.row}>
            <label className={styles.label}>Port</label>
            <input
              className={styles.input}
              type="number"
              placeholder="8443"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min={1}
              max={65535}
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.preview}>
            <span className={styles.previewLabel}>URL:</span>
            <code className={styles.previewUrl}>
              {proto}://{ip || "..."} :{port}
            </code>
          </div>

          <button type="submit" className={styles.btn}>
            Saqlash va davom etish
          </button>
        </form>
      </div>
    </div>
  );
}
