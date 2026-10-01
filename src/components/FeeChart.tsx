import type { Design } from '../core/model';
import { feeCurve } from '../core/analytics';
import { bpsPct, dur, fmt } from '../lib/format';
import { useSize } from './useSize';

export function FeeChart({ d, height = 120 }: { d: Design; height?: number }) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const pts = feeCurve(d);
  const width = Math.max(240, w);
  const P = { l: 40, r: 10, t: 10, b: 22 };
  const maxX = pts[pts.length - 1].x || 1;
  const maxY = Math.max(...pts.map((p) => p.bps)) * 1.1 || 1;
  const x = (v: number) => P.l + (v / maxX) * (width - P.l - P.r);
  const y = (v: number) => P.t + (height - P.t - P.b) * (1 - v / maxY);
  const step = d.fees.mode !== 'rateLimiter';
  let path = '';
  pts.forEach((p, i) => {
    if (i === 0) path = `M${x(p.x)},${y(p.bps)}`;
    else path += step ? `H${x(p.x)}V${y(p.bps)}` : `L${x(p.x)},${y(p.bps)}`;
  });
  const rl = d.fees.mode === 'rateLimiter';
  return (
    <div ref={ref} className="feechart">
      <svg width={width} height={height}>
        <defs>
          <linearGradient id="fee-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5ee1ff" stopOpacity="0.25" />
            <stop offset="1" stopColor="#5ee1ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={P.l} x2={width - P.r} y1={y(maxY * t / 1.1)} y2={y(maxY * t / 1.1)} className="grid" />
            <text x={P.l - 6} y={y(maxY * t / 1.1) + 4} textAnchor="end" className="tick">
              {bpsPct((maxY * t) / 1.1)}
            </text>
          </g>
        ))}
        <path d={`${path}V${y(0)}H${x(0)}Z`} fill="url(#fee-fill)" />
        <path d={path} fill="none" stroke="#5ee1ff" strokeWidth={2} />
        <text x={P.l} y={height - 6} className="tick">
          0
        </text>
        <text x={width - P.r} y={height - 6} className="tick" textAnchor="end">
          {rl ? `buy size ${fmt(maxX)} ${d.quote.symbol}` : `${dur(maxX)} after launch`}
        </text>
      </svg>
    </div>
  );
}
