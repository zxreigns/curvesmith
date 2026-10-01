import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { analyze, buyAtLaunch, fromParams } from '../core/analytics';
import { buildConfig, lpSplit } from '../core/build';
import { publishPreset } from '../core/chain';
import { toJSON, toTypeScript } from '../core/codegen';
import { forkDesign } from '../core/fork';
import { baseDesign, type Design, type FeeMode } from '../core/model';
import { PRESETS } from '../core/presets';
import { CurveChart } from '../components/CurveChart';
import { FeeChart } from '../components/FeeChart';
import { LaunchModal } from '../components/LaunchModal';
import { humanError, Modal, Segmented, Slider, Stat, useToast } from '../components/ui';
import { bpsPct, dur, fmt, fmtPrice, pct, short } from '../lib/format';
import { decodeDesign, encodeDesign, useDesign } from '../lib/useDesign';
import { useWallet } from '../wallet';
import { client, explorer, MAINNET_RPC } from '../core/chain';
import { Connection } from '@solana/web3.js';

const USDC_DEVNET = { symbol: 'USDC', mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 };
const SOLQ = { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9 };

type PanelTab = 'curve' | 'fees' | 'graduation' | 'vesting';

function initialDesign(): { d: Design; key: string } {
  const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const shared = q.get('d') && decodeDesign(q.get('d')!);
  if (shared) return { d: shared, key: 'custom' };
  const p = PRESETS.find((x) => x.key === (q.get('preset') || 'fast')) || PRESETS[1];
  return { d: structuredClone(p.design), key: p.key };
}

