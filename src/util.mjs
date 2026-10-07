// Outils partagés par le moteur Cours Albert.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function safeName(value, fallback = 'Sans nom') {
  return String(value ?? '').normalize('NFC').replace(/[\x00-\x1f/\\:]/g, '_').replace(/^\.+$/, '_').trim().slice(0, 180) || fallback;
}
export function normalized(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
export async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
export async function writeAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  try { await fs.writeFile(temp, data); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
/** Message d’erreur court, sans adresse signée ni journal Playwright. */
export function fmtErr(error) {
  return String(error?.message || error)
    .split(/\n\s*Call log:/)[0]
    .replace(/https?:\/\/[^\s"']+/g, '[adresse masquée]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

const TRANSIENT = /ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_(RESET|CLOSED|REFUSED|TIMED_OUT|ABORTED)|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_ABORTED|ERR_HTTP2|ERR_QUIC|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|Timeout \d+ms exceeded|timed out|Navigation interrupted|interrupted by another navigation|net::ERR_FAILED/i;
const CLOSED = /Target page, context or browser has been closed|Browser has been closed|browser has disconnected|Target closed/i;

export class BrowserClosedError extends Error {}
export const isTransient = error => TRANSIENT.test(String(error?.message || error));
export const isBrowserClosed = error => error instanceof BrowserClosedError || CLOSED.test(String(error?.message || error));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Relance une action réseau fragile (changement de Wi-Fi, délai dépassé…). */
export async function withRetry(fn, { tries = 3, delays = [1500, 4000, 9000], onRetry } = {}) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    try { return await fn(attempt); }
    catch (error) {
      last = error;
      if (isBrowserClosed(error)) throw new BrowserClosedError(fmtErr(error));
      if (!isTransient(error) || attempt === tries - 1) throw error;
      onRetry?.(error, attempt + 1);
      await sleep(delays[Math.min(attempt, delays.length - 1)]);
    }
  }
  throw last;
}

/** Vérifie la connexion avant de lancer Chrome : évite une cascade d’erreurs hors ligne. */
export async function online(url, timeout = 8000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeout) });
      if (response.status > 0) return true;
    } catch { await sleep(1500); }
  }
  return false;
}

/** Transforme une erreur technique en phrase compréhensible par un étudiant. */
export function humanError(message) {
  const m = String(message);
  if (/session expirée|reconnecter|connexion non terminée/i.test(m)) return m;
  if (CLOSED.test(m)) return 'Chrome s’est fermé pendant la vérification d’Inside. Relancez la synchronisation.';
  if (/ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(m)) return `Connexion internet interrompue (${m.split(':')[0]}).`;
  if (/Timeout|timed out|délai/i.test(m)) return `Inside a mis trop de temps à répondre (${m.split(':')[0]}).`;
  return m;
}
