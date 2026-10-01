# Curvesmith

**A studio and preset market for Meteora's Dynamic Bonding Curve.**
Sculpt a curve, see exactly what the program will do with it, publish it on-chain as a preset anyone can launch on, and earn on every trade.

**Live app: https://curvesmith.vercel.app** · Network: Solana devnet (mainnet read for the Atlas)

---

## Try it in 30 seconds

1. Open the app, press **Connect**, pick **Burner wallet**. It is funded with devnet SOL automatically.
2. **Market** → **Devnet Demo** → **Launch a token**. Your first buy is atomic with the launch.
3. On the pool page press **to graduation**, **Buy**, then **Graduate to DAMM v2**. Every step links to Solscan.

## Why

DBC gives a launchpad sixteen independently weighted liquidity ranges, anti-snipe fee schedulers, a rate limiter, dynamic fees, vesting and a graduation into DAMM v2. In practice almost nobody uses that design space: most launchpads ship a one or two segment curve with a copy-pasted fee schedule, because tuning a `ConfigParameters` object blind is hard and mistakes only show up after real money moves.

Curvesmith makes the design space visible and the result reusable.

What the Atlas found on mainnet (snapshot Oct 1 2026, the 17 most active named launchpads with readable configs, out of 520 registered): **94% ship a one or two segment curve**, only **29% use any anti-snipe fee decay**, 88% graduate to DAMM v2, and the median curve raises 80 SOL between a ~30 and ~400 SOL market cap.

## What it does

| | |
|---|---|
| **Studio** | Drag 16 liquidity bars and watch market cap vs. supply sold redraw instantly. Live stats: launch and graduation market cap, the raise, price multiple, supply split between curve, DAMM v2 and vesting. Tune anti-snipe (exponential or linear fee decay; the program no longer accepts the rate limiter on new configs, so forks of old rate-limited configs are converted) with a *sniper check* that shows what a bot buying at launch actually pays. Configure the DAMM v2 graduation: fee tier, LP split, permanent lock. Every change is compiled with `buildCurveWithLiquidityWeights` and checked by the SDK's own program-rule validator, so you know before signing whether the program will accept it. |
| **Presets** | Fair Flat, Fast Start, Conviction, Long Curve, Stock Band (liquidity piled around a reference price for tokenized stocks and RWAs), Two-Tier, and a Devnet Demo tuned to graduate with under 3 SOL. |
| **Forge** | One click creates the DBC config on-chain with **you as fee claimer** and lists it in the market. That is the "pay-to-use preset" idea implemented with no extra contract: anyone who launches on your preset pays you the partner share of every trade, enforced by the DBC program. |
| **Market** | Every published preset with its curve, raise and launches. Launch a token on any preset in one modal (with an atomic first buy so the creator can't be sniped). |
| **Pool page** | Exact quotes from the program's math at the current point of the fee schedule, buy/sell with partial fills at the graduation threshold, live progress, then a one-click **permissionless graduation into DAMM v2**. |
| **Atlas** | How the launchpads on Meteora DBC actually configure their curves, read from mainnet: partner metadata, config counts, the most common curve per launchpad, its fee schedule and graduation. Fork any of them into the Studio. |
| **Build with it** | A JSON endpoint for terminals (`/api/presets`), the registry protocol, and the typed curve compiler in `src/core`. |

## How it uses the Meteora stack

- **DBC SDK** (`@meteora-ag/dynamic-bonding-curve-sdk`): `buildCurveWithLiquidityWeights`, `validateConfigParameters`, `partner.createConfig`, `creator.createPool` / `createPoolWithFirstBuy`, `pool.swapQuote2` / `swap2` (partial fill), `migration.migrateToDammV2` (+ `createLocker` when vesting is set), `state.*` for pools, configs, fees.
- **DAMM v2**: every preset graduates into DAMM v2 using the official migration configs; the pool page links the resulting DAMM v2 pool.
- **On-chain registry**: publishing sends `createConfig`, then a listing transaction that touches the registry address `DhJrZQHhww7bUjBvzxdocFYd8ajgHzMpDcPFyJYvuJFm` and carries an SPL Memo `curvesmith:v1:{...}`. The market is rebuilt from `getSignaturesForAddress(registry)`: no database.

## Proven on devnet

The full lifecycle runs from the same core the UI uses (`scripts/e2e-devnet.ts`): design → config + listing → launch with first buy → buys → graduation into DAMM v2. The market is seeded with every built-in preset (`scripts/seed-devnet.ts`), and the Devnet Demo preset ([`HgvGXfab…`](https://solscan.io/account/HgvGXfabwFoozaDWYnp8MNY4csRTbutyS97N78uofoa5?cluster=devnet)) has tokens that graduated into DAMM v2 from the UI.

## Architecture

```
src/core/      model.ts      the Design (market caps, 16 weights, fees, graduation, vesting)
               build.ts      Design → DBC ConfigParameters (SDK builder + validator)
               analytics.ts  the curve's Q64.64 math in BigInt: price/mcap/raise per range
               fork.ts       any on-chain PoolConfig → editable Design (resampled onto 16 ranges)
               chain.ts      publish / registry / launch / quote / swap / graduate, RPC failover
               codegen.ts    export a curve as runnable SDK code or preset JSON
src/pages/     Studio, Market, PresetPage, PoolPage, Atlas, Docs
api/           presets (market JSON), account (server-side account reads), meta + icon (token metadata), drip (sponsored devnet SOL)
scripts/       e2e-devnet.ts, continue-devnet.ts, atlas-snapshot.ts
test/          curve.test.ts: analytics checked segment by segment against the SDK's delta math
```

No wallet-adapter bundle: a small Wallet Standard client (Phantom, Solflare, Backpack) plus a local burner wallet for one-click demos. Transactions confirm by polling with re-broadcast, and reads fail over between RPC endpoints, because public devnet RPCs rate-limit hard.

## Run it

```bash
npm install
npm run dev          # studio at http://localhost:5173
npm test             # curve math vs. SDK
npm run build
KEYPAIR=~/devnet.json npx vite-node scripts/e2e-devnet.ts demo "Forge Cat" FCAT   # full lifecycle on devnet
npm run atlas -- [mainnet-rpc]                                                       # regenerate public/atlas.json
KEYPAIR=~/devnet.json npm run seed -- flat:Ember:EMBR:0.2                          # publish a preset + launch on it
```

Environment (optional): `VITE_DEVNET_RPC` for a dedicated devnet RPC; `DRIP_SECRET_KEY` (server) for the sponsored devnet faucet.

## License

MIT
