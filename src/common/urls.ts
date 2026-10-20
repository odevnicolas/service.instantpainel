import { randomInt } from 'node:crypto';

/** "www.loja.com.br" -> "https://www.loja.com.br/". Undefined if it isn't an http(s) address. Same rule as the painel. */
export function normalizeUrl(value: string) {
  const v = value.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return url.hostname.includes('.') ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Already-complete http(s) URL (what the painel sends after normalizing; also rejects javascript:, data:, blob:…). */
export const isHttpUrl = (v: string) =>
  /^https?:\/\//i.test(v) && normalizeUrl(v) !== undefined;

// No 0/O/1/I: codes get typed by hand from the printed plate. 32 symbols, 4 chars ≈ 1M codes.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const newPlateCode = () =>
  Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(
    '',
  );

/** Plate code from what people type or paste: the code itself or the plate URL (…/p/ABCD). */
export function plateCode(raw: string) {
  const code = (raw.match(/\/p\/(\w+)/)?.[1] ?? raw).trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : undefined;
}

/** YouTube video id from watch, youtu.be, shorts or embed links (same as the painel). */
export const youtubeId = (url: string) =>
  url.match(/(?:youtu\.be\/|[?&]v=|\/(?:embed|shorts|live)\/)([\w-]{11})/)?.[1];
