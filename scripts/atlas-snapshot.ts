/**
 * Launchpad Atlas: how the launchpads on Meteora DBC actually shape their curves, read from mainnet.
 *  1. every PartnerMetadata account (launchpad name / site / logo, keyed by fee claimer)
 *  2. how many DBC configs each launchpad has created (getProgramAccounts with a memcmp count)
 *  3. for the busiest ones: sample their configs, find the curve they use most, count its pools
 * Output: public/atlas.json. Usage: npx vite-node scripts/atlas-snapshot.ts [rpcUrl]
 */
import fs from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, type PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { client } from '../src/core/chain';
import { analyzePool, feeSummary } from '../src/core/fork';

const RPC = process.argv[2] || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(RPC, { commitment: 'confirmed', disableRetryOnRateLimit: true });
const c = client(conn);
const coder = c.state.program.coder.accounts;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const disc = (name: string) => bs58.encode(Buffer.from((c.state.program.idl.accounts.find((a: { name: string }) => a.name === name) as { discriminator: number[] }).discriminator));
const QUOTES: Record<string, { s: string; d: number }> = {
  So11111111111111111111111111111111111111112: { s: 'SOL', d: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { s: 'USDC', d: 6 },
};

async function retry<T>(fn: () => Promise<T>, n = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= n) throw e;
      await sleep(3000 * (i + 1));
    }
  }
}

console.log('reading partner metadata…');
const metas = await retry(() => conn.getProgramAccounts(DYNAMIC_BONDING_CURVE_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: disc('partnerMetadata') } }] }));
const partners = metas
  .map((m) => {
    try {
      const d = coder.decode('partnerMetadata', m.account.data) as { feeClaimer: PublicKey; name: string; website: string; logo: string };
      return { feeClaimer: d.feeClaimer.toBase58(), name: d.name.trim(), website: d.website.trim(), logo: d.logo.trim() };
    } catch {
      return null;
    }
  })
  .filter((p): p is NonNullable<typeof p> => !!p && p.name.length > 1);
console.log(partners.length, 'named launchpads');

const cfgDisc = disc('poolConfig');
const counted: (typeof partners[number] & { configs: string[] })[] = [];
const queue = [...partners];
await Promise.all(
  Array.from({ length: Number(process.env.CONCURRENCY || 1) }, async () => {
    while (queue.length) {
      const p = queue.shift()!;
      const res = await retry(() =>
        conn.getProgramAccounts(DYNAMIC_BONDING_CURVE_PROGRAM_ID, {
          dataSlice: { offset: 0, length: 0 },
          filters: [{ memcmp: { offset: 0, bytes: cfgDisc } }, { memcmp: { offset: 40, bytes: p.feeClaimer } }],
        }),
      ).catch(() => []);
      counted.push({ ...p, configs: res.map((r) => r.pubkey.toBase58()) });
      if (counted.length % 50 === 0) console.log('counted', counted.length);
      await sleep(Number(process.env.GAP_MS || 2200));
    }
  }),
);

// one entry per launchpad name (some brands registered several claimers)
const byName = new Map<string, (typeof counted)[number]>();
for (const p of counted) {
  const k = p.name.toLowerCase();
  const prev = byName.get(k);
  if (!prev) byName.set(k, p);
  else prev.configs.push(...p.configs);
}
const top = [...byName.values()].filter((p) => p.configs.length > 0).sort((a, b) => b.configs.length - a.configs.length).slice(0, 30);
const totalConfigs = counted.reduce((s, p) => s + p.configs.length, 0);

