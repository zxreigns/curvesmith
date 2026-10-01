import { Connection, PublicKey } from '@solana/web3.js';

const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export interface TokenMeta {
  name: string;
  symbol: string;
  uri: string;
}

export function metadataPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from('metadata'), METAPLEX.toBuffer(), mint.toBuffer()], METAPLEX)[0];
}

function readStr(buf: Buffer, o: number): [string, number] {
  const len = buf.readUInt32LE(o);
  const s = buf.subarray(o + 4, o + 4 + len).toString('utf8').replace(/\0/g, '').trim();
  return [s, o + 4 + len];
}

/** Read name/symbol/uri for many mints in one RPC call. */
export async function tokenMetas(conn: Connection, mints: PublicKey[]): Promise<(TokenMeta | null)[]> {
  if (!mints.length) return [];
  const infos = await conn.getMultipleAccountsInfo(mints.map(metadataPda));
  return infos.map((info) => {
    if (!info) return null;
    try {
      const b = Buffer.from(info.data);
      let o = 1 + 32 + 32;
      const [name, o1] = readStr(b, o);
      const [symbol, o2] = readStr(b, o1);
      const [uri] = readStr(b, o2);
      o = o2;
      return { name, symbol, uri };
    } catch {
      return null;
    }
  });
}

/** Deterministic token avatar (same art the metadata endpoint serves). */
export function avatarUrl(symbol: string) {
  return `/api/icon?s=${encodeURIComponent(symbol || '?')}`;
}
