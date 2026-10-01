import { baseDesign, shapes, type Design } from './model';

export interface Preset {
  key: string;
  name: string;
  tagline: string;
  why: string;
  design: Design;
}

const make = (key: string, name: string, tagline: string, why: string, patch: (d: Design) => void): Preset => {
  const d = baseDesign();
  d.name = name;
  patch(d);
  return { key, name, tagline, why, design: d };
};

export const PRESETS: Preset[] = [
  make('flat', 'Fair Flat', 'Even depth from first trade to graduation', 'Every price range holds the same liquidity, so no stretch of the curve is cheap to push. The calm default for community launches.', (d) => {
    d.weights = shapes.flat();
  }),
  make('fast', 'Fast Start', 'Thin at the bottom, deep at the top', 'Early buys move the price quickly, then depth builds as the token proves itself. Rewards conviction without a flat sniper zone.', (d) => {
    d.weights = shapes.exponential(1.25);
  }),
  make('conviction', 'Conviction', 'A deep, cheap community zone, then a fast run to graduation', 'Most liquidity sits low so holders can accumulate, the top is thin so the last stretch to DAMM v2 happens fast.', (d) => {
    d.weights = shapes.frontLoaded(1.2);
    d.fees.startBps = 7500;
    d.fees.durationSec = 300;
  }),
  make('long', 'Long Curve', 'Slow discovery over a long runway', 'Gentle early slope and a deep late book: built for tokens that should take days, not minutes, to graduate.', (d) => {
    d.weights = shapes.long();
    d.initialMarketCap = 20;
    d.migrationMarketCap = 1000;
    d.fees.mode = 'linear';
    d.fees.durationSec = 3600;
    d.fees.periods = 60;
  }),
  make('band', 'Stock Band', 'Liquidity piled around a reference price', 'For tokenized stocks, RWAs and NAV-anchored assets: thin outside the band, deep where the real-world price is, so discovery converges instead of overshooting.', (d) => {
    d.weights = shapes.band(0.62, 0.16);
    d.initialMarketCap = 120;
    d.migrationMarketCap = 260;
    d.fees.mode = 'exponential';
    d.fees.startBps = 5000;
    d.fees.endBps = 100;
    d.fees.durationSec = 600;
    d.fees.periods = 20;
  }),
  make('tiers', 'Two-Tier', 'Community tranche, then a wall', 'A cheap first tier for early supporters, then deliberately thin liquidity so latecomers pay up.', (d) => {
    d.weights = shapes.steps();
  }),
  make('demo', 'Devnet Demo', 'Graduates with about 2 SOL', 'A tiny curve tuned so you can launch, buy and graduate into DAMM v2 on devnet in under a minute.', (d) => {
    d.weights = shapes.exponential(1.15);
    d.initialMarketCap = 1;
    d.migrationMarketCap = 8;
    d.fees.startBps = 2500;
    d.fees.durationSec = 60;
    d.fees.periods = 20;
  }),
];

export const presetByKey = (k: string) => PRESETS.find((p) => p.key === k);
