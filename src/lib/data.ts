import { useEffect, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import type { PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { client, readRegistry, type RegistryEntry } from '../core/chain';
import { analyzePool } from '../core/fork';
import type { Analysis } from '../core/analytics';

export interface MarketPreset extends RegistryEntry {
  pc: PoolConfig | null;
  a: Analysis | null;
  quoteSymbol: string;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
let cache: { at: number; data: MarketPreset[] } | null = null;

export async function loadMarket(conn: Connection, fresh = false): Promise<MarketPreset[]> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.data;
  const entries = await readRegistry(conn);
  const seen = new Set<string>();
  const uniq = entries.filter((e) => e.config && !seen.has(e.config) && seen.add(e.config));
  const c = client(conn);
  const keys = uniq.map((e) => new PublicKey(e.config));
  const accounts: (PoolConfig | null)[] = [];
  for (let i = 0; i < keys.length; i += 50) {
    const batch = (await c.state.program.account.poolConfig.fetchMultiple(keys.slice(i, i + 50))) as (PoolConfig | null)[];
    accounts.push(...batch);
  }
  const data = uniq.map((e, i) => {
    const pc = accounts[i];
    const isSol = pc?.quoteMint.toBase58() === SOL_MINT;
    let a: Analysis | null = null;
    try {
      a = pc ? analyzePool(pc, isSol ? 9 : 6) : null;
    } catch {
      a = null;
    }
    return { ...e, pc, a, quoteSymbol: isSol ? 'SOL' : 'USDC' };
  });
  cache = { at: Date.now(), data };
  return data;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => live && set({ data, loading: false }))
      .catch((e) => live && set({ error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => {
      live = false;
    };
  }, [...deps, tick]); // eslint-disable-line
  return { ...state, reload: () => setTick((t) => t + 1) };
}