export function Studio({ forkConfig, forkCluster }: { forkConfig?: string; forkCluster?: 'mainnet' | 'devnet' }) {
  const init = useMemo(initialDesign, []);
  const { design, morphTo, patch, setDesign } = useDesign(init.d);
  const [active, setActive] = useState(init.key);
  const [tab, setTab] = useState<PanelTab>('curve');
  const [snipe, setSnipe] = useState(5);
  const [exportOpen, setExportOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const toast = useToast();
  const { connection } = useWallet();

  // fork an on-chain config (from the Atlas or the market) straight into the studio
  useEffect(() => {
    if (!forkConfig) return;
    const conn = forkCluster === 'mainnet' ? new Connection(MAINNET_RPC, 'confirmed') : connection;
    const name = new URLSearchParams(window.location.hash.split('?')[1] || '').get('name') || 'Forked curve';
    client(conn)
      .state.getPoolConfig(forkConfig)
      .then((pc) => {
        if (!pc) throw new Error('Config not found');
        const quote = pc.quoteMint.toBase58() === SOLQ.mint ? SOLQ : { symbol: 'QUOTE', mint: pc.quoteMint.toBase58(), decimals: 6 };
        const d = forkDesign(pc, quote, `${name} (fork)`);
        morphTo(d, 700);
        setActive('custom');
        toast.push({ kind: 'ok', title: `Forked ${name}`, body: `Loaded config ${short(forkConfig)} from ${forkCluster ?? 'devnet'}. Tweak it and forge your own.` });
      })
      .catch((e) => toast.push({ kind: 'err', title: 'Could not fork that config', body: humanError(e) }));
  }, [forkConfig]); // eslint-disable-line

  const deferred = useDeferredValue(design);
  const built = useMemo(() => buildConfig(deferred), [deferred]);
  const a = useMemo(() => (built.config ? analyze(fromParams(built.config, deferred)) : null), [built, deferred]);
  const [lastGood, setLastGood] = useState(a);
  useEffect(() => {
    if (a) setLastGood(a);
  }, [a]);
  const view = a ?? lastGood;
  const q = design.quote.symbol;

  const pickPreset = (k: string) => {
    const p = PRESETS.find((x) => x.key === k)!;
    setActive(k);
    morphTo({ ...structuredClone(p.design), quote: design.quote.symbol === 'SOL' || k === 'band' ? p.design.quote : design.quote });
  };

  const sniper = view ? buyAtLaunch(view, snipe, design.fees.mode === 'rateLimiter' ? Math.min(9900, design.fees.endBps + Math.floor(snipe / design.fees.rlReferenceAmount) * design.fees.rlIncrementBps) : design.fees.startBps) : null;
  const patient = view ? buyAtLaunch(view, snipe, design.fees.endBps) : null;
  const split = lpSplit(design);

  const share = async () => {
    const url = `${window.location.origin}/#/?d=${encodeDesign(design)}`;
    await navigator.clipboard?.writeText(url);
    toast.push({ kind: 'ok', title: 'Share link copied', body: 'Anyone opening it lands on this exact curve.' });
  };

  return (
    <div className="studio">
      <section className="hero">
        <div>
          <h1>
            Shape the curve. <span className="grad-text">Forge the config.</span>
          </h1>
          <p className="lede">
            Curvesmith is a studio for Meteora’s Dynamic Bonding Curve. Sculpt liquidity, tune anti-snipe fees and the DAMM v2 graduation, see exactly what the program will do, then publish it on-chain as a preset anyone can launch on, and earn on every trade.
          </p>
        </div>
      </section>

      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.key} className={`preset ${active === p.key ? 'on' : ''}`} onClick={() => pickPreset(p.key)} title={p.why}>
            <MiniShape weights={p.design.weights} />
            <div>
              <div className="preset-name">{p.name}</div>
              <div className="preset-tag">{p.tagline}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="studio-grid">
        <div className="card chart-card">
          <div className="name-row">
            <input className="design-name" value={design.name} onChange={(e) => patch((d) => void (d.name = e.target.value))} aria-label="Preset name" />
            <div className="row gap">
              <button className="btn ghost sm" onClick={share}>
                Share
              </button>
              <button className="btn ghost sm" onClick={() => setExportOpen(true)}>
                Export code
              </button>
            </div>
          </div>
          {view && (
            <>
              <div className="stats">
                <Stat label="Starts at" value={`${fmt(view.startMcap)} ${q}`} sub={`price ${fmtPrice(view.startPrice)}`} />
                <Stat label="Graduates at" value={`${fmt(view.gradMcap)} ${q}`} sub={`${view.priceMultiple.toFixed(1)}× from launch`} />
                <Stat label="Raise to graduate" value={`${fmt(view.quoteToGraduate)} ${q}`} sub="collected by the curve" accent />
                <Stat label="Sold on the curve" value={pct(view.curveSupplyPct)} sub={`${pct(view.dammBasePct)} seeds DAMM v2`} />
              </div>
              <CurveChart
                a={view}
                quote={q}
                weights={design.weights}
                onWeights={(w) => {
                  setActive('custom');
                  patch((d) => void (d.weights = w));
                }}
              />
              <SupplyBar a={view} />
            </>
          )}
        </div>

        <div className="side">
          <div className="card">
            <div className="tabs">
              {(['curve', 'fees', 'graduation', 'vesting'] as PanelTab[]).map((t) => (
                <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {t === 'fees' ? 'Anti-snipe' : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {tab === 'curve' && (
              <div className="panel">
                <Segmented
                  value={design.quote.symbol}
                  options={[
                    { v: 'SOL', label: 'SOL pair' },
                    { v: 'USDC', label: 'USDC pair' },
                  ]}
                  onChange={(v) => patch((d) => void (d.quote = v === 'SOL' ? SOLQ : USDC_DEVNET))}
                />
                <Slider label="Launch market cap" value={design.initialMarketCap} min={0.5} max={design.quote.symbol === 'SOL' ? 5000 : 500000} log onChange={(v) => patch((d) => void (d.initialMarketCap = v))} format={(v) => `${fmt(v)} ${q}`} />
                <Slider label="Graduation market cap" value={design.migrationMarketCap} min={Math.max(1, design.initialMarketCap * 1.5)} max={design.quote.symbol === 'SOL' ? 50000 : 5000000} log onChange={(v) => patch((d) => void (d.migrationMarketCap = v))} format={(v) => `${fmt(v)} ${q}`} hint="When the curve reaches this, it migrates into a DAMM v2 pool" />
                <Slider label="Total supply" value={design.totalSupply} min={1_000_000} max={10_000_000_000} log onChange={(v) => patch((d) => void (d.totalSupply = Math.round(v)))} format={(v) => fmt(v, 1)} />
                <div className="hint">Liquidity shape: drag the bars under the chart, or start from a preset above.</div>
              </div>
            )}

            {tab === 'fees' && (
              <div className="panel">
                <Segmented<FeeMode>
                  value={design.fees.mode}
                  options={[
                    { v: 'exponential', label: 'Exp. decay' },
                    { v: 'linear', label: 'Linear decay' },
                    { v: 'rateLimiter', label: 'Rate limiter' },
                  ]}
                  onChange={(v) =>
                    patch((d) => {
                      d.fees.mode = v;
                      if (v === 'rateLimiter') d.fees.durationSec = Math.min(d.fees.durationSec, 43200);
                    })
                  }
                />
                {design.fees.mode !== 'rateLimiter' ? (
                  <>
                    <Slider label="Fee at launch" value={design.fees.startBps} min={design.fees.endBps} max={9900} step={25} onChange={(v) => patch((d) => void (d.fees.startBps = v))} format={bpsPct} />
                    <Slider label="Settles to" value={design.fees.endBps} min={25} max={Math.min(1000, design.fees.startBps)} step={5} onChange={(v) => patch((d) => void (d.fees.endBps = v))} format={bpsPct} />
                    <Slider
                      label="Decay window"
                      value={design.fees.durationSec}
                      min={design.fees.periods}
                      max={86400}
                      log
                      onChange={(v) => patch((d) => void (d.fees.durationSec = Math.max(d.fees.periods, Math.round(v / d.fees.periods) * d.fees.periods)))}
                      format={dur}
                    />
                  </>
                ) : (
                  <>
                    <Slider label="Base fee" value={design.fees.endBps} min={25} max={2000} step={5} onChange={(v) => patch((d) => void ((d.fees.endBps = v), (d.fees.startBps = Math.max(d.fees.startBps, v))))} format={bpsPct} />
                    <Slider label="Extra fee per reference size" value={design.fees.rlIncrementBps} min={1} max={500} onChange={(v) => patch((d) => void (d.fees.rlIncrementBps = v))} format={bpsPct} />
                    <Slider label="Reference size" value={design.fees.rlReferenceAmount} min={0.05} max={1000} log onChange={(v) => patch((d) => void (d.fees.rlReferenceAmount = v))} format={(v) => `${fmt(v)} ${q}`} />
                    <Slider label="Active for" value={design.fees.durationSec} min={10} max={43200} log onChange={(v) => patch((d) => void (d.fees.durationSec = Math.round(v)))} format={dur} />
                  </>
                )}
                <FeeChart d={design} />
                <div className="sniper">
                  <div className="sniper-head">
                    <span>Sniper check</span>
                    <span className="inline">
                      a bot buys
                      <input type="number" min={0.1} step={0.5} value={snipe} onChange={(e) => setSnipe(Math.max(0.01, +e.target.value))} />
                      {q} at launch
                    </span>
                  </div>
                  {sniper && patient && (
                    <div className="sniper-body">
                      <div>
                        pays <b className="hot">{fmt(sniper.feePaid)} {q}</b> in fees and gets <b>{pct(sniper.supplyPct, 2)}</b> of supply
                      </div>
                      <div className="muted">
                        the same buy after the schedule pays {fmt(patient.feePaid)} {q} and gets {pct(patient.supplyPct, 2)}
                      </div>
                    </div>
                  )}
                </div>
                <label className="check">
                  <input type="checkbox" checked={design.fees.dynamicFee} onChange={(e) => patch((d) => void (d.fees.dynamicFee = e.target.checked))} />
                  Dynamic fee: add a volatility surcharge on top
                </label>
                <Slider label="Creator’s share of trading fees" value={design.fees.creatorSharePct} min={0} max={100} onChange={(v) => patch((d) => void (d.fees.creatorSharePct = v))} format={(v) => `${v}% creator · ${100 - v}% preset author`} />
              </div>
            )}

            {tab === 'graduation' && (
              <div className="panel">
                <div className="field-label">DAMM v2 pool fee after graduation</div>
                <Segmented
                  value={design.migration.feeTierBps}
                  options={[25, 30, 100, 200, 400, 600].map((v) => ({ v: v as Design['migration']['feeTierBps'], label: bpsPct(v) }))}
                  onChange={(v) => patch((d) => void (d.migration.feeTierBps = v))}
                />
                <Slider label="Graduated LP to preset author" value={design.migration.partnerLpPct} min={0} max={100} onChange={(v) => patch((d) => void (d.migration.partnerLpPct = v))} format={(v) => `${v}% author · ${100 - v}% creator`} />
                <Slider label="LP locked forever" value={design.migration.lockedLpPct} min={10} max={100} onChange={(v) => patch((d) => void (d.migration.lockedLpPct = v))} format={(v) => `${v}%`} hint="The program requires at least 10% of graduated liquidity to stay locked" />
                <div className="lp-split">
                  <LpChip label="Author, locked" v={split.partnerPermanentLockedLiquidityPercentage} c="#ff7a3d" />
                  <LpChip label="Author, claimable" v={split.partnerLiquidityPercentage} c="#ffb547" />
                  <LpChip label="Creator, locked" v={split.creatorPermanentLockedLiquidityPercentage} c="#4fc3ff" />
                  <LpChip label="Creator, claimable" v={split.creatorLiquidityPercentage} c="#9be7ff" />
                </div>
                {view && (
                  <div className="hint">
                    At graduation, {fmt(view.dammQuote)} {q} and {pct(view.dammBasePct)} of supply seed a DAMM v2 pool at {fmtPrice(view.gradPrice)} {q}, the curve’s final price, so there is no gap for arbitrage.
                  </div>
                )}
              </div>
            )}

            {tab === 'vesting' && (
              <div className="panel">
                <Slider label="Creator allocation, vested" value={design.vesting.lockedAmount} min={0} max={design.totalSupply * 0.3} step={design.totalSupply / 1000} onChange={(v) => patch((d) => void (d.vesting.lockedAmount = Math.round(v)))} format={(v) => (v ? `${fmt(v, 1)} (${pct((v / design.totalSupply) * 100)})` : 'none (fair launch)')} />
                {design.vesting.lockedAmount > 0 && (
                  <>
                    <Slider label="Cliff after graduation" value={design.vesting.cliffDays} min={0} max={365} onChange={(v) => patch((d) => void (d.vesting.cliffDays = v))} format={(v) => `${v} days`} />
                    <Slider label="Then vests over" value={design.vesting.vestDays} min={1} max={730} onChange={(v) => patch((d) => void (d.vesting.vestDays = v))} format={(v) => `${v} days`} />
                  </>
                )}
                <div className="hint">Vested tokens sit in Meteora’s locker, created automatically when the pool graduates.</div>
              </div>
            )}
          </div>

          <div className={`card health ${built.error ? 'bad' : 'good'}`}>
            {built.error ? (
              <>
                <div className="health-title">✕ The program would reject this</div>
                <div className="health-body">{built.error}</div>
              </>
            ) : (
              <>
                <div className="health-title">✓ Valid DBC config</div>
                <ul className="health-list">
                  <li>passes the SDK’s program-rule validator</li>
                  <li>
                    {design.fees.mode === 'rateLimiter'
                      ? `rate limiter active for ${dur(design.fees.durationSec)}`
                      : `anti-snipe: ${bpsPct(design.fees.startBps)} → ${bpsPct(design.fees.endBps)} over ${dur(design.fees.durationSec)}`}
                  </li>
                  <li>{design.migration.lockedLpPct}% of graduated LP locked forever</li>
                  <li>graduates into DAMM v2 at a {bpsPct(design.migration.feeTierBps)} fee tier</li>
                </ul>
              </>
            )}
            <button className="btn primary block lg" disabled={!!built.error} onClick={() => setPublishOpen(true)}>
              Forge preset on devnet
            </button>
            <div className="micro">Creates the on-chain DBC config with you as fee claimer, and lists it in the market.</div>
          </div>
        </div>
      </div>

      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} d={design} />
      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} d={design} onReset={() => setDesign(baseDesign())} />
    </div>
  );
}

function LpChip({ label, v, c }: { label: string; v: number; c: string }) {
  return (
    <div className="lp-chip">
      <span className="dot" style={{ background: c }} />
      <span>{label}</span>
      <b>{v}%</b>
    </div>
  );
}

export function MiniShape({ weights, w = 44, h = 26 }: { weights: number[]; w?: number; h?: number }) {
  const max = Math.max(...weights);
  const bw = w / weights.length;
  return (
    <svg width={w} height={h} className="mini">
      {weights.map((v, i) => (
        <rect key={i} x={i * bw + 0.5} y={h - (v / max) * h} width={bw - 1} height={(v / max) * h} rx={1} />
      ))}
    </svg>
  );
}

function SupplyBar({ a }: { a: NonNullable<ReturnType<typeof analyze>> }) {
  const parts = [
    { k: 'Bonding curve', v: a.curveSupplyPct, c: 'var(--hot)' },
    { k: 'DAMM v2 liquidity', v: a.dammBasePct, c: 'var(--cool)' },
    { k: 'Vested to creator', v: a.vestPct, c: '#b18cff' },
    { k: 'Leftover', v: a.leftoverPct, c: '#3a302c' },
  ].filter((p) => p.v > 0.05);
  return (
    <div className="supply">
      <div className="supply-bar">
        {parts.map((p) => (
          <div key={p.k} style={{ width: `${p.v}%`, background: p.c }} title={`${p.k}: ${p.v.toFixed(2)}%`} />
        ))}
      </div>
      <div className="supply-legend">
        {parts.map((p) => (
          <span key={p.k}>
            <i style={{ background: p.c }} />
            {p.k} <b>{p.v.toFixed(1)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function ExportModal({ open, onClose, d }: { open: boolean; onClose: () => void; d: Design }) {
  const [fmtTab, setFmtTab] = useState<'ts' | 'json'>('ts');
  const text = fmtTab === 'ts' ? toTypeScript(d) : toJSON(d);
  const [copied, setCopied] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Export this curve" wide>
      <div className="row between">
        <Segmented value={fmtTab} options={[{ v: 'ts', label: 'TypeScript (DBC SDK)' }, { v: 'json', label: 'Preset JSON' }]} onChange={setFmtTab} />
        <button
          className="btn sm"
          onClick={async () => {
            await navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <pre className="code">{text}</pre>
    </Modal>
  );
}

function PublishModal({ open, onClose, d }: { open: boolean; onClose: () => void; d: Design; onReset: () => void }) {
  const { connection, signer, setPickerOpen, refreshBalance, balance } = useWallet();
  const toast = useToast();
  const [tagline, setTagline] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ config: string; sigs: string[] } | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);

  const go = async () => {
    if (!signer) return setPickerOpen(true);
    const built = buildConfig(d);
    if (!built.config) return;
    setBusy(true);
    const t = toast.push({ kind: 'pending', title: `Forging “${d.name}”`, body: 'Approve 2 transactions: the config, and its market listing.' });
    try {
      const res = await publishPreset(
        connection,
        signer,
        built.config,
        new PublicKey(d.quote.mint),
        { v: 1, name: d.name.slice(0, 40), tagline: tagline.slice(0, 80), design: compactDesign(d) },
        (sig, i) => toast.update(t, { body: i === 0 ? 'Config created, listing it…' : 'Listing confirmed', sig }),
      );
      setDone({ config: res.config.toBase58(), sigs: res.sigs });
      toast.update(t, { kind: 'ok', title: 'Preset forged on devnet', body: short(res.config.toBase58(), 6), sig: res.sigs[0] });
      refreshBalance();
    } catch (e) {
      toast.update(t, { kind: 'err', title: 'Publishing failed', body: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open && !launchOpen} onClose={() => (setDone(null), onClose())} title={done ? 'Forged ✓' : `Forge “${d.name}” on devnet`}>
        {!done ? (
          <>
            <p className="muted small">
              This creates a Meteora DBC config account with this exact curve. You are the fee claimer: every token launched on it pays you the partner share of its trading fees, and part of the graduated LP. That is the marketplace: presets earn while they are used.
            </p>
            <div className="form">
              <label>
                One-line pitch for the market
                <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Deep community zone, fast finish" maxLength={80} />
              </label>
            </div>
            {signer && balance !== null && balance < 0.05 && <div className="warn">Your wallet has {balance.toFixed(3)} devnet SOL. Publishing costs about 0.01 SOL. Top up first.</div>}
            <button className="btn primary block" disabled={busy} onClick={go}>
              {signer ? (busy ? 'Forging…' : 'Sign and publish') : 'Connect a wallet'}
            </button>
          </>
        ) : (
          <div className="done">
            <div className="done-row">
              <span>Config</span>
              <a href={explorer('address', done.config)} target="_blank" rel="noreferrer">
                {short(done.config, 6)} ↗
              </a>
            </div>
            <div className="done-row">
              <span>Listed in market</span>
              <a href={explorer('tx', done.sigs[1])} target="_blank" rel="noreferrer">
                tx {short(done.sigs[1], 6)} ↗
              </a>
            </div>
            <div className="row gap" style={{ marginTop: 16 }}>
              <button className="btn primary" onClick={() => setLaunchOpen(true)}>
                Launch a token on it
              </button>
              <a className="btn ghost" href={`#/preset/${done.config}`} onClick={onClose}>
                View preset
              </a>
            </div>
          </div>
        )}
      </Modal>
      {done && <LaunchModal open={launchOpen} onClose={() => (setLaunchOpen(false), onClose(), setDone(null))} config={done.config} presetName={d.name} quoteSymbol={d.quote.symbol} />}
    </>
  );
}

/** Keep memos small: the weights rounded and the knobs that matter. */
export function compactDesign(d: Design): Partial<Design> {
  return {
    weights: d.weights.map((w) => Number(w.toFixed(2))),
    initialMarketCap: Number(d.initialMarketCap.toPrecision(4)),
    migrationMarketCap: Number(d.migrationMarketCap.toPrecision(4)),
    totalSupply: d.totalSupply,
    quote: { ...d.quote, mint: d.quote.symbol === 'SOL' ? 'SOL' : d.quote.mint },
  } as Partial<Design>;
}
