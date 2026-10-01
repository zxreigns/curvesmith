import { Connection, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { cors } from './_lib.js';

const REGISTRY = new PublicKey('DhJrZQHhww7bUjBvzxdocFYd8ajgHzMpDcPFyJYvuJFm');
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const PREFIX = 'curvesmith:v1:';
const SOL = 'So11111111111111111111111111111111111111112';
const RPC = process.env.DEVNET_RPC || 'https://api.devnet.solana.com';

/** The Curvesmith market as JSON, rebuilt from chain history on every call (cached 30 s at the edge). */
export default async function handler(
  _req: unknown,
  res: { setHeader: (k: string, v: string) => void; status: (n: number) => { json: (b: unknown) => void } },
) {
  cors(res);
  try {
    const conn = new Connection(RPC, 'confirmed');
    const sigs = (await conn.getSignaturesForAddress(REGISTRY, { limit: 200 })).filter((s) => !s.err);
    const txs = await conn.getParsedTransactions(sigs.map((s) => s.signature), { maxSupportedTransactionVersion: 0 });
    const entries: { config: string; name: string; tagline: string; author: string; listedAt: number | null }[] = [];
    txs.forEach((tx, i) => {
      for (const ix of tx?.transaction.message.instructions ?? []) {
        if (ix.programId.toBase58() !== MEMO || !('parsed' in ix)) continue;
        const text = String(ix.parsed);
        if (!text.startsWith(PREFIX)) continue;
        try {
          const m = JSON.parse(text.slice(PREFIX.length));
          if (!entries.some((e) => e.config === m.config))
            entries.push({ config: m.config, name: m.name, tagline: m.tagline ?? '', author: tx!.transaction.message.accountKeys[0].pubkey.toBase58(), listedAt: sigs[i].blockTime ?? null });
        } catch {
          /* skip */
        }
      }
    });
    const client = new DynamicBondingCurveClient(conn, 'confirmed');
    const configs = (await client.state.program.account.poolConfig.fetchMultiple(entries.map((e) => new PublicKey(e.config)))) as Array<{
      quoteMint: PublicKey;
      migrationQuoteThreshold: { toString(): string };
    } | null>;
    const out = await Promise.all(
      entries.map(async (e, i) => {
        const pc = configs[i];
        let launches = 0;
        let graduated = 0;
        try {
          const pools = await client.state.getPoolsByConfig(e.config);
          launches = pools.length;
          graduated = pools.filter((p) => p.account.poolState.isMigrated === 1).length;
        } catch {
          /* rate limited: leave zeros */
        }
        const sol = pc?.quoteMint.toBase58() === SOL;
        return {
          ...e,
          quote: sol ? 'SOL' : pc?.quoteMint.toBase58() ?? null,
          raise: pc ? Number(pc.migrationQuoteThreshold.toString()) / (sol ? 1e9 : 1e6) : null,
          launches,
          graduated,
          studio: `/#/preset/${e.config}`,
        };
      }),
    );
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.status(200).json({ cluster: 'devnet', registry: REGISTRY.toBase58(), presets: out });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
