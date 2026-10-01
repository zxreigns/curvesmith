import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithLiquidityWeights,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  validateConfigParameters,
  type ConfigParameters,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { PublicKey } from '@solana/web3.js';
import { clampDesign, type Design } from './model';

// any non-default key: the validator only checks the receiver is set
const PLACEHOLDER_RECEIVER = new PublicKey('dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN');

export const FEE_TIER: Record<Design['migration']['feeTierBps'], MigrationFeeOption> = {
  25: MigrationFeeOption.FixedBps25,
  30: MigrationFeeOption.FixedBps30,
  100: MigrationFeeOption.FixedBps100,
  200: MigrationFeeOption.FixedBps200,
  400: MigrationFeeOption.FixedBps400,
  600: MigrationFeeOption.FixedBps600,
};

/** Split the graduated LP into the four integer buckets DBC expects (they must sum to 100). */
export function lpSplit(d: Design) {
  const locked = Math.round(d.migration.lockedLpPct);
  const p = d.migration.partnerLpPct / 100;
  const partnerLocked = Math.round(locked * p);
  const creatorLocked = locked - partnerLocked;
  const partnerLiq = Math.round((100 - locked) * p);
  const creatorLiq = 100 - locked - partnerLiq;
  return {
    partnerPermanentLockedLiquidityPercentage: partnerLocked,
    partnerLiquidityPercentage: partnerLiq,
    creatorPermanentLockedLiquidityPercentage: creatorLocked,
    creatorLiquidityPercentage: creatorLiq,
  };
}

/** The exact parameter object handed to the SDK builder — also what the code export prints. */
export function builderParams(input: Design) {
  const d = clampDesign(input);
  const f = d.fees;
  const baseFeeParams =
    f.mode === 'rateLimiter'
      ? {
          baseFeeMode: BaseFeeMode.RateLimiter as const,
          rateLimiterParam: {
            baseFeeBps: f.endBps,
            feeIncrementBps: f.rlIncrementBps,
            referenceAmount: f.rlReferenceAmount,
            maxLimiterDuration: f.durationSec,
          },
        }
      : {
          baseFeeMode: (f.mode === 'linear' ? BaseFeeMode.FeeSchedulerLinear : BaseFeeMode.FeeSchedulerExponential) as
            | BaseFeeMode.FeeSchedulerLinear
            | BaseFeeMode.FeeSchedulerExponential,
          feeSchedulerParam: {
            startingFeeBps: f.startBps,
            endingFeeBps: f.endBps,
            numberOfPeriod: f.periods,
            totalDuration: f.durationSec,
          },
        };
  const vest = d.vesting;
  return {
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: d.baseDecimals === 9 ? TokenDecimal.NINE : TokenDecimal.SIX,
      tokenQuoteDecimal: d.quote.decimals,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: d.totalSupply,
      leftover: Math.max(10_000, Math.round(d.totalSupply * 1e-5)),
    },
    fee: {
      baseFeeParams,
      dynamicFeeEnabled: f.dynamicFee,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: Math.round(f.creatorSharePct),
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: FEE_TIER[d.migration.feeTierBps],
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: lpSplit(d),
    lockedVesting:
      vest.lockedAmount > 0
        ? {
            totalLockedVestingAmount: vest.lockedAmount,
            numberOfVestingPeriod: Math.max(1, Math.round(vest.vestDays)),
            cliffUnlockAmount: 0,
            totalVestingDuration: Math.max(1, Math.round(vest.vestDays * 86400)),
            cliffDurationFromMigrationTime: Math.round(vest.cliffDays * 86400),
          }
        : {
            totalLockedVestingAmount: 0,
            numberOfVestingPeriod: 0,
            cliffUnlockAmount: 0,
            totalVestingDuration: 0,
            cliffDurationFromMigrationTime: 0,
          },
    activationType: ActivationType.Timestamp,
    initialMarketCap: d.initialMarketCap,
    migrationMarketCap: d.migrationMarketCap,
    liquidityWeights: d.weights.map((w) => Number(w.toFixed(4))),
  };
}

export interface BuildResult {
  config: ConfigParameters | null;
  /** first actionable error from the SDK builder or the program-rule validator */
  error: string | null;
}

/** Compile a Design into DBC ConfigParameters and run the SDK's own program-rule validation. */
export function buildConfig(d: Design): BuildResult {
  try {
    const config = buildCurveWithLiquidityWeights(builderParams(d));
    validateConfigParameters({ ...config, leftoverReceiver: PLACEHOLDER_RECEIVER });
    return { config, error: null };
  } catch (e) {
    return { config: null, error: e instanceof Error ? e.message : String(e) };
  }
}
