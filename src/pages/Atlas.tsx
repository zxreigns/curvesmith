import { useState } from 'react';
import { useAsync } from '../lib/data';
import { bpsPct, dur, fmt, short } from '../lib/format';
import { explorer } from '../core/chain';

interface Launchpad {
  name: string;
  website: string;
  logo: string;
  feeClaimer: string;
  configCount: number;
  sampled: number;
  distinctCurves: number;
  config: string;
  poolsOnConfig: number;
  quote: string;
  startMcap: number;
  gradMcap: number;
  raise: number;
  multiple: number;
  curveSupplyPct: number;
  segments: number;
  fee: { mode: string; startBps: number; endBps: number; durationSec: number; incBps: number };
  dynamicFee: boolean;
  creatorFeePct: number;
  migration: string;
  lockedLpPct: number;
  samples: [number, number][];
}
interface Snapshot {
  generatedAt: string;
  namedLaunchpads: number;
  totalConfigsOfNamed: number;
  insights: Record<string, number>;
  launchpads: Launchpad[];
}

function MiniCurve({ s }: { s: [number, number][] }) {
  const w = 160;
  const h = 46;
  const mx = s[s.length - 1]?.[0] || 1;
  const my = Math.max(...s.map((p) => p[1])) || 1;
  const d = s.map(([x, y], i) => `${i ? 'L' : 'M'}${((x / mx) * (w - 4) + 2).toFixed(1)},${(h - 3 - (y / my) * (h - 8)).toFixed(1)}`).join('');
  return (
    <svg width={w} height={h} className="spark">
      <path d={`${d}L${w - 2},${h}L2,${h}Z`} className="spark-fill" />
      <path d={d} className="spark-line" />
    </svg>
  );
}

const feeText = (f: Launchpad['fee']) =>
  f.mode === 'rateLimiter' ? `rate limiter ${bpsPct(f.startBps)} +${bpsPct(f.incBps)}` : f.startBps > f.endBps + 1 ? `${bpsPct(f.startBps)} → ${bpsPct(f.endBps)} in ${dur(f.durationSec)}` : `flat ${bpsPct(f.startBps)}`;

export function Atlas() {
  const { data, error, loading } = useAsync<Snapshot>(() => fetch('/atlas.json').then((r) => r.json()), []);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Launchpad Atlas</h2>
          <p className="muted">
            How the launchpads built on Meteora DBC actually shape their curves, read straight from mainnet. Every row is a real config: open it, compare it, fork it into the Studio and improve on it.
          </p>
        </div>
      </div>
      {loading && <div className="card skeleton tall" />}
      {error && <div className="card warn">Atlas snapshot unavailable: {error}</div>}
      {data && (
        <>
          <div className="insights">
            <div className="insight">
              <b>{data.namedLaunchpads}</b>
              <span>named launchpads on DBC</span>
            </div>
            <div className="insight">
              <b>{fmt(data.totalConfigsOfNamed, 1)}</b>
              <span>configs they created</span>
            </div>
            <div className="insight">
              <b>{Math.round(data.insights.dammV2Share * 100)}%</b>
              <span>of the top {data.launchpads.length} graduate to DAMM v2</span>
            </div>
            <div className="insight">
              <b>{Math.round(data.insights.medianRaiseSol)} SOL</b>
              <span>median raise to graduate</span>
            </div>
            <div className="insight">
              <b>{Math.round(data.insights.twoSegmentShare * 100)}%</b>
              <span>use a 1–2 segment curve. DBC allows 16.</span>
            </div>
          </div>
          <div className="atlas">
            <div className="atlas-row atlas-headrow">
              <span>Launchpad</span>
              <span>Curve</span>
              <span>Market cap</span>
              <span>Anti-snipe</span>
              <span>Graduation</span>
              <span />
            </div>
            {data.launchpads.map((l) => (
              <div key={l.config} className="atlas-row">
                <div className="lp-id">
                  <LpLogo name={l.name} logo={l.logo} />
                  <div>
                    <b>{l.name}</b>
                    <span className="muted small">
                      {l.configCount.toLocaleString('en-US')} configs · {l.distinctCurves} curve{l.distinctCurves > 1 ? 's' : ''} in sample
                    </span>
                  </div>
                </div>
                <div>
                  <MiniCurve s={l.samples} />
                  <span className="muted small">{l.segments} segment{l.segments > 1 ? 's' : ''}</span>
                </div>
                <div>
                  <b>
                    {fmt(l.startMcap)} → {fmt(l.gradMcap)}
                  </b>{' '}
                  <span className="muted">{l.quote}</span>
                  <div className="muted small">
                    raise {fmt(l.raise)} {l.quote} · {l.multiple.toFixed(0)}×
                  </div>
                </div>
                <div>
                  <span>{feeText(l.fee)}</span>
                  <div className="muted small">{l.dynamicFee ? 'dynamic fee on' : 'no dynamic fee'}</div>
                </div>
                <div>
                  <span className={`pill ${l.migration === 'DAMM v2' ? 'cool' : ''}`}>{l.migration}</span>
                  <div className="muted small">{l.lockedLpPct}% LP locked</div>
                </div>
                <div className="row gap">
                  <a className="btn ghost sm" href={explorer('address', l.config, 'mainnet')} target="_blank" rel="noreferrer" title={l.config}>
                    {short(l.config)}
                  </a>
                  <a className="btn sm" href={`#/fork/${l.config}?cluster=mainnet&name=${encodeURIComponent(l.name)}`}>
                    Fork
                  </a>
                </div>
              </div>
            ))}
          </div>
          <p className="micro">
            Snapshot {new Date(data.generatedAt).toUTCString()}. Regenerate with <code>npm run atlas</code>. The representative curve is the most common one in a sample of each launchpad’s configs.
          </p>
        </>
      )}
    </div>
  );
}

function LpLogo({ name, logo }: { name: string; logo: string }) {
  const [broken, setBroken] = useState(!logo);
  if (broken) return <span className="lp-ph">{name.trim()[0]?.toUpperCase()}</span>;
  return <img src={logo} alt="" width={34} height={34} loading="lazy" onError={() => setBroken(true)} />;
}
