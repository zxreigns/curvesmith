/** Finish a pool started by e2e-devnet: buy to the threshold, then graduate into DAMM v2. */
import fs from 'node:fs';
import BN from 'bn.js';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { loadPool, swap, graduate, keypairSigner, DEVNET_RPC } from '../src/core/chain';

const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR!, 'utf8'))));
const conn = new Connection(process.env.RPC || DEVNET_RPC, 'confirmed');
const signer = keypairSigner(kp);
const pool = new PublicKey(process.argv[2]);
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
for (let i = 0; i < 10; i++) {
  const v = (await loadPool(conn, pool))!;
  log('progress', (v.progress * 100).toFixed(1) + '%', 'migrated', v.pool.poolState.isMigrated);
  if (v.progress >= 1) break;
  const remaining = Number(v.config.migrationQuoteThreshold.sub(v.pool.poolState.quoteReserve).toString());
  const amt = Math.min(Math.ceil(remaining * 1.3) + 5000, 0.6e9);
  const r = await swap(conn, signer, v, new BN(amt), false, 1000);
  log('buy', amt / 1e9, r.sigs[0]);
}
const v = (await loadPool(conn, pool))!;
if (!v.pool.poolState.isMigrated) log('graduated', await graduate(conn, signer, v));
const v2 = (await loadPool(conn, pool))!;
log('isMigrated', v2.pool.poolState.isMigrated, 'balance', (await conn.getBalance(kp.publicKey)) / 1e9);
