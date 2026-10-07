// Aperçu des liens web (titre, description, image) et détection des vidéos intégrables.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 CoursAlbert/3.0';

/** Lien YouTube ou Vimeo → adresse du lecteur intégré (sans cookies quand c’est possible). */
export function embedFor(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/); if (m) id = m[1]; }
    }
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      const t = u.searchParams.get('t') || u.searchParams.get('start');
      const start = t ? parseInt(String(t).replace(/s$/, ''), 10) : 0;
      return `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ''}`;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const m = u.pathname.match(/(?:^|\/)(\d{5,12})(?:$|\/)/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
  } catch {}
  return null;
}

function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:') && privateAddress(v.slice(7));
}
/** Refuse les adresses du réseau local : un invité ne doit pas pouvoir sonder le réseau du propriétaire. */
export async function assertPublic(url) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Adresse non prise en charge.');
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(u.hostname)) throw new Error('Adresse locale refusée.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(a => a.address);
  if (!addresses.length || addresses.some(privateAddress)) throw new Error('Adresse locale refusée.');
}

async function fetchLimited(url, { max = 1_500_000, accept = 'text/html,application/xhtml+xml', timeout = 8000 } = {}) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(timeout) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), current).href; continue; }
    if (!res.ok) throw new Error(`La page a répondu ${res.status}.`);
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel().catch(() => {}); if (accept.startsWith('text/html')) break; throw new Error('Fichier trop volumineux.'); }
      chunks.push(value);
    }
    return { url: current, type: res.headers.get('content-type') || '', body: Buffer.concat(chunks) };
  }
  throw new Error('Trop de redirections.');
}

const decode = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }[k] ?? m;
}).replace(/\s+/g, ' ').trim();
function metaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || tag.match(/\bcontent\s*=\s*([^\s>]+)/i) || [])[1];
    if (key && content != null && !(key.toLowerCase() in out)) out[key.toLowerCase()] = decode(content);
  }
  return out;
}

/** Récupère l’aperçu d’une page ; saveImage(buffer, nom, type) enregistre l’image d’aperçu et renvoie son nom de fichier. */
export async function linkPreview(url, { saveImage } = {}) {
  const embed = embedFor(url);
  const page = await fetchLimited(url);
  const out = { url: page.url, title: '', description: '', site: new URL(page.url).hostname.replace(/^www\./, ''), image: null, embed };
  if (/^image\//.test(page.type) && saveImage) {
    out.title = decodeURIComponent(new URL(page.url).pathname.split('/').pop() || 'Image');
    out.image = await saveImage(page.body, out.title, page.type).catch(() => null);
    return out;
  }
  if (!/html|xml/.test(page.type)) { out.title = decodeURIComponent(new URL(page.url).pathname.split('/').pop() || out.site); return out; }
  const html = page.body.toString('utf8');
  const meta = metaTags(html);
  out.title = (meta['og:title'] || meta['twitter:title'] || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]) || out.site).slice(0, 300);
  out.description = (meta['og:description'] || meta['twitter:description'] || meta.description || '').slice(0, 600);
  if (meta['og:site_name']) out.site = meta['og:site_name'].slice(0, 120);
  const imageUrl = meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'];
  if (imageUrl && saveImage) {
    try {
      const abs = new URL(imageUrl, page.url).href;
      const img = await fetchLimited(abs, { max: 6_000_000, accept: 'image/*', timeout: 8000 });
      if (/^image\/(png|jpe?g|gif|webp|avif)/.test(img.type)) out.image = await saveImage(img.body, `apercu${{ 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif' }[img.type.split(';')[0]] || '.jpg'}`, img.type.split(';')[0]);
    } catch {}
  }
  return out;
}
