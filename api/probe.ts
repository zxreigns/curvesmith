export default async function handler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  const out: Record<string, string> = {};
  const tryIt = async (k: string, f: () => Promise<Record<string, unknown>>) => {
    try {
      out[k] = 'ok ' + Object.keys(await f()).length;
    } catch (e) {
      out[k] = String((e as Error)?.stack || e).slice(0, 1200);
    }
  };
  await tryIt('web3', () => import('@solana/web3.js'));
  await tryIt('sdk', () => import('@meteora-ag/dynamic-bonding-curve-sdk'));
  res.status(200).json(out);
}
