import { cors } from './_lib.js';

const RPCS: Record<string, string[]> = {
  mainnet: [process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'],
  devnet: [process.env.DEVNET_RPC || 'https://api.devnet.solana.com', 'https://solana-devnet.api.onfinality.io/public'],
};

/** Read one account server-side (public mainnet RPCs refuse most browser origins). Used to fork configs. */
export default async function handler(
  req: { query: Record<string, string> },
  res: { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (b: unknown) => void } },
) {
  cors(res);
  const address = String(req.query.address || '');
  const cluster = req.query.cluster === 'mainnet' ? 'mainnet' : 'devnet';
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return res.status(400).json({ error: 'bad address' });
  for (const url of RPCS[cluster]) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64' }] }),
      });
      const j = (await r.json()) as { result?: { value: { data: [string, string]; owner: string } | null } };
      if (!j.result) continue;
      if (!j.result.value) return res.status(404).json({ error: 'account not found' });
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
      return res.status(200).json({ cluster, address, owner: j.result.value.owner, data: j.result.value.data[0] });
    } catch {
      /* next endpoint */
    }
  }
  res.status(502).json({ error: 'RPC unavailable' });
}
