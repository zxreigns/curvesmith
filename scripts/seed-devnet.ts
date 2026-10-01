/**
 * Seed devnet with the built-in presets so the market has something to explore:
 * publishes each preset as an on-chain DBC config (author = the keypair, listed in the registry),
 * launches one token on it with a first buy, then a few follow-up buys.
 * Usage: KEYPAIR=path ORIGIN=https://your.app npx vite-node scripts/seed-devnet.ts [presetKey:Name:SYMBOL:buysSOL ...]
 */
import fs from 'node:fs';
import BN from 'bn.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import { buildConfig } from '../src/core/build';
import { publishPreset, launchToken, loadPool, swap, keypairSigner, resilientConnection } from '../src/core/chain';
import { presetByKey } from '../src/core/presets';

const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR!, 'utf8'))));
const conn = resilientConnection();
const signer = keypairSigner(kp);
const origin = process.env.ORIGIN || 'https://curvesmith.vercel.app';
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out: Record<string, unknown>[] = [];
const outFile = 'scripts/.seed-run.json';

for (const spec of process.argv.slice(2)) {
  const [key, name, symbol, buysStr = '', existing] = spec.split(':');
  try {
    let config: PublicKey;
    if (existing) config = new PublicKey(existing);
    else {
      const preset = presetByKey(key)!;
      const built = buildConfig(preset.design);
      if (!built.config) throw new Error(built.error!);
      const pub = await publishPreset(conn, signer, built.config, new PublicKey(preset.design.quote.mint), { v: 1, name: preset.name, tagline: preset.tagline, shape: preset.key });
      config = pub.config;
      log(key, 'config', config.toBase58());
    }
    const launch = await launchToken(conn, signer, config, { name, symbol, uri: `${origin}/api/meta?n=${encodeURIComponent(name)}&s=${symbol}` }, 0.05e9);
    log(key, 'pool', launch.pool.toBase58(), name, symbol);
    for (const b of buysStr.split(',').filter(Boolean).map(Number)) {
      await sleep(1500);
      const v = (await loadPool(conn, launch.pool))!;
      const r = await swap(conn, signer, v, new BN(Math.round(b * 1e9)), false, 1500);
      log('  buy', b, 'SOL', r.sigs[0].slice(0, 10));
    }
    const v = (await loadPool(conn, launch.pool))!;
    log('  progress', (v.progress * 100).toFixed(1) + '%');
    out.push({ key, name, symbol, config: config.toBase58(), pool: launch.pool.toBase58(), mint: launch.mint.toBase58(), progress: v.progress });
  } catch (e) {
    log(key, 'FAILED', (e as Error).message);
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
}
log('balance', (await conn.getBalance(kp.publicKey)) / 1e9);
