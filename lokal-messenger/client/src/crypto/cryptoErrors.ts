// E2EE deshifrlash xatoliklari — konsolga aniq sabab chiqarish uchun.

export type DecryptErrorCode =
  | "SESSION_NOT_FOUND"
  | "PAYLOAD_JSON"
  | "CIPHERTEXT_MISSING"
  | "IV_LENGTH"
  | "BASE64_INVALID"
  | "AES_GCM_FAILED"      // MAC / kalit noto'g'ri
  | "OUT_OF_ORDER"
  | "OTPK_MISSING"
  | "UNKNOWN";

export class DecryptError extends Error {
  readonly code: DecryptErrorCode;

  constructor(code: DecryptErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "DecryptError";
    this.code = code;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export function classifyDecryptError(err: unknown): DecryptError {
  if (err instanceof DecryptError) return err;

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("sessiya yo'q") || lower.includes("sessiya topilmadi")) {
    return new DecryptError("SESSION_NOT_FOUND", msg, err);
  }
  if (lower.includes("juda qisqa") || lower.includes("iv")) {
    return new DecryptError("IV_LENGTH", msg, err);
  }
  if (lower.includes("base64")) {
    return new DecryptError("BASE64_INVALID", msg, err);
  }
  if (lower.includes("payload json") || lower.includes("ciphertext maydoni")) {
    return new DecryptError("PAYLOAD_JSON", msg, err);
  }
  if (lower.includes("otpk")) {
    return new DecryptError("OTPK_MISSING", msg, err);
  }
  if (lower.includes("out-of-order")) {
    return new DecryptError("OUT_OF_ORDER", msg, err);
  }
  if (
    lower.includes("operationerror") ||
    lower.includes("decrypt") ||
    lower.includes("aes-gcm") ||
    lower.includes("shifr ochish")
  ) {
    return new DecryptError("AES_GCM_FAILED", `Invalid MAC yoki kalit mos emas: ${msg}`, err);
  }
  return new DecryptError("UNKNOWN", msg, err);
}

export function logDecryptError(
  ctx: { peerId: string; chatId?: string; msgNum?: number; ctLen?: number },
  err: DecryptError
): void {
  console.error(`[E2EE] ❌ decrypt [${err.code}] peer=${ctx.peerId}`, {
    chatId:  ctx.chatId,
    msg_num: ctx.msgNum,
    ct_len:  ctx.ctLen,
    detail:  err.message,
    cause:   (err as Error & { cause?: unknown }).cause,
  });
}
