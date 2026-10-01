import { useMemo, useRef, useState } from 'react';
import type { Analysis } from '../core/analytics';
import { fmt, fmtPrice } from '../lib/format';
import { niceTicks, useSize } from './useSize';

interface Props {
  a: Analysis;
  quote: string;
  weights?: number[];
  onWeights?: (w: number[]) => void;
  /** current position on the curve (pool page), in % of supply sold */
  marker?: number | null;
  height?: number;
  compact?: boolean;
}

const PAD = { l: 58, r: 18, t: 18, b: 30 };

export function CurveChart({ a, quote, weights, onWeights, marker, height = 320, compact }: Props) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const width = Math.max(320, w);
  const iw = width - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const maxX = Math.max(1, a.curveSupplyPct);
  const maxY = a.gradMcap * 1.08;
  const x = (v: number) => PAD.l + (v / maxX) * iw;
  const y = (v: number) => PAD.t + ih - (v / maxY) * ih;

  const path = useMemo(() => a.samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.basePct).toFixed(1)},${y(s.mcap).toFixed(1)}`).join(''), [a, width, height]); // eslint-disable-line
  const area = `${path}L${x(a.samples[a.samples.length - 1].basePct)},${y(0)}L${x(0)},${y(0)}Z`;
  const yTicks = niceTicks(maxY, compact ? 3 : 4);
  const xTicks = niceTicks(maxX, compact ? 3 : 5);

  // segment bands, alternating shade, so the 16 ranges are visible on the curve itself
  let acc = 0;
  const bands = a.segments.map((s) => {
    const x0 = acc;
    acc += (s.base / (a.samples.length ? 1 : 1)) || 0;
    return { x0, s };
  });
  const supplyTokens = a.samples.length ? a.curveSupplyPct : 1;
  const totalBase = a.segments.reduce((t, s) => t + s.base, 0) || 1;

  const hs = hover != null ? a.samples[hover] : null;
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const v = ((e.clientX - r.left) / r.width) * maxX;
    let best = 0;
    for (let i = 0; i < a.samples.length; i++) if (Math.abs(a.samples[i].basePct - v) < Math.abs(a.samples[best].basePct - v)) best = i;
    setHover(best);
  };

  const mk = marker != null ? a.samples.reduce((b, s) => (Math.abs(s.basePct - marker) < Math.abs(b.basePct - marker) ? s : b), a.samples[0]) : null;

  return (
    <div className="curve" ref={ref}>
      <svg width={width} height={height} className="curve-svg">
        <defs>
          <linearGradient id="cs-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff7a3d" stopOpacity="0.38" />
            <stop offset="1" stopColor="#ff7a3d" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cs-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ff5f2e" />
            <stop offset="1" stopColor="#ffc24b" />
          </linearGradient>
          <filter id="cs-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {bands.map(({ x0, s }, i) => {
          const a0 = (x0 / totalBase) * supplyTokens;
          const a1 = ((x0 + s.base) / totalBase) * supplyTokens;
          return i % 2 ? <rect key={i} x={x(a0)} y={PAD.t} width={Math.max(0, x(a1) - x(a0))} height={ih} className="band" /> : null;
        })}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 8} y={y(t) + 4} className="tick" textAnchor="end">
              {fmt(t, 1)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={height - 8} className="tick" textAnchor="middle">
            {t.toFixed(0)}%
          </text>
        ))}
        <text x={PAD.l} y={12} className="axis-label">
          market cap ({quote})
        </text>
        {!compact && (
          <text x={width - PAD.r} y={height - 8} className="axis-label" textAnchor="end" dy="-14">
            supply sold on the curve →
          </text>
        )}
        <path d={area} fill="url(#cs-fill)" />
        <path d={path} fill="none" stroke="url(#cs-line)" strokeWidth={compact ? 2 : 3} filter={compact ? undefined : 'url(#cs-glow)'} />
        {/* graduation marker */}
        <g transform={`translate(${x(a.curveSupplyPct)},${y(a.gradMcap)})`}>
          <circle r={compact ? 4 : 7} className="grad-dot" />
          {!compact && (
            <text x={-10} y={-14} textAnchor="end" className="grad-label">
              graduates → DAMM v2 · {fmt(a.gradMcap)} {quote}
            </text>
          )}
        </g>
        {mk && (
          <g transform={`translate(${x(mk.basePct)},${y(mk.mcap)})`}>
            <circle r={14} className="pos-pulse" />
            <circle r={6} className="pos-dot" />
          </g>
        )}
        {hs && (
          <g>
            <line x1={x(hs.basePct)} x2={x(hs.basePct)} y1={PAD.t} y2={PAD.t + ih} className="cross" />
            <circle cx={x(hs.basePct)} cy={y(hs.mcap)} r={5} className="hover-dot" />
          </g>
        )}
        <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hs && !compact && (
        <div className="tip" style={{ left: Math.min(width - 230, Math.max(0, x(hs.basePct) + 12)), top: 24 }}>
          <div>
            <b>{hs.basePct.toFixed(1)}%</b> of supply sold
          </div>
          <div>
            price <b>{fmtPrice(hs.price)}</b> {quote}
          </div>
          <div>
            mcap <b>{fmt(hs.mcap)}</b> {quote}
          </div>
          <div>
            raised <b>{fmt(hs.quote)}</b> {quote}
          </div>
        </div>
      )}
      {weights && onWeights && <ShapeEditor weights={weights} onWeights={onWeights} left={PAD.l} right={PAD.r} />}
    </div>
  );
}

/** 16 draggable liquidity bars: the shape of the curve, sculpted by hand. */
function ShapeEditor({ weights, onWeights, left, right }: { weights: number[]; onWeights: (w: number[]) => void; left: number; right: number }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number } | null>(null);
  const max = Math.max(...weights) * 1.15;
  const H = 86;

  const setFromEvent = (clientX: number, clientY: number, lockIndex?: number) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const i = lockIndex ?? Math.min(weights.length - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * weights.length)));
    const frac = 1 - Math.min(1, Math.max(0.02, (clientY - r.top) / r.height));
    const next = weights.slice();
    next[i] = Math.max(0.05, frac * max);
    onWeights(next);
    return i;
  };

  return (
    <div className="shape" style={{ marginLeft: left, marginRight: right }}>
      <div
        className="shape-bars"
        ref={box}
        style={{ height: H }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const i = setFromEvent(e.clientX, e.clientY);
          drag.current = i == null ? null : { i };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          // sweep across bars while dragging, like painting
          const r = box.current!.getBoundingClientRect();
          const i = Math.min(weights.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * weights.length)));
          setFromEvent(e.clientX, e.clientY, i);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {weights.map((wt, i) => (
          <div key={i} className="shape-col">
            <div className="shape-bar" style={{ height: `${(wt / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="shape-caption">
        <span>liquidity per price range</span>
        <span className="muted">drag to sculpt · 16 ranges, compiled straight into the DBC curve</span>
      </div>
    </div>
  );
}
