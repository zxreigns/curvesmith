export default async function handler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  const out: Record<string, string> = {};
  for (const m of ['@solana/web3.js', '@coral-xyz/anchor', '@meteora-ag/dynamic-bonding-curve-sdk']) {
    try {
      const mod = await import(m);
      out[m] = 'ok ' + Object.keys(mod).length;
    } catch (e) {
      out[m] = String((e as Error)?.stack || e).slice(0, 900);
    }
  }
  res.status(200).json(out);
}
