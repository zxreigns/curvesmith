import type { Design } from './model';
import { builderParams } from './build';

const ENUMS: Record<string, Record<number, string>> = {
  tokenType: { 0: 'TokenType.SPLToken', 1: 'TokenType.Token2022' },
  tokenAuthorityOption: { 0: 'TokenAuthorityOption.CreatorUpdateAuthority', 1: 'TokenAuthorityOption.Immutable' },
  baseFeeMode: { 0: 'BaseFeeMode.FeeSchedulerLinear', 1: 'BaseFeeMode.FeeSchedulerExponential', 2: 'BaseFeeMode.RateLimiter' },
  collectFeeMode: { 0: 'CollectFeeMode.QuoteToken', 1: 'CollectFeeMode.OutputToken' },
  migrationOption: { 0: 'MigrationOption.MET_DAMM', 1: 'MigrationOption.MET_DAMM_V2' },
  migrationFeeOption: { 0: 'MigrationFeeOption.FixedBps25', 1: 'MigrationFeeOption.FixedBps30', 2: 'MigrationFeeOption.FixedBps100', 3: 'MigrationFeeOption.FixedBps200', 4: 'MigrationFeeOption.FixedBps400', 5: 'MigrationFeeOption.FixedBps600' },
  activationType: { 0: 'ActivationType.Slot', 1: 'ActivationType.Timestamp' },
  tokenBaseDecimal: { 6: 'TokenDecimal.SIX', 9: 'TokenDecimal.NINE' },
};

function lit(v: unknown, key = '', indent = 2): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) return `[${v.map((x) => lit(x, '', indent)).join(', ')}]`;
  if (v && typeof v === 'object') {
    const inner = Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${pad}  ${k}: ${lit(x, k, indent + 2)},`)
      .join('\n');
    return `{\n${inner}\n${pad}}`;
  }
  if (typeof v === 'number' && ENUMS[key]?.[v] !== undefined) return ENUMS[key][v];
  return JSON.stringify(v);
}

/** A self-contained TypeScript snippet that recreates this exact config with the Meteora DBC SDK. */
export function toTypeScript(d: Design): string {
  const p = builderParams(d);
  return `import {
  ActivationType, BaseFeeMode, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption,
  MigrationOption, TokenAuthorityOption, TokenDecimal, TokenType, buildCurveWithLiquidityWeights,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// "${d.name}" — designed in Curvesmith
const params = buildCurveWithLiquidityWeights(${lit(p, '', 0)});

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const client = new DynamicBondingCurveClient(connection, 'confirmed');
const config = Keypair.generate();
const tx = await client.partner.createConfig({
  ...params,
  config: config.publicKey,
  feeClaimer: wallet.publicKey, // you earn the partner share of every trade on this curve
  leftoverReceiver: wallet.publicKey,
  quoteMint: new PublicKey('${d.quote.mint}'), // ${d.quote.symbol}
  payer: wallet.publicKey,
});
`;
}

export const toJSON = (d: Design) => JSON.stringify({ curvesmith: 1, design: d, builder: builderParams(d) }, null, 2);