const sig = (pc: PoolConfig) => `${pc.sqrtStartPrice.toString()}|${pc.migrationQuoteThreshold.toString()}|${pc.curve.filter((x) => !x.liquidity.isZero()).length}|${pc.poolFees.baseFee.cliffFeeNumerator.toString()}`;
const out = [];
for (const p of top) {
  const sample = p.configs.length <= 25 ? p.configs : Array.from({ length: 25 }, (_, i) => p.configs[Math.floor((i * p.configs.length) / 25)]);
  const infos = await retry(() => conn.getMultipleAccountsInfo(sample.map((s) => new PublicKey(s))));
  const decoded = infos
    .map((info, i) => {
      if (!info) return null;
      try {
        return { address: sample[i], pc: coder.decode('poolConfig', info.data) as PoolConfig };
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!decoded.length) continue;
  const groups = new Map<string, typeof decoded>();
  decoded.forEach((d) => groups.set(sig(d.pc), [...(groups.get(sig(d.pc)) ?? []), d]));
  const rep = [...groups.values()].sort((a, b) => b.length - a.length)[0][0];
  const quote = QUOTES[rep.pc.quoteMint.toBase58()] ?? { s: 'OTHER', d: 9 };
  let a;
  try {
    a = analyzePool(rep.pc, quote.d);
  } catch {
    continue;
  }
  const pools = await retry(() =>
    conn.getProgramAccounts(DYNAMIC_BONDING_CURVE_PROGRAM_ID, {
      dataSlice: { offset: 0, length: 0 },
      filters: [{ memcmp: { offset: 72, bytes: rep.address } }],
    }),
  ).catch(() => []);
  const fee = feeSummary(rep.pc);
  const step = Math.max(1, Math.floor(a.samples.length / 48));
  const rawInfo = infos[sample.indexOf(rep.address)];
  out.push({
    name: p.name,
    website: p.website,
    logo: p.logo,
    feeClaimer: p.feeClaimer,
    configCount: p.configs.length,
    sampled: decoded.length,
    distinctCurves: groups.size,
    config: rep.address,
    poolsOnConfig: pools.length,
    quote: quote.s,
    startMcap: a.startMcap,
    gradMcap: a.gradMcap,
    raise: a.quoteToGraduate,
    multiple: a.priceMultiple,
    curveSupplyPct: a.curveSupplyPct,
    segments: rep.pc.curve.filter((x) => !x.liquidity.isZero()).length,
    fee,
    dynamicFee: rep.pc.poolFees.dynamicFee.initialized === 1,
    creatorFeePct: rep.pc.creatorTradingFeePercentage,
    migration: rep.pc.migrationOption === 1 ? 'DAMM v2' : 'DAMM v1',
    lockedLpPct: rep.pc.partnerPermanentLockedLiquidityPercentage + rep.pc.creatorPermanentLockedLiquidityPercentage,
    raw: rawInfo ? Buffer.from(rawInfo.data).toString('base64') : null, // the config itself, so the Studio can fork it with no RPC
    samples: a.samples.filter((_, i) => i % step === 0 || i === a.samples.length - 1).map((s) => [Number(s.basePct.toFixed(3)), Number(s.mcap.toPrecision(5))]),
  });
  console.log(p.name, p.configs.length, 'configs,', groups.size, 'curves, rep pools', pools.length);
  await sleep(150);
}

// drop rows we cannot read honestly: unknown quote decimals, test configs, curves that never reach their threshold
const plausible = (o: (typeof out)[number]) =>
  !['test', 'tests', 'demo'].includes(o.name.trim().toLowerCase()) && o.quote !== 'OTHER' && o.startMcap > 0.05 && o.raise >= 0.5 && o.gradMcap / o.startMcap <= 1000;
out.splice(0, out.length, ...out.filter(plausible));
const sol = out.filter((o) => o.quote === 'SOL');
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const snapshot = {
  generatedAt: new Date().toISOString(),
  rpc: 'mainnet-beta',
  namedLaunchpads: partners.length,
  totalConfigsOfNamed: totalConfigs,
  insights: {
    dammV2Share: out.filter((o) => o.migration === 'DAMM v2').length / (out.length || 1),
    antiSnipeShare: out.filter((o) => o.fee.mode !== 'linear' || o.fee.startBps > o.fee.endBps).length / (out.length || 1),
    rateLimiterShare: out.filter((o) => o.fee.mode === 'rateLimiter').length / (out.length || 1),
    medianStartMcapSol: median(sol.map((o) => o.startMcap)),
    medianGradMcapSol: median(sol.map((o) => o.gradMcap)),
    medianRaiseSol: median(sol.map((o) => o.raise)),
    medianLockedLp: median(out.map((o) => o.lockedLpPct)),
    twoSegmentShare: out.filter((o) => o.segments <= 2).length / (out.length || 1),
  },
  launchpads: out,
};
fs.writeFileSync('public/atlas.json', JSON.stringify(snapshot));
console.log('wrote public/atlas.json', out.length, 'launchpads');
