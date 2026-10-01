import { useWallet } from '../wallet';
import { loadMarket, useAsync } from '../lib/data';
import { Spark } from '../components/Spark';
import { fmt, short } from '../lib/format';
import { REGISTRY, explorer, client } from '../core/chain';
import type { Connection } from '@solana/web3.js';

export function Market() {
  const { connection } = useWallet();
  const { data, error, loading, reload } = useAsync(() => loadMarket(connection), [connection]);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Preset market</h2>
          <p className="muted">
            Every preset is a live Meteora DBC config on devnet. Launch a token on one in a click; its author earns the partner share of every trade. The whole market is rebuilt from chain history, no backend:{' '}
            <a href={explorer('address', REGISTRY.toBase58())} target="_blank" rel="noreferrer">
              registry {short(REGISTRY.toBase58())}
            </a>
            .
          </p>
        </div>
        <div className="row gap">
          <button className="btn ghost sm" onClick={reload}>
            Refresh
          </button>
          <a className="btn primary sm" href="#/">
            Forge your own
          </a>
        </div>
      </div>
      {loading && !data && <div className="grid-cards">{Array.from({ length: 6 }, (_, i) => <div key={i} className="card skeleton" />)}</div>}
      {error && <div className="card warn">Could not read the registry: {error}</div>}
      {data && data.length === 0 && <div className="card empty">No presets yet. Be the first to forge one.</div>}
      {data && (
        <div className="grid-cards">
          {data.map((p) => (
            <a key={p.config} className="card preset-card" href={`#/preset/${p.config}`}>
              <div className="pc-top">
                <div>
                  <div className="pc-name">{p.meta.name}</div>
                  <div className="pc-tag">{p.meta.tagline || 'A custom DBC curve'}</div>
                </div>
                <span className="pill">{p.quoteSymbol}</span>
              </div>
              {p.a && <Spark a={p.a} />}
              {p.a && (
                <div className="pc-stats">
                  <span>
                    {fmt(p.a.startMcap)} → <b>{fmt(p.a.gradMcap)}</b> {p.quoteSymbol}
                  </span>
                  <span>raise {fmt(p.a.quoteToGraduate)}</span>
                </div>
              )}
              <div className="pc-foot">
                <span className="muted">
                  by {short(p.author)} · <Launches config={p.config} />
                </span>
                <span className="muted">{p.time ? new Date(p.time * 1000).toLocaleDateString() : ''}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

const launchCache = new Map<string, Promise<{ n: number; grad: number }>>();
let queue = Promise.resolve();
function countLaunches(conn: Connection, config: string) {
  if (!launchCache.has(config)) {
    // one at a time: public devnet RPC rate-limits bursts of program scans
    const p = queue.then(async () => {
      const pools = await client(conn).state.getPoolsByConfig(config);
      return { n: pools.length, grad: pools.filter((x) => x.account.poolState.isMigrated === 1).length };
    });
    queue = p.then(() => undefined, () => undefined);
    launchCache.set(config, p);
  }
  return launchCache.get(config)!;
}

function Launches({ config }: { config: string }) {
  const { connection } = useWallet();
  const { data } = useAsync(() => countLaunches(connection, config), [config]);
  if (!data) return <span className="muted">…</span>;
  return (
    <span>
      {data.n} launch{data.n === 1 ? '' : 'es'}
      {data.grad > 0 && <span className="grad-note"> · {data.grad} graduated</span>}
    </span>
  );
}
