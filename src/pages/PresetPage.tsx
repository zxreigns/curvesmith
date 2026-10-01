import { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '../wallet';
import { client, explorer } from '../core/chain';
import { analyzePool, feeSummary } from '../core/fork';
import { CurveChart } from '../components/CurveChart';
import { LaunchModal } from '../components/LaunchModal';
import { Stat } from '../components/ui';
import { loadMarket, useAsync } from '../lib/data';
import { tokenMetas, avatarUrl } from '../lib/token';
import { bpsPct, dur, fmt, fmtPrice, pct, short } from '../lib/format';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export function PresetPage({ config }: { config: string }) {
  const { connection } = useWallet();
  const [launch, setLaunch] = useState(false);
  const info = useAsync(async () => {
    const c = client(connection);
    const key = new PublicKey(config);
    const [pc, market] = await Promise.all([c.state.getPoolConfig(key), loadMarket(connection).catch(() => [])]);
    if (!pc) throw new Error('No DBC config at this address on devnet');
    const entry = market.find((m) => m.config === config);
    const isSol = pc.quoteMint.toBase58() === SOL_MINT;
    return { pc, entry, isSol, a: analyzePool(pc, isSol ? 9 : 6) };
  }, [config]);
  const launches = useAsync(async () => {
    const c = client(connection);
    const pools = await c.state.getPoolsByConfig(config);
    const metas = await tokenMetas(connection, pools.map((p) => p.account.poolState.baseMint));
    let fees: { pool: string; partner: number }[] = [];
    try {
      const f = await c.state.getPoolsFeesByConfig(config);
      fees = f.map((x) => ({ pool: x.poolAddress.toBase58(), partner: Number(x.partnerQuoteFee.toString()) }));
    } catch {
      /* optional */
    }
    return pools.map((p, i) => ({
      address: p.publicKey.toBase58(),
      mint: p.account.poolState.baseMint.toBase58(),
      meta: metas[i],
      quote: Number(p.account.poolState.quoteReserve.toString()),
      migrated: p.account.poolState.isMigrated === 1,
      partnerFee: fees.find((x) => x.pool === p.publicKey.toBase58())?.partner ?? 0,
    }));
  }, [config]);

  if (info.loading && !info.data) return <div className="page"><div className="card skeleton tall" /></div>;
  if (info.error || !info.data) return <div className="page"><div className="card warn">{info.error}</div></div>;
  const { pc, entry, isSol, a } = info.data;
  const q = isSol ? 'SOL' : 'USDC';
  const qd = isSol ? 1e9 : 1e6;
  const f = feeSummary(pc);
  const thr = Number(pc.migrationQuoteThreshold.toString());
  const earned = (launches.data ?? []).reduce((s, l) => s + l.partnerFee, 0) / qd;
  const name = entry?.meta.name ?? 'Unlisted DBC config';

  return (
    <div className="page">
      <a className="back" href="#/market">
        ← Market
      </a>
      <div className="page-head">
        <div>
          <h2>{name}</h2>
          <p className="muted">{entry?.meta.tagline || 'A Meteora DBC config on devnet.'}</p>
          <div className="addr-row">
            <a href={explorer('address', config)} target="_blank" rel="noreferrer">
              config {short(config, 6)} ↗
            </a>
            {entry && <span>author {short(entry.author)}</span>}
          </div>
        </div>
        <div className="row gap">
          <a className="btn ghost" href={`#/fork/${config}?name=${encodeURIComponent(name)}`}>
            Fork in Studio
          </a>
          <button className="btn primary" onClick={() => setLaunch(true)}>
            Launch a token on it
          </button>
        </div>
      </div>
      <div className="studio-grid">
        <div className="card chart-card">
          <div className="stats">
            <Stat label="Starts at" value={`${fmt(a.startMcap)} ${q}`} sub={`price ${fmtPrice(a.startPrice)}`} />
            <Stat label="Graduates at" value={`${fmt(a.gradMcap)} ${q}`} sub={`${a.priceMultiple.toFixed(1)}×`} />
            <Stat label="Raise to graduate" value={`${fmt(thr / qd)} ${q}`} accent />
            <Stat label="Author earned" value={`${fmt(earned)} ${q}`} sub={`across ${launches.data?.length ?? '…'} launches`} />
          </div>
          <CurveChart a={a} quote={q} />
        </div>
        <div className="side">
          <div className="card spec">
            <h4>Spec, read from chain</h4>
            <dl>
              <dt>Anti-snipe</dt>
              <dd>{f.mode === 'rateLimiter' ? `rate limiter, ${bpsPct(f.startBps)} base +${bpsPct(f.incBps)} per size step, ${dur(f.durationSec)}` : `${bpsPct(f.startBps)} → ${bpsPct(f.endBps)} ${f.mode}, ${dur(f.durationSec)}`}</dd>
              <dt>Dynamic fee</dt>
              <dd>{pc.poolFees.dynamicFee.initialized ? 'on' : 'off'}</dd>
              <dt>Fee split</dt>
              <dd>{pc.creatorTradingFeePercentage}% creator · {100 - pc.creatorTradingFeePercentage}% author</dd>
              <dt>Graduates to</dt>
              <dd>DAMM v2 · {bpsPct([25, 30, 100, 200, 400, 600][pc.migrationFeeOption] ?? 0)} pool</dd>
              <dt>LP locked</dt>
              <dd>{pc.partnerPermanentLockedLiquidityPercentage + pc.creatorPermanentLockedLiquidityPercentage}%</dd>
              <dt>Supply on curve</dt>
              <dd>{pct(a.curveSupplyPct)}</dd>
            </dl>
          </div>
          <div className="card">
            <h4>Tokens launched on it</h4>
            {launches.loading && !launches.data && <div className="muted small">Reading pools…</div>}
            {launches.data && launches.data.length === 0 && <div className="muted small">None yet. Launch the first one.</div>}
            <div className="launch-list">
              {(launches.data ?? []).map((l) => (
                <a key={l.address} className="launch-row" href={`#/pool/${l.address}`}>
                  <img src={avatarUrl(l.meta?.symbol ?? '?')} alt="" width={28} height={28} />
                  <div className="lr-main">
                    <b>{l.meta?.name ?? short(l.mint)}</b>
                    <span className="muted">${l.meta?.symbol ?? ''}</span>
                  </div>
                  {l.migrated ? <span className="pill cool">graduated</span> : <span className="lr-prog">{Math.min(100, (l.quote / thr) * 100).toFixed(0)}%</span>}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
      <LaunchModal open={launch} onClose={() => setLaunch(false)} config={config} presetName={name} quoteSymbol={q} />
    </div>
  );
}
