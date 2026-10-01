import BN from 'bn.js';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from '@solana/web3.js';
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDbcPoolAddress,
  DynamicBondingCurveClient,
  getCurrentPoint,
  SwapMode,
  type ConfigParameters,
  type PoolConfig,
  type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { Design } from './model';

const ENV = (import.meta as { env?: Record<string, string> }).env ?? {};
export const DEVNET_RPC = ENV.VITE_DEVNET_RPC || 'https://api.devnet.solana.com';
/** Public devnet endpoints, tried in order when one rate-limits. */
export const DEVNET_RPCS = [DEVNET_RPC, 'https://solana-devnet.api.onfinality.io/public'];

/**
 * A Connection that fails over between RPC endpoints on 429/5xx instead of hammering one.
 * Public devnet RPCs rate-limit hard; judges and users should never see that.
 */
export function resilientConnection(endpoints = DEVNET_RPCS, commitment: Commitment = 'confirmed') {
  let i = 0;
  const fetchWithFailover = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    let last: Response | undefined;
    for (let attempt = 0; attempt < endpoints.length * 2; attempt++) {
      const url = endpoints[(i + attempt) % endpoints.length];
      try {
        const res = await fetch(url, init);
        if (res.status !== 429 && res.status < 500) {
          i = (i + attempt) % endpoints.length;
          return res;
        }
        last = res;
      } catch (e) {
        if (attempt === endpoints.length * 2 - 1) throw e;
      }
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
    return last!;
  };
  return new Connection(endpoints[0], {
    commitment,
    fetch: fetchWithFailover as typeof fetch,
    disableRetryOnRateLimit: true,
  });
}
export const MAINNET_RPC = (import.meta as { env?: Record<string, string> }).env?.VITE_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';

/**
 * The Curvesmith registry is just an address. Every preset publication touches it (a 0-lamport
 * transfer) and carries an SPL Memo with the preset's metadata, so the whole marketplace can be
 * rebuilt from chain history with getSignaturesForAddress — no database, no backend.
 */
export const REGISTRY = new PublicKey('DhJrZQHhww7bUjBvzxdocFYd8ajgHzMpDcPFyJYvuJFm');
export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const MEMO_PREFIX = 'curvesmith:v1:';

export interface Signer {
  publicKey: PublicKey;
  signAll(txs: Transaction[]): Promise<Transaction[]>;
}

export const keypairSigner = (kp: Keypair): Signer => ({
  publicKey: kp.publicKey,
  signAll: async (txs) => {
    txs.forEach((t) => t.partialSign(kp));
    return txs;
  },
});

export const client = (conn: Connection, commitment: Commitment = 'confirmed') =>
  new DynamicBondingCurveClient(conn, commitment);

async function prepare(conn: Connection, payer: PublicKey, txs: Transaction[], cuPrice = 20_000) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  for (const t of txs) {
    t.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }));
    t.recentBlockhash = blockhash;
    t.lastValidBlockHeight = lastValidBlockHeight;
    t.feePayer = payer;
  }
  return { blockhash, lastValidBlockHeight };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Confirm by polling (no websockets: public RPCs drop them under load), re-broadcasting the
 * signed bytes every few seconds until the blockhash expires.
 */
