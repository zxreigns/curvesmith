import { cors } from './_lib';

/** Metaplex-style token metadata for tokens launched from Curvesmith. */
export default function handler(
  req: { query: Record<string, string>; headers: Record<string, string> },
  res: { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (b: unknown) => void } },
) {
  cors(res);
  const name = String(req.query.n || 'Curvesmith token').slice(0, 32);
  const symbol = String(req.query.s || 'CURVE').slice(0, 10);
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'curvesmith.vercel.app';
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).json({
    name,
    symbol,
    description: `${name} launched on a Meteora Dynamic Bonding Curve preset from Curvesmith.`,
    image: `https://${host}/api/icon?s=${encodeURIComponent(symbol)}`,
    external_url: `https://${host}`,
  });
}
