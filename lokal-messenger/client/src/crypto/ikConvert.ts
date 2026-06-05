// Identity Key (Ed25519 ↔ X25519) konvertatsiyasi — brauzer/Tauri o'rtasida X3DH mosligi uchun.
import { ed25519 } from "@noble/curves/ed25519.js";

function fromb64Local(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const pad  = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

const P = ed25519.Point.Fp;

/** Brauzer SPK imzosi (64 ta nol) — Tauri haqiqiy Ed25519 imzosi */
export function isDummySpkSignature(sigB64: string): boolean {
  try {
    const sig = fromb64Local(sigB64);
    return sig.length < 64 || sig.every((b) => b === 0);
  } catch {
    return true;
  }
}

/** Ed25519 ochiq kalit → X25519 Montgomery u-koordinata (Rust to_montgomery bilan bir xil) */
export function ed25519PkToX25519(edPk: Uint8Array): Uint8Array {
  if (edPk.length !== 32) {
    throw new Error(`Ed25519 PK 32 bayt bo'lishi kerak, kelgan: ${edPk.length}`);
  }
  const hex = Array.from(edPk, (b) => b.toString(16).padStart(2, "0")).join("");
  const pt  = ed25519.Point.fromHex(hex);
  const { y } = pt.toAffine();
  const u = P.div(P.add(y, P.ONE), P.sub(P.ONE, y));
  return P.toBytes(u);
}

/**
 * Server bundle'dagi identity_key ni X3DH DH2 uchun X25519 shakliga keltiradi.
 * Brauzer mijoz: identity_key allaqachon X25519 (dummy SPK imzosi).
 * Tauri mijoz: identity_key Ed25519 — Montgomery ga aylantiriladi.
 */
export function peerBundleIkToX25519(identityKeyB64: string, spkSignatureB64: string): Uint8Array {
  const ikRaw = fromb64Local(identityKeyB64);
  if (isDummySpkSignature(spkSignatureB64)) {
    if (ikRaw.length !== 32) throw new Error(`X25519 IK 32 bayt bo'lishi kerak: ${ikRaw.length}`);
    return ikRaw;
  }
  return ed25519PkToX25519(ikRaw);
}
