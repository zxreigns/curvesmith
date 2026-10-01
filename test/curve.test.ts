import { describe, expect, it } from 'vitest';
import BN from 'bn.js';
import { getDeltaAmountBaseUnsigned, getDeltaAmountQuoteUnsigned, Rounding } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { baseDesign, shapes } from '../src/core/model';
import { buildConfig, lpSplit } from '../src/core/build';
import { analyze, buyAtLaunch, fromParams } from '../src/core/analytics';

describe('curve compiler', () => {
  it('builds a valid config for every shape', () => {
    for (const k of Object.keys(shapes) as (keyof typeof shapes)[]) {
      const r = buildConfig({ ...baseDesign(), weights: shapes[k]() });
      expect(r.error, k).toBeNull();
      expect(r.config!.curve.length).toBeGreaterThan(0);
    }
  });

  it('lp split always sums to 100 and locks >= 10%', () => {
    for (const p of [0, 13, 50, 77, 100]) for (const l of [10, 20, 33, 100]) {
      const d = baseDesign(); d.migration.partnerLpPct = p; d.migration.lockedLpPct = l;
      const s = lpSplit(d);
      expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(100);
      expect(s.partnerPermanentLockedLiquidityPercentage + s.creatorPermanentLockedLiquidityPercentage).toBe(l);
      expect(Math.min(...Object.values(s))).toBeGreaterThanOrEqual(0);
    }
  });

  it('matches the SDK delta math segment by segment', () => {
    const d = { ...baseDesign(), weights: shapes.exponential() };
    const { config } = buildConfig(d);
    const a = analyze(fromParams(config!, d), 1);
    let lo = config!.sqrtStartPrice;
    let quote = 0;
    for (const [i, p] of config!.curve.entries()) {
      if (!a.segments[i]?.used) break;
      const q = getDeltaAmountQuoteUnsigned(lo, p.sqrtPrice, p.liquidity, Rounding.Down);
      const b = getDeltaAmountBaseUnsigned(lo, p.sqrtPrice, p.liquidity, Rounding.Down);
      if (quote + Number(q.toString()) / 1e9 < a.quoteToGraduate - 1e-6) {
        expect(a.segments[i].quote).toBeCloseTo(Number(q.toString()) / 1e9, 6);
        expect(a.segments[i].base / (Number(b.toString()) / 1e6)).toBeCloseTo(1, 6);
      }
      quote += Number(q.toString()) / 1e9;
      lo = p.sqrtPrice as BN;
    }
  });

  it('hits the requested market caps', () => {
    const d = baseDesign();
    const { config } = buildConfig(d);
    const a = analyze(fromParams(config!, d));
    expect(a.startMcap / d.initialMarketCap).toBeCloseTo(1, 2);
    expect(a.gradMcap / d.migrationMarketCap).toBeCloseTo(1, 1);
    expect(a.quoteToGraduate).toBeGreaterThan(0);
    const allocated = a.curveSupplyPct + a.dammBasePct + a.vestPct;
    expect(allocated).toBeLessThanOrEqual(100.01);
    expect(allocated).toBeGreaterThan(99); // the builder allocates everything but the leftover buffer
    const snipe = buyAtLaunch(a, 5, 5000);
    expect(snipe.feePaid).toBeCloseTo(2.5, 6);
  });
});
