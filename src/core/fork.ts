import type { PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { analyze, sqrtToPrice, type Analysis, type CurveInput } from './analytics';
import { baseDesign, SEGMENTS, SOL, type Design } from './model';

const FEE_TIERS: Design['migration']['feeTierBps'][] = [25, 30, 100, 200, 400, 600];
const n = (x: { toString(): string } | number) => Number(x.toString());

/** Normalized view of an on-chain PoolConfig, enough to chart it and fork it. */
export function curveInputFromPool(pc: PoolConfig, quoteDecimals: number): CurveInput {
  const dec = pc.tokenDecimal;
  const vest = n(pc.lockedVestingConfig.amountPerPeriod) * n(pc.lockedVestingConfig.numberOfPeriod) + n(pc.lockedVestingConfig.cliffUnlockAmount);
  const pre = n(pc.preMigrationTokenSupply);
  const est = n(pc.swapBaseAmount) + n(pc.migrationBaseThreshold) + vest;
  return {
    sqrtStartPrice: pc.sqrtStartPrice,
    curve: pc.curve.filter((p) => n(p.liquidity) > 0),
    migrationQuoteThreshold: pc.migrationQuoteThreshold,
    migrationFeePct: pc.migrationFeePercentage,
    baseDecimals: dec,
    quoteDecimals,
    totalSupply: (pre > 0 ? pre : est) / 10 ** dec,
    vestedAmount: vest / 10 ** dec,
  };
}

export function analyzePool(pc: PoolConfig, quoteDecimals: number): Analysis {
  return analyze(curveInputFromPool(pc, quoteDecimals), 6);
}

/** Liquidity of a curve at a given sqrt price (0 outside it). */
function liquidityAt(input: CurveInput, sqrt: number) {
  let lo = n(input.sqrtStartPrice);
  for (const p of input.curve) {
    const hi = n(p.sqrtPrice);
    if (sqrt >= lo && sqrt <= hi) return n(p.liquidity);
    lo = hi;
  }
  return 0;
}

/** Fee schedule summary from an on-chain base fee config. */
export function feeSummary(pc: PoolConfig) {
  const b = pc.poolFees.baseFee;
  const startBps = n(b.cliffFeeNumerator) / 1e5;
  if (b.baseFeeMode === 2) {
    return { mode: 'rateLimiter' as const, startBps, endBps: startBps, durationSec: n(b.secondFactor), periods: 1, incBps: n(b.firstFactor), ref: n(b.thirdFactor) };
  }
  const periods = n(b.firstFactor);
  const freq = n(b.secondFactor);
  const rf = n(b.thirdFactor);
  const endNum = b.baseFeeMode === 0 ? n(b.cliffFeeNumerator) - periods * rf : n(b.cliffFeeNumerator) * (1 - rf / 10_000) ** periods;
  return {
    mode: (b.baseFeeMode === 0 ? 'linear' : 'exponential') as 'linear' | 'exponential',
    startBps,
    endBps: Math.max(0, endNum / 1e5),
    durationSec: periods * freq,
    periods,
    incBps: 0,
    ref: 0,
  };
}

/**
 * Turn any on-chain DBC config into an editable Curvesmith design: market caps from its sqrt
 * prices, and its liquidity profile resampled onto the 16 geometric ranges the builder uses.
 */
export function forkDesign(pc: PoolConfig, quote: { symbol: string; mint: string; decimals: number } = SOL, name = 'Forked curve'): Design {
  const input = curveInputFromPool(pc, quote.decimals);
  const a = analyze(input, 2);
  const d = baseDesign();
  d.name = name;
  d.quote = quote;
  d.baseDecimals = input.baseDecimals === 9 ? 9 : 6;
  d.totalSupply = Math.round(input.totalSupply);
  d.initialMarketCap = Number(a.startMcap.toPrecision(4));
  const migSqrt = n(pc.migrationSqrtPrice);
  const gradMcap = migSqrt > 0 ? sqrtToPrice(BigInt(pc.migrationSqrtPrice.toString()), input.baseDecimals, quote.decimals) * input.totalSupply : a.gradMcap;
  d.migrationMarketCap = Number(Math.max(gradMcap, d.initialMarketCap * 1.6).toPrecision(4));

  const s0 = n(pc.sqrtStartPrice);
  const s1 = migSqrt > s0 ? migSqrt : s0 * Math.sqrt(d.migrationMarketCap / d.initialMarketCap);
  const ratio = (s1 / s0) ** (1 / SEGMENTS);
  const raw = Array.from({ length: SEGMENTS }, (_, i) => liquidityAt(input, s0 * ratio ** (i + 0.5)));
  const max = Math.max(...raw) || 1;
  d.weights = raw.map((v) => Math.max(0.05, Number(((v / max) * 4).toFixed(3))));

  const f = feeSummary(pc);
  d.fees.mode = f.mode;
  d.fees.startBps = Math.round(Math.min(9900, Math.max(25, f.startBps)));
  d.fees.endBps = Math.round(Math.min(d.fees.startBps, Math.max(25, f.endBps)));
  d.fees.durationSec = Math.max(1, Math.round(f.durationSec)) || 60;
  d.fees.periods = Math.max(1, f.periods);
  if (f.mode === 'rateLimiter') {
    d.fees.endBps = d.fees.startBps;
    d.fees.rlIncrementBps = Math.max(1, f.incBps);
    d.fees.rlReferenceAmount = f.ref / 10 ** quote.decimals || 1;
  }
  d.fees.dynamicFee = pc.poolFees.dynamicFee.initialized === 1;
  d.fees.creatorSharePct = pc.creatorTradingFeePercentage;

  d.migration.feeTierBps = FEE_TIERS[pc.migrationFeeOption] ?? 100;
  const partner = pc.partnerLiquidityPercentage + pc.partnerPermanentLockedLiquidityPercentage;
  d.migration.partnerLpPct = partner;
  d.migration.lockedLpPct = Math.max(10, pc.partnerPermanentLockedLiquidityPercentage + pc.creatorPermanentLockedLiquidityPercentage);
  d.vesting.lockedAmount = Math.round(input.vestedAmount);
  const v = pc.lockedVestingConfig;
  d.vesting.cliffDays = n(v.cliffDurationFromMigrationTime) / 86400;
  d.vesting.vestDays = (n(v.frequency) * n(v.numberOfPeriod)) / 86400;
  return d;
}
