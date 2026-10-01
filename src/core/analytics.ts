import BN from 'bn.js';
import type { ConfigParameters } from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { Design } from './model';

/**
 * Curve analytics with the DBC program's own math: the curve is a list of constant-liquidity
 * ranges in Q64.64 sqrt-price space. For a range [sL, sU] with liquidity L:
 *   quote = L * (sU - sL) / 2^128
 *   base  = L * (sU - sL) / (sL * sU)
 * Integer (BigInt) arithmetic, so the numbers match what the program will do on-chain.
 */
const Q128 = 1n << 128n;
const Q64F = 2 ** 64;

const big = (x: BN | bigint | string | number) => BigInt(x.toString());

export interface Sample {
  basePct: number; // % of total supply sold on the curve so far
  quote: number; // quote raised so far (human units)
  price: number; // quote per token (human units)
  mcap: number; // price * total supply
}

export interface Segment {
  i: number;
  base: number; // tokens sold in this segment
  quote: number; // quote raised in this segment
  p0: number;
  p1: number;
  weight: number; // liquidity share (for the bar chart)
  used: boolean; // false if graduation happens before this segment
}

export interface Analysis {
  samples: Sample[];
  segments: Segment[];
  startPrice: number;
  gradPrice: number;
  startMcap: number;
  gradMcap: number;
  quoteToGraduate: number; // quote collected by the curve when it graduates
  curveSupplyPct: number; // % of supply sold through the curve
  dammBasePct: number; // % of supply seeded into the DAMM v2 pool
  dammQuote: number; // quote seeded into the DAMM v2 pool
  vestPct: number;
  leftoverPct: number;
  priceMultiple: number;
}

export function sqrtToPrice(sqrt: bigint, baseDec: number, quoteDec: number) {
  const s = Number(sqrt) / Q64F;
  return s * s * 10 ** (baseDec - quoteDec);
}

/** The minimum a curve needs to be analyzed — built from a Design or read from an on-chain PoolConfig. */
export interface CurveInput {
  sqrtStartPrice: BN | bigint;
  curve: { sqrtPrice: BN | bigint; liquidity: BN | bigint }[];
  migrationQuoteThreshold: BN | bigint;
  migrationFeePct: number;
  baseDecimals: number;
  quoteDecimals: number;
  totalSupply: number; // human units
  vestedAmount: number; // human units
}

export const fromParams = (cfg: ConfigParameters, d: Design): CurveInput => ({
  sqrtStartPrice: cfg.sqrtStartPrice,
  curve: cfg.curve,
  migrationQuoteThreshold: cfg.migrationQuoteThreshold,
  migrationFeePct: cfg.migrationFee.feePercentage,
  baseDecimals: d.baseDecimals,
  quoteDecimals: d.quote.decimals,
  totalSupply: d.totalSupply,
  vestedAmount: d.vesting.lockedAmount,
});

