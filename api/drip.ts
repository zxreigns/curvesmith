import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { cors } from './_lib.js';

/**
 * Sponsored devnet SOL so anyone can try the full flow without hunting for a faucet.
 * Only tops up wallets that are nearly empty, with a small fixed amount, rate-limited per IP.
 */
const AMOUNT = 0.5;
const seen = new Map<string, number>();

export default async function handler(
  req: { method?: string; query: Record<string, string>; headers: Record<string, string | undefined> },
  res: { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (b: unknown) => void; end: () => void } },
) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const secret = process.env.DRIP_SECRET_KEY;
  if (!secret) return res.status(503).json({ error: 'Sponsored faucet is not configured' });
  let to: PublicKey;
  try {
    to = new PublicKey(String(req.query.to));
  } catch {
    return res.status(400).json({ error: 'Bad address' });
  }
  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  for (const k of [ip, to.toBase58()]) {
    if ((seen.get(k) ?? 0) > now - 10 * 60_000) return res.status(429).json({ error: 'One top-up per 10 minutes' });
  }
  try {
    const conn = new Connection(process.env.DEVNET_RPC || 'https://api.devnet.solana.com', 'confirmed');
    const bal = await conn.getBalance(to);
    if (bal > 1 * LAMPORTS_PER_SOL) return res.status(400).json({ error: 'This wallet already has devnet SOL' });
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports: AMOUNT * LAMPORTS_PER_SOL }));
    tx.feePayer = kp.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize());
    seen.set(ip, now);
    seen.set(to.toBase58(), now);
    return res.status(200).json({ sig, amount: AMOUNT });
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
