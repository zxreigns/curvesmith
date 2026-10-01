import type { Analysis } from '../core/analytics';

/** Tiny curve thumbnail: market cap vs supply sold. */
export function Spark({ a, w = 220, h = 70 }: { a: Analysis; w?: number; h?: number }) {
  const maxX = a.curveSupplyPct || 1;
  const maxY = a.gradMcap || 1;
  const d = a.samples.map((s, i) => `${i ? 'L' : 'M'}${((s.basePct / maxX) * (w - 4) + 2).toFixed(1)},${(h - 3 - (s.mcap / maxY) * (h - 8)).toFixed(1)}`).join('');
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark">
      <path d={`${d}L${w - 2},${h}L2,${h}Z`} className="spark-fill" />
      <path d={d} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
