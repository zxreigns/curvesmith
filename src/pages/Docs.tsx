import { REGISTRY, MEMO_PREFIX } from '../core/chain';

const launchSnippet = `import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

// any preset from the Curvesmith market is just a DBC config address
const PRESET = new PublicKey('<config address from the market>');

const client = new DynamicBondingCurveClient(new Connection('https://api.devnet.solana.com'), 'confirmed');
const mint = Keypair.generate();
const tx = await client.creator.createPool({
  config: PRESET,
  baseMint: mint.publicKey,
  name: 'My Token', symbol: 'MYT', uri: 'https://…/metadata.json',
  payer: wallet.publicKey, poolCreator: wallet.publicKey,
});
// sign with wallet + mint, send. The preset author's fee share flows automatically.`;

const apiSnippet = `GET /api/presets
[
  {
    "config": "HgvG…foa5",          // DBC config account (devnet)
    "name": "Devnet Demo",
    "tagline": "Graduates with about 2 SOL",
    "author": "Hscm…Bnw",            // fee claimer = royalty receiver
    "quote": "SOL",
    "startMcap": 1.0, "gradMcap": 8.0, "raise": 2.6,
    "launches": 3, "graduated": 1,
    "listedAt": 1790000000
  }
]`;

const coreSnippet = `import { baseDesign, shapes } from './src/core/model';
import { buildConfig } from './src/core/build';
import { analyze, fromParams } from './src/core/analytics';

const design = { ...baseDesign(), weights: shapes.band(0.6, 0.15), initialMarketCap: 120, migrationMarketCap: 260 };
const { config, error } = buildConfig(design);     // exact DBC ConfigParameters, SDK-validated
const a = analyze(fromParams(config!, design));    // start/grad mcap, raise, supply split, full curve`;

export function Docs() {
  return (
    <div className="page docs">
      <div className="page-head">
        <div>
          <h2>Build with Curvesmith</h2>
          <p className="muted">Curvesmith is three things a launchpad can plug into today: a curve compiler, an on-chain preset registry, and a market of configs that pay their authors.</p>
        </div>
      </div>
      <div className="docs-grid">
        <section className="card">
          <h3>1 · Launch on any preset from your own app</h3>
          <p>A preset is a plain Meteora DBC config. Your launchpad does not need Curvesmith at runtime: pass the config address to the official SDK. The preset author is the config’s fee claimer, so their cut is enforced by the DBC program itself. That is pay-to-use with no middleman and no extra contract.</p>
          <pre className="code">{launchSnippet}</pre>
        </section>
        <section className="card">
          <h3>2 · Read the market as JSON</h3>
          <p>Terminals and launchpads can list presets with one request. Everything is derived from chain state on each call.</p>
          <pre className="code">{apiSnippet}</pre>
        </section>
        <section className="card">
          <h3>3 · The registry protocol</h3>
          <p>
            Publishing a preset sends two transactions: <code>createConfig</code>, then a listing transaction that touches the registry address <code>{REGISTRY.toBase58()}</code> and carries an SPL Memo:
          </p>
          <pre className="code">{`${MEMO_PREFIX}{"v":1,"name":"…","tagline":"…","config":"<address>","design":{…}}`}</pre>
          <p>Anyone can rebuild the market with <code>getSignaturesForAddress(registry)</code>. No database, nothing to trust but the chain, and other frontends can list the same presets.</p>
        </section>
        <section className="card">
          <h3>4 · The curve compiler</h3>
          <p>
            The studio is a thin UI over a typed core you can import: shapes → <code>buildCurveWithLiquidityWeights</code> → the SDK validator, plus analytics that reproduce the program’s Q64.64 math (tests check it segment by segment against the SDK).
          </p>
          <pre className="code">{coreSnippet}</pre>
        </section>
        <section className="card">
          <h3>5 · Why 16 segments matter</h3>
          <p>Most launchpads in the Atlas run a one or two segment curve. DBC supports sixteen. Sixteen independently weighted ranges let you build things a single constant-product curve cannot: a deep community zone, a liquidity band around a tokenized stock’s reference price, a thin final stretch that makes graduation decisive. Curvesmith makes that design space usable in seconds.</p>
        </section>
      </div>
    </div>
  );
}
