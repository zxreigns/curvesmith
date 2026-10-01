/**
 * End-to-end devnet run of the whole Curvesmith lifecycle with a local keypair:
 *   design -> createConfig + registry listing -> launch with first buy -> buys -> graduate to DAMM v2
 * Usage: KEYPAIR=path/to/devnet.json npx vite-node scripts/e2e-devnet.ts [presetKey] [tokenName] [symbol]
 */
import fs from 'node:fs';
import BN from 'bn.js';
import { Connection, Keypair } from '@solana/web3.js';
import { buildConfig } from '../src/core/build';
import { publishPreset, launchToken, loadPool, swap, graduate, readRegistry, keypairSigner, DEVNET_RPC } from '../src/core/chain';
import { presetByKey } from '../src/core/presets';

const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR!, 'utf8'))));
const conn = new Connection(process.env.RPC || DEVNET_RPC, 'confirmed');
const signer = keypairSigner(kp);
const [presetKey = 'demo', name = 'Forge Cat', symbol = 'FCAT'] = process.argv.slice(2);
const preset = presetByKey(presetKey)!;
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const built = buildConfig(preset.design);
if (!built.config) throw new Error(built.error!);
log('balance', (await conn.getBalance(kp.publicKey)) / 1e9);

const pub = await publishPreset(conn, signer, built.config, new (await import('@solana/web3.js')).PublicKey(preset.design.quote.mint), {
  v: 1,
  name: preset.name,
  tagline: preset.tagline,
  shape: preset.key,
});
log('config', pub.config.toBase58(), pub.sigs);

const origin = process.env.ORIGIN || 'https://curvesmith.vercel.app';
const launch = await launchToken(conn, signer, pub.config, { name, symbol, uri: `${origin}/api/meta?n=${encodeURIComponent(name)}&s=${symbol}` }, 0.05e9);
log('pool', launch.pool.toBase58(), 'mint', launch.mint.toBase58(), launch.sigs);

if (process.env.GRADUATE !== '0') {
  for (let i = 0; i < 12; i++) {
    const v = (await loadPool(conn, launch.pool))!;
    log('progress', (v.progress * 100).toFixed(1) + '%');
    if (v.progress >= 1) break;
    const remaining = Number(v.config.migrationQuoteThreshold.sub(v.pool.poolState.quoteReserve).toString());
    const amt = Math.min(Math.ceil(remaining * 1.08) + 1000, 0.6e9);
    const r = await swap(conn, signer, v, new BN(amt), false, 1000);
    log('buy', amt / 1e9, 'SOL ->', r.sigs[0]);
  }
  const v = (await loadPool(conn, launch.pool))!;
  log('final progress', v.progress, 'isMigrated', v.pool.poolState.isMigrated);
  if (!v.pool.poolState.isMigrated) {
    const sigs = await graduate(conn, signer, v);
    log('graduated', sigs);
  }
}
const reg = await readRegistry(conn);
log('registry entries', reg.length, reg.slice(0, 3).map((r) => r.meta.name));
log('balance', (await conn.getBalance(kp.publicKey)) / 1e9);
fs.writeFileSync(`scripts/.last-run-${presetKey}.json`, JSON.stringify({ config: pub.config.toBase58(), pool: launch.pool.toBase58(), mint: launch.mint.toBase58() }, null, 2));
