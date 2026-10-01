/** Compact number formatting for prices that span 12 orders of magnitude. */
export function fmt(n: number, digits = 2): string {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a >= 1e9) return (n / 1e9).toFixed(digits) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(digits) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(digits) + 'K';
  if (a >= 100) return n.toFixed(0);
  if (a >= 1) return n.toFixed(digits);
  if (a >= 0.001) return n.toPrecision(3);
  return fmtPrice(n);
}

/** 0.0₇123 style for tiny prices (the way trading terminals show them). */
export function fmtPrice(n: number): string {
  if (!isFinite(n) || n === 0) return '0';
  if (n >= 0.001) return fmt(n, 4);
  const s = n.toExponential(3); // 1.234e-8
  const [m, e] = s.split('e');
  const zeros = -parseInt(e, 10) - 1;
  const digits = m.replace('.', '').replace('-', '').slice(0, 4);
  const sub = String(zeros)
    .split('')
    .map((d) => '₀₁₂₃₄₅₆₇₈₉'[+d])
    .join('');
  return `0.0${sub}${digits}`;
}

export const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;
export const short = (s: string, n = 4) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
export const bpsPct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
export function dur(sec: number) {
  if (sec < 120) return `${Math.round(sec)}s`;
  if (sec < 7200) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(0)}d`;
}
