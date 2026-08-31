export const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type WechatExchangeConfig = { appId: string; appSecret: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;

  try {
    const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - value.length % 4) % 4)}`;
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function signaturesMatch(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validPayload(value: unknown): value is { sub: string; iat: number; exp: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const payload = value as Record<string, unknown>;
  const { sub, iat, exp } = payload;
  const keys = Object.keys(payload).sort();
  return keys.length === 3
    && keys[0] === "exp"
    && keys[1] === "iat"
    && keys[2] === "sub"
    && typeof sub === "string"
    && sub.length > 0
    && typeof iat === "number"
    && Number.isInteger(iat)
    && typeof exp === "number"
    && Number.isInteger(exp)
    && exp === iat + ACCESS_TOKEN_TTL_SECONDS;
}

function nicknameHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export async function exchangeWechatCode(
  code: string,
  config: WechatExchangeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ openid: string }> {
  if (!code.trim()) throw new Error("INVALID_WECHAT_CODE");

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.search = new URLSearchParams({
    appid: config.appId,
    secret: config.appSecret,
    js_code: code,
    grant_type: "authorization_code",
  }).toString();
  const response = await fetchImpl(url);
  const payload = await response.json() as { openid?: string; errcode?: number };
  if (!response.ok || payload.errcode || !payload.openid) throw new Error("WECHAT_LOGIN_FAILED");

  return { openid: payload.openid };
}

export async function createAccessToken(userId: string, issuedAtSeconds: number, secret: string): Promise<string> {
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({
    sub: userId,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + ACCESS_TOKEN_TTL_SECONDS,
  })));
  const signature = encodeBase64Url(await sign(payload, secret));
  return `${payload}.${signature}`;
}

export async function verifyAccessToken(
  token: string,
  nowSeconds: number,
  secret: string,
): Promise<{ userId: string } | null> {
  const [encodedPayload, encodedSignature, extraPart] = token.split(".");
  if (!encodedPayload || !encodedSignature || extraPart !== undefined) return null;

  const signature = decodeBase64Url(encodedSignature);
  const payloadBytes = decodeBase64Url(encodedPayload);
  if (!signature || !payloadBytes) return null;

  const expectedSignature = await sign(encodedPayload, secret);
  if (!signaturesMatch(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(decoder.decode(payloadBytes)) as unknown;
    if (!validPayload(payload) || !Number.isFinite(nowSeconds) || nowSeconds > payload.exp) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export function automaticNickname(userId: string): string {
  const suffix = nicknameHash(userId).toString(36).toUpperCase().slice(-4).padStart(4, "0");
  return `微信用户 ${suffix}`;
}