export function analyze(cfg: CurveInput, subSteps = 10): Analysis {
  const baseDec = cfg.baseDecimals;
  const quoteDec = cfg.quoteDecimals;
  const bUnit = 10 ** baseDec;
  const qUnit = 10 ** quoteDec;
  const supply = cfg.totalSupply;
  const threshold = big(cfg.migrationQuoteThreshold);
  const start = big(cfg.sqrtStartPrice);
  const pts = cfg.curve.filter((p) => big(p.liquidity) > 0n);

  const samples: Sample[] = [];
  const segments: Segment[] = [];
  let lo = start;
  let cumQ = 0n;
  let cumB = 0n;
  let done = false;
  let gradSqrt = start;
  const push = (s: bigint) =>
    samples.push({
      basePct: (Number(cumB) / bUnit / supply) * 100,
      quote: Number(cumQ) / qUnit,
      price: sqrtToPrice(s, baseDec, quoteDec),
      mcap: sqrtToPrice(s, baseDec, quoteDec) * supply,
    });
  push(start);
  const totalL = pts.reduce((a, p) => a + Number(p.liquidity.toString()), 0) || 1;

  pts.forEach((p, i) => {
    const L = big(p.liquidity);
    const hi = big(p.sqrtPrice);
    const segStartB = cumB;
    const segStartQ = cumQ;
    const p0 = sqrtToPrice(lo, baseDec, quoteDec);
    if (!done) {
      // quote needed to cross the whole range
      const fullQ = (L * (hi - lo)) / Q128;
      let end = hi;
      if (cumQ + fullQ >= threshold) {
        // graduation inside this range: solve sqrt price where quote hits the threshold
        const need = threshold - cumQ;
        end = lo + (need * Q128) / L;
        done = true;
      }
      for (let k = 1; k <= subSteps; k++) {
        const s = lo + ((end - lo) * BigInt(k)) / BigInt(subSteps);
        const q = (L * (s - lo)) / Q128;
        const b = (L * (s - lo)) / (lo * s);
        cumQ = segStartQ + q;
        cumB = segStartB + b;
        push(s);
      }
      gradSqrt = end;
      lo = hi;
    }
    segments.push({
      i,
      base: Number(cumB - segStartB) / bUnit,
      quote: Number(cumQ - segStartQ) / qUnit,
      p0,
      p1: sqrtToPrice(hi, baseDec, quoteDec),
      weight: Number(p.liquidity.toString()) / totalL,
      used: cumB > segStartB,
    });
  });

  const startPrice = sqrtToPrice(start, baseDec, quoteDec);
  const gradPrice = sqrtToPrice(gradSqrt, baseDec, quoteDec);
  const curveSupplyPct = (Number(cumB) / bUnit / supply) * 100;

  // DAMM v2 seed: the builder's own relation migrationQuote = migrationBase * sqrtP^2 >> 128
  const migQuote = (threshold * BigInt(100 - cfg.migrationFeePct)) / 100n;
  const migBase = gradSqrt > 0n ? (migQuote << 128n) / (gradSqrt * gradSqrt) : 0n;
  const dammBasePct = (Number(migBase) / bUnit / supply) * 100;
  const dammQuote = Number(migQuote) / qUnit;
  const vestPct = (cfg.vestedAmount / supply) * 100;
  return {
    samples,
    segments,
    startPrice,
    gradPrice,
    startMcap: startPrice * supply,
    gradMcap: gradPrice * supply,
    quoteToGraduate: Number(threshold) / qUnit,
    curveSupplyPct,
    dammBasePct,
    dammQuote,
    vestPct,
    leftoverPct: Math.max(0, 100 - curveSupplyPct - dammBasePct - vestPct),
    priceMultiple: gradPrice / startPrice,
  };
}

/** What a buy of `quoteIn` gets at fee `feeBps`, starting from the beginning of the curve. */
export function buyAtLaunch(a: Analysis, quoteIn: number, feeBps: number) {
  const net = quoteIn * (1 - feeBps / 10_000);
  const s = a.samples;
  let pct = s[s.length - 1].basePct;
  for (let i = 1; i < s.length; i++) {
    if (s[i].quote >= net) {
      const t = (net - s[i - 1].quote) / Math.max(1e-18, s[i].quote - s[i - 1].quote);
      pct = s[i - 1].basePct + t * (s[i].basePct - s[i - 1].basePct);
      break;
    }
  }
  return { supplyPct: pct, feePaid: quoteIn - net };
}

/** Base fee (bps) over time for the scheduler modes, or vs. buy size for the rate limiter. */
export function feeCurve(d: Design, n = 60): { x: number; bps: number }[] {
  const f = d.fees;
  if (f.mode === 'rateLimiter') {
    const maxX = f.rlReferenceAmount * 12;
    return Array.from({ length: n + 1 }, (_, i) => {
      const x = (maxX * i) / n;
      // effective fee on a buy of size x: each reference-sized chunk above the first pays more
      const chunks = x / f.rlReferenceAmount;
      let paid = 0;
      for (let c = 0; c < Math.ceil(chunks); c++) {
        const part = Math.min(1, chunks - c);
        paid += part * Math.min(9900, f.endBps + c * f.rlIncrementBps);
      }
      return { x, bps: chunks > 0 ? paid / chunks : f.endBps };
    });
  }
  const periods = Math.max(1, f.periods);
  const r = f.mode === 'linear' ? 0 : 1 - (f.endBps / f.startBps) ** (1 / periods);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (f.durationSec * 1.25 * i) / n;
    const period = Math.min(periods, Math.floor((t / f.durationSec) * periods));
    const bps =
      f.mode === 'linear'
        ? f.startBps - ((f.startBps - f.endBps) * period) / periods
        : f.startBps * (1 - r) ** period;
    return { x: t, bps: Math.max(f.endBps, bps) };
  });
}