export async function confirm(conn: Connection, sig: string, lastValidBlockHeight: number, raw?: Buffer | Uint8Array) {
  for (let i = 0; ; i++) {
    await sleep(i === 0 ? 600 : 1200);
    let st;
    try {
      st = (await conn.getSignatureStatuses([sig])).value[0];
    } catch {
      continue; // transient 429s: keep polling
    }
    if (st?.err) throw new Error(`Transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return;
    if (i % 4 === 3) {
      if (raw) conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
      const h = await conn.getBlockHeight('confirmed').catch(() => 0);
      if (h > lastValidBlockHeight) throw new Error('blockhash expired before confirmation');
    }
  }
}

/** Sign (extra signers first, then the wallet) and send in order, confirming each. */
export async function sendAll(
  conn: Connection,
  signer: Signer,
  txs: Transaction[],
  extra: Keypair[][] = [],
  onSent?: (sig: string, i: number) => void,
) {
  const bh = await prepare(conn, signer.publicKey, txs);
  txs.forEach((t, i) => (extra[i] || []).forEach((k) => t.partialSign(k)));
  const signed = await signer.signAll(txs);
  const sigs: string[] = [];
  for (const [i, t] of signed.entries()) {
    const sig = await conn.sendRawTransaction(t.serialize(), { skipPreflight: false, maxRetries: 5 });
    onSent?.(sig, i);
    await confirm(conn, sig, bh.lastValidBlockHeight, t.serialize());
    sigs.push(sig);
  }
  return sigs;
}

export interface PresetMeta {
  v: 1;
  name: string;
  tagline?: string;
  shape?: string;
  /** compact design so the studio can re-open and fork the exact preset */
  design?: Partial<Design>;
}

/** Publish a preset: create the DBC config (author = fee claimer = royalties) + register it. */
export async function publishPreset(
  conn: Connection,
  signer: Signer,
  cfg: ConfigParameters,
  quoteMint: PublicKey,
  meta: PresetMeta,
  onSent?: (sig: string, i: number) => void,
) {
  const configKp = Keypair.generate();
  const author = signer.publicKey;
  const c = client(conn);
  const createTx = await c.partner.createConfig({
    ...cfg,
    config: configKp.publicKey,
    feeClaimer: author,
    leftoverReceiver: author,
    quoteMint,
    payer: author,
  });
  const memo = MEMO_PREFIX + JSON.stringify({ ...meta, config: configKp.publicKey.toBase58() });
  const regTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: author, toPubkey: REGISTRY, lamports: 0 }),
    new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo, 'utf8') }),
  );
  const sigs = await sendAll(conn, signer, [createTx, regTx], [[configKp], []], onSent);
  return { config: configKp.publicKey, sigs };
}

export interface RegistryEntry {
  config: string;
  meta: PresetMeta;
  author: string;
  sig: string;
  time: number | null;
}

/** Rebuild the marketplace from chain history. */
export async function readRegistry(conn: Connection, limit = 200): Promise<RegistryEntry[]> {
  const sigs = await conn.getSignaturesForAddress(REGISTRY, { limit });
  const ok = sigs.filter((s) => !s.err);
  const out: RegistryEntry[] = [];
  for (let i = 0; i < ok.length; i += 20) {
    const batch = ok.slice(i, i + 20);
    const txs = await conn.getParsedTransactions(
      batch.map((b) => b.signature),
      { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    );
    txs.forEach((tx, j) => {
      if (!tx) return;
      for (const ix of tx.transaction.message.instructions) {
        if (!ix.programId.equals(MEMO_PROGRAM)) continue;
        const text = 'parsed' in ix ? String(ix.parsed) : '';
        if (!text.startsWith(MEMO_PREFIX)) continue;
        try {
          const parsed = JSON.parse(text.slice(MEMO_PREFIX.length));
          out.push({
            config: parsed.config,
            meta: parsed,
            author: tx.transaction.message.accountKeys[0].pubkey.toBase58(),
            sig: batch[j].signature,
            time: batch[j].blockTime ?? null,
          });
        } catch {
          /* ignore malformed memos */
        }
      }
    });
  }
  return out;
}

export interface TokenInfo {
  name: string;
  symbol: string;
  uri: string;
}

/** Launch a token on a preset (anyone can): create the virtual pool, optionally with a first buy. */
export async function launchToken(
  conn: Connection,
  signer: Signer,
  config: PublicKey,
  token: TokenInfo,
  firstBuyLamports = 0,
  onSent?: (sig: string, i: number) => void,
) {
  const c = client(conn);
  const mintKp = Keypair.generate();
  const me = signer.publicKey;
  const createPoolParam = { ...token, payer: me, poolCreator: me, config, baseMint: mintKp.publicKey };
  const tx =
    firstBuyLamports > 0
      ? await c.creator.createPoolWithFirstBuy({
          createPoolParam,
          firstBuyParam: {
            buyer: me,
            buyAmount: new BN(firstBuyLamports),
            minimumAmountOut: new BN(1),
            referralTokenAccount: null,
          },
        })
      : await c.creator.createPool(createPoolParam);
  const cfg = await c.state.getPoolConfig(config);
  const pool = deriveDbcPoolAddress(cfg!.quoteMint, mintKp.publicKey, config);
  const sigs = await sendAll(conn, signer, [tx], [[mintKp]], onSent);
  return { mint: mintKp.publicKey, pool, sigs };
}

export interface PoolView {
  address: PublicKey;
  pool: VirtualPool;
  config: PoolConfig;
  progress: number; // 0..1 of the migration quote threshold
}

export async function loadPool(conn: Connection, address: PublicKey): Promise<PoolView | null> {
  const c = client(conn);
  const pool = await c.state.getPool(address);
  if (!pool) return null;
  const config = await c.state.getPoolConfig(pool.poolState.config);
  if (!config) return null;
  const thr = Number(config.migrationQuoteThreshold.toString());
  const progress = thr > 0 ? Math.min(1, Number(pool.poolState.quoteReserve.toString()) / thr) : 0;
  return { address, pool, config, progress };
}

export interface Quote {
  out: BN; // tokens (buy) or quote (sell) you receive
  minOut: BN;
  used: BN; // input actually consumed (a buy that would overshoot graduation is partially filled)
  left: BN; // input refunded
  fee: BN; // trading + protocol fee, in quote
  nextSqrtPrice: BN;
}

/**
 * Exact on-chain quote using the program's fee schedule at the current time. Buys are quoted as
 * partial fills: if the amount would push past the graduation threshold, only what fits is used.
 */
export async function quote(conn: Connection, v: PoolView, amountIn: BN, sell: boolean, slippageBps = 300): Promise<Quote> {
  const point = await getCurrentPoint(conn, v.config.activationType);
  const r = client(conn).pool.swapQuote2({
    virtualPool: v.pool,
    config: v.config,
    swapBaseForQuote: sell,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint: point,
    slippageBps,
    swapMode: sell ? SwapMode.ExactIn : SwapMode.PartialFill,
    amountIn,
  });
  return {
    out: r.outputAmount,
    minOut: r.minimumAmountOut ?? new BN(0),
    used: r.includedFeeInputAmount,
    left: r.amountLeft,
    fee: r.tradingFee.add(r.protocolFee).add(r.referralFee),
    nextSqrtPrice: r.nextSqrtPrice,
  };
}

export async function swap(
  conn: Connection,
  signer: Signer,
  v: PoolView,
  amountIn: BN,
  sell: boolean,
  slippageBps = 300,
  onSent?: (sig: string, i: number) => void,
) {
  const q = await quote(conn, v, amountIn, sell, slippageBps);
  const tx = await client(conn).pool.swap2({
    owner: signer.publicKey,
    pool: v.address,
    swapBaseForQuote: sell,
    referralTokenAccount: null,
    swapMode: sell ? SwapMode.ExactIn : SwapMode.PartialFill,
    amountIn,
    minimumAmountOut: q.minOut,
  } as Parameters<ReturnType<typeof client>['pool']['swap2']>[0]);
  const sigs = await sendAll(conn, signer, [tx], [], onSent);
  return { sigs, quote: q };
}

/** Permissionless graduation: move a completed curve into a DAMM v2 pool. */
export async function graduate(conn: Connection, signer: Signer, v: PoolView, onSent?: (sig: string, i: number) => void) {
  const c = client(conn);
  const txs: Transaction[] = [];
  const extra: Keypair[][] = [];
  if (Number(v.config.lockedVestingConfig.amountPerPeriod.toString()) > 0 || Number(v.config.lockedVestingConfig.cliffUnlockAmount.toString()) > 0) {
    txs.push(await c.migration.createLocker({ payer: signer.publicKey, pool: v.address }));
    extra.push([]);
  }
  const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[v.config.migrationFeeOption];
  const res = await c.migration.migrateToDammV2({ payer: signer.publicKey, pool: v.address, dammConfig });
  txs.push(res.transaction);
  extra.push([res.firstPositionNftKeypair, res.secondPositionNftKeypair]);
  return sendAll(conn, signer, txs, extra, onSent);
}

export const explorer = (kind: 'tx' | 'address', id: string, cluster: 'devnet' | 'mainnet' = 'devnet') =>
  `https://solscan.io/${kind === 'tx' ? 'tx' : 'account'}/${id}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
