/**
 * Curvesmith design model.
 *
 * A Design is the human-sized description of a Meteora DBC launch: the market caps a curve
 * travels between, the *shape* of liquidity along the way (16 weights, one per curve segment),
 * the anti-snipe fee schedule, and how the pool graduates into DAMM v2. `buildConfig` (build.ts)
 * compiles it into the exact `ConfigParameters` the DBC program takes.
 */

export type FeeMode = 'linear' | 'exponential' | 'rateLimiter';

export interface Design {
  name: string;
  /** quote token: SOL or a custom SPL mint (stock / RWA / USDC pairs) */
  quote: { symbol: string; mint: string; decimals: number };
  totalSupply: number;
  baseDecimals: 6 | 9;
  /** market cap (in quote units) at the first trade */
  initialMarketCap: number;
  /** market cap (in quote units) at which the pool graduates into DAMM v2 */
  migrationMarketCap: number;
  /** relative liquidity per segment, 16 values > 0 (the shape you drag in the studio) */
  weights: number[];
  fees: {
    mode: FeeMode;
    startBps: number; // cliff fee at launch
    endBps: number; // fee after the schedule ends (scheduler modes)
    durationSec: number;
    periods: number;
    /** rate limiter: fee added per reference amount bought in one swap */
    rlIncrementBps: number;
    rlReferenceAmount: number;
    dynamicFee: boolean;
    creatorSharePct: number; // share of trading fees that go to the token creator (rest: preset author)
  };
  migration: {
    feeTierBps: 25 | 30 | 100 | 200 | 400 | 600;
    /** % of the graduated DAMM v2 LP that goes to the preset author (the rest to the creator) */
    partnerLpPct: number;
    /** % of the graduated LP that is locked forever (split pro-rata) — DBC requires >= 10% */
    lockedLpPct: number;
  };
  vesting: {
    /** tokens reserved for the creator and vested after graduation (0 = fair launch) */
    lockedAmount: number;
    cliffDays: number;
    vestDays: number;
  };
}

export const SEGMENTS = 16;
export const SOL = { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9 };

export const baseDesign = (): Design => ({
  name: 'Untitled curve',
  quote: SOL,
  totalSupply: 1_000_000_000,
  baseDecimals: 6,
  initialMarketCap: 30,
  migrationMarketCap: 400,
  weights: Array(SEGMENTS).fill(1),
  fees: {
    mode: 'exponential',
    startBps: 5000,
    endBps: 100,
    durationSec: 120,
    periods: 60,
    rlIncrementBps: 10,
    rlReferenceAmount: 0.5,
    dynamicFee: true,
    creatorSharePct: 50,
  },
  migration: { feeTierBps: 100, partnerLpPct: 50, lockedLpPct: 20 },
  vesting: { lockedAmount: 0, cliffDays: 0, vestDays: 0 },
});

/** Shape generators: each returns 16 positive weights. */
export const shapes = {
  flat: () => Array(SEGMENTS).fill(1),
  exponential: (k = 1.22) => Array.from({ length: SEGMENTS }, (_, i) => k ** i),
  frontLoaded: (k = 1.22) => Array.from({ length: SEGMENTS }, (_, i) => k ** (SEGMENTS - 1 - i)),
  /** liquidity piled around a band (e.g. a reference price), thin elsewhere */
  band: (center = 0.6, width = 0.18) =>
    Array.from({ length: SEGMENTS }, (_, i) => {
      const x = (i + 0.5) / SEGMENTS;
      return 0.15 + Math.exp(-((x - center) ** 2) / (2 * width * width));
    }),
  /** long tail: slow early discovery, deep late liquidity */
  long: () => Array.from({ length: SEGMENTS }, (_, i) => 0.4 + (i / (SEGMENTS - 1)) ** 2.4 * 3),
  /** two-phase: cheap community tranche, then a steep wall */
  steps: () => Array.from({ length: SEGMENTS }, (_, i) => (i < 6 ? 2.2 : i < 11 ? 1 : 0.45)),
};

export type ShapeKey = keyof typeof shapes;

export const clampDesign = (d: Design): Design => ({
  ...d,
  weights: d.weights.map((w) => Math.min(10, Math.max(0.05, w))),
  migrationMarketCap: Math.max(d.migrationMarketCap, d.initialMarketCap * 1.5),
});
