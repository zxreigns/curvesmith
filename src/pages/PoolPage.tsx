import { useEffect, useMemo, useState } from 'react';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { deriveDammV2PoolAddress, DAMM_V2_MIGRATION_FEE_ADDRESS } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { useWallet } from '../wallet';
import { explorer, graduate, loadPool, quote, swap, type PoolView, type Quote } from '../core/chain';
import { analyzePool } from '../core/fork';
import { sqrtToPrice } from '../core/analytics';
import { CurveChart } from '../components/CurveChart';
import { humanError, Segmented, Stat, useToast } from '../components/ui';
import { tokenMetas, avatarUrl, type TokenMeta } from '../lib/token';
import { fmt, fmtPrice, short } from '../lib/format';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export function PoolPage({ address }: { address: string }) {
  const { connection, signer, setPickerOpen, refreshBalance } = useWallet();
  const toast = useToast();
  const [v, setV] = useState<PoolView | null>(null);
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('0.25');
  const [q, setQ] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenBal, setTokenBal] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const [activity, setActivity] = useState<{ sig: string; time: number | null }[]>([]);

  const key = useMemo(() => new PublicKey(address), [address]);
  const refresh = async () => {
    try {
      const nv = await loadPool(connection, key);
      if (!nv) throw new Error('No DBC pool at this address on devnet');
      setV(nv);
      if (!meta) setMeta((await tokenMetas(connection, [nv.pool.poolState.baseMint]))[0]);
      const sigs = await connection.getSignaturesForAddress(key, { limit: 12 });
      setActivity(sigs.filter((s) => !s.err).map((s) => ({ sig: s.signature, time: s.blockTime ?? null })));
      if (signer) {
        const accts = await connection.getParsedTokenAccountsByOwner(signer.publicKey, { mint: nv.pool.poolState.baseMint });
        setTokenBal(accts.value.reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0));
      }
    } catch (e) {
      setErr(humanError(e));
    }
  };
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 12_000);
    return () => clearInterval(id);
  }, [address, signer]); // eslint-disable-line

  const isSol = v?.config.quoteMint.toBase58() === SOL_MINT;
  const qd = isSol ? 9 : 6;
  const qs = isSol ? 'SOL' : 'USDC';
  const bd = v?.config.tokenDecimal ?? 6;
  const a = useMemo(() => (v ? analyzePool(v.config, qd) : null), [v?.config, qd]); // eslint-disable-line
  const complete = !!v && v.progress >= 1;
  const migrated = v?.pool.poolState.isMigrated === 1;
  const price = v ? sqrtToPrice(BigInt(v.pool.poolState.sqrtPrice.toString()), bd, qd) : 0;
  const marker = useMemo(() => {
    if (!a || !price) return null;
    const s = a.samples;
    for (let i = 1; i < s.length; i++) if (s[i].price >= price) return s[i - 1].basePct + ((price - s[i - 1].price) / (s[i].price - s[i - 1].price || 1)) * (s[i].basePct - s[i - 1].basePct);
    return s[s.length - 1].basePct;
  }, [a, price]);

  // live exact quote
  useEffect(() => {
    if (!v || complete) return setQ(null);
    const n = parseFloat(amount);
    if (!(n > 0)) return setQ(null);
    const raw = new BN(Math.floor(n * 10 ** (side === 'buy' ? qd : bd)).toString());
    let live = true;
    const t = setTimeout(() => {
      quote(connection, v, raw, side === 'sell')
        .then((r) => live && (setQ(r), setQErr(null)))
        .catch((e) => live && (setQ(null), setQErr(humanError(e))));
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [amount, side, v, complete]); // eslint-disable-line

  const doSwap = async () => {
    if (!signer) return setPickerOpen(true);
    if (!v) return;
    const n = parseFloat(amount);
    setBusy(true);
    const t = toast.push({ kind: 'pending', title: side === 'buy' ? `Buying ${meta?.symbol ?? ''}` : `Selling ${meta?.symbol ?? ''}`, body: 'Approve in your wallet…' });
    try {
      const raw = new BN(Math.floor(n * 10 ** (side === 'buy' ? qd : bd)).toString());
      const r = await swap(connection, signer, v, raw, side === 'sell', 500, (sig) => toast.update(t, { body: 'Confirming…', sig }));
      const got = Number(r.quote.out.toString()) / 10 ** (side === 'buy' ? bd : qd);
      toast.update(t, { kind: 'ok', title: side === 'buy' ? `Bought ${fmt(got)} ${meta?.symbol ?? ''}` : `Sold for ${fmt(got)} ${qs}`, sig: r.sigs[0] });
      await refresh();
      refreshBalance();
    } catch (e) {
      toast.update(t, { kind: 'err', title: 'Swap failed', body: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  const doGraduate = async () => {
    if (!signer) return setPickerOpen(true);
    if (!v) return;
    setBusy(true);
    const t = toast.push({ kind: 'pending', title: 'Graduating into DAMM v2', body: 'Approve in your wallet…' });
    try {
      const sigs = await graduate(connection, signer, v, (sig) => toast.update(t, { body: 'Seeding the DAMM v2 pool…', sig }));
      toast.update(t, { kind: 'ok', title: 'Graduated. Now trading on DAMM v2', sig: sigs[sigs.length - 1] });
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 4200);
      await refresh();
    } catch (e) {
      toast.update(t, { kind: 'err', title: 'Graduation failed', body: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  if (err && !v) return <div className="page"><div className="card warn">{err}</div></div>;
  if (!v || !a) return <div className="page"><div className="card skeleton tall" /></div>;
  const dammPool = deriveDammV2PoolAddress(DAMM_V2_MIGRATION_FEE_ADDRESS[v.config.migrationFeeOption], v.pool.poolState.baseMint, v.config.quoteMint);
  const raised = Number(v.pool.poolState.quoteReserve.toString()) / 10 ** qd;
  const outUnit = side === 'buy' ? meta?.symbol ?? 'tokens' : qs;

  return (
    <div className="page">
      {celebrate && <Confetti />}
      <a className="back" href={`#/preset/${v.pool.poolState.config.toBase58()}`}>
        ← Preset
      </a>
      <div className="page-head">
        <div className="token-head">
          <img src={avatarUrl(meta?.symbol ?? '?')} alt="" width={52} height={52} />
          <div>
            <h2>
              {meta?.name ?? short(v.pool.poolState.baseMint.toBase58())} <span className="muted">${meta?.symbol}</span>
            </h2>
            <div className="addr-row">
              <a href={explorer('address', address)} target="_blank" rel="noreferrer">
                pool {short(address)} ↗
              </a>
              <a href={explorer('address', v.pool.poolState.baseMint.toBase58())} target="_blank" rel="noreferrer">
                mint {short(v.pool.poolState.baseMint.toBase58())} ↗
              </a>
            </div>
          </div>
        </div>
        <div className={`phase ${migrated ? 'cool' : complete ? 'ready' : ''}`}>{migrated ? 'Trading on DAMM v2' : complete ? 'Curve complete' : 'On the bonding curve'}</div>
      </div>

      <div className="progress-wrap">
        <div className="progress">
          <div className={`progress-fill ${migrated ? 'done' : ''}`} style={{ width: `${Math.min(100, v.progress * 100)}%` }} />
        </div>
        <div className="progress-meta">
          <span>
            <b>{fmt(raised)}</b> / {fmt(a.quoteToGraduate)} {qs} raised
          </span>
          <span>{(v.progress * 100).toFixed(1)}% to graduation</span>
        </div>
      </div>

      <div className="studio-grid">
        <div className="card chart-card">
          <div className="stats">
            <Stat label="Price" value={`${fmtPrice(price)} ${qs}`} />
            <Stat label="Market cap" value={`${fmt(price * (a.startMcap / a.startPrice))} ${qs}`} />
            <Stat label="Graduates at" value={`${fmt(a.gradMcap)} ${qs}`} accent />
            <Stat label="You hold" value={signer ? fmt(tokenBal) : '—'} sub={meta?.symbol} />
          </div>
          <CurveChart a={a} quote={qs} marker={migrated ? a.curveSupplyPct : marker} />
        </div>
        <div className="side">
          {migrated ? (
            <div className="card grad-card">
              <div className="grad-big">🎓 Graduated</div>
              <p className="muted small">The curve filled and its liquidity now lives in a Meteora DAMM v2 pool at the curve’s final price, with {v.config.partnerPermanentLockedLiquidityPercentage + v.config.creatorPermanentLockedLiquidityPercentage}% of LP locked forever.</p>
              <a className="btn cool block" href={explorer('address', dammPool.toBase58())} target="_blank" rel="noreferrer">
                View the DAMM v2 pool ↗
              </a>
            </div>
          ) : complete ? (
            <div className="card grad-card ready">
              <div className="grad-big">Curve complete</div>
              <p className="muted small">The graduation threshold is hit. Anyone can now migrate this pool into DAMM v2: it is permissionless, one transaction.</p>
              <button className="btn primary block lg" disabled={busy} onClick={doGraduate}>
                {busy ? 'Graduating…' : 'Graduate to DAMM v2'}
              </button>
            </div>
          ) : (
            <div className="card trade">
              <Segmented value={side} options={[{ v: 'buy', label: 'Buy' }, { v: 'sell', label: 'Sell' }]} onChange={(s) => (setSide(s), setAmount(s === 'buy' ? '0.25' : String(Math.floor(tokenBal / 2) || '')))} />
              <div className="amount">
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" />
                <span>{side === 'buy' ? qs : meta?.symbol}</span>
              </div>
              {side === 'buy' && (
                <div className="quick">
                  {[0.1, 0.5, 1].map((x) => (
                    <button key={x} onClick={() => setAmount(String(x))}>
                      {x}
                    </button>
                  ))}
                  <button onClick={() => setAmount(String(Math.ceil((a.quoteToGraduate - raised) * 1.06 * 1000) / 1000))}>to graduation</button>
                </div>
              )}
              <div className="quote">
                {q ? (
                  <>
                    <div>
                      <span>You receive</span>
                      <b>
                        {fmt(Number(q.out.toString()) / 10 ** (side === 'buy' ? bd : qd))} {outUnit}
                      </b>
                    </div>
                    <div>
                      <span>Fee (live schedule)</span>
                      <span>
                        {fmt(Number(q.fee.toString()) / 10 ** qd)} {qs}
                      </span>
                    </div>
                    {q.left.gtn(0) && side === 'buy' && (
                      <div>
                        <span>Refunded (hits graduation)</span>
                        <span>
                          {fmt(Number(q.left.toString()) / 10 ** qd)} {qs}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="muted small">{qErr ?? 'Exact quote from the program’s own math'}</div>
                )}
              </div>
              <button className="btn primary block lg" disabled={busy || !q} onClick={doSwap}>
                {!signer ? 'Connect a wallet' : busy ? 'Confirming…' : side === 'buy' ? 'Buy' : 'Sell'}
              </button>
            </div>
          )}
          <div className="card">
            <h4>Recent activity</h4>
            <div className="activity">
              {activity.map((x) => (
                <a key={x.sig} href={explorer('tx', x.sig)} target="_blank" rel="noreferrer">
                  <span>{short(x.sig, 6)}</span>
                  <span className="muted">{x.time ? timeAgo(x.time) : ''}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function timeAgo(t: number) {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Confetti() {
  const bits = Array.from({ length: 90 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden>
      {bits.map((i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${(i % 15) * 0.05}s`,
            background: ['#ff5f2e', '#ffc24b', '#5ee1ff', '#fff'][i % 4],
            transform: `rotate(${i * 23}deg)`,
          }}
        />
      ))}
    </div>
  );
}
