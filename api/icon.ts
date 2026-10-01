import { hue } from './_lib';

/** Deterministic token avatar: a forged gradient disc with the ticker. */
export default function handler(req: { query: Record<string, string> }, res: { setHeader: (k: string, v: string) => void; status: (n: number) => { send: (b: string) => void } }) {
  const s = String(req.query.s || '?').slice(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const h = hue(s);
  const label = s.slice(0, s.length > 4 ? 3 : 4);
  const fs = label.length <= 2 ? 30 : label.length === 3 ? 24 : 19;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="256" height="256"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="hsl(${h},85%,45%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},95%,62%)"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(#g)"/><path d="M14 60 C 30 58, 44 48, 66 20" stroke="rgba(255,255,255,.28)" stroke-width="5" fill="none" stroke-linecap="round"/><text x="40" y="${40 + fs / 3}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="${fs}" fill="#fff">${label}</text></svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.status(200).send(svg);
}
