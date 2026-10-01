import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
export type { Connection };
import { keypairSigner, resilientConnection, type Signer } from './core/chain';

/**
 * A tiny Wallet Standard client (Phantom, Solflare, Backpack… all register themselves) plus a
 * local burner wallet for one-click devnet demos. No adapter bundle, no mobile shims.
 */

const CHAIN = 'solana:devnet';
const BURNER_KEY = 'curvesmith:burner';

export interface WalletOption {
  name: string;
  icon: string;
  kind: 'standard' | 'burner';
  wallet?: Wallet;
}

interface Ctx {
  connection: Connection;
  options: WalletOption[];
  signer: Signer | null;
  walletName: string | null;
  balance: number | null;
  connect: (o: WalletOption) => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  pickerOpen: boolean;
  setPickerOpen: (b: boolean) => void;
}

const WalletCtx = createContext<Ctx | null>(null);

const isSolanaWallet = (w: Wallet) =>
  w.chains.some((c) => c.startsWith('solana:')) && 'standard:connect' in w.features && 'solana:signTransaction' in w.features;

function burnerKeypair() {
  const raw = localStorage.getItem(BURNER_KEY);
  if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const kp = Keypair.generate();
  localStorage.setItem(BURNER_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

function standardSigner(wallet: Wallet, account: WalletAccount): Signer {
  const feature = wallet.features['solana:signTransaction'] as {
    signTransaction: (...inputs: { transaction: Uint8Array; account: WalletAccount; chain?: string }[]) => Promise<{ signedTransaction: Uint8Array }[]>;
  };
  return {
    publicKey: new PublicKey(account.publicKey),
    signAll: async (txs: Transaction[]) => {
      const out = await feature.signTransaction(
        ...txs.map((t) => ({ transaction: t.serialize({ requireAllSignatures: false, verifySignatures: false }), account, chain: CHAIN })),
      );
      return out.map((o) => Transaction.from(o.signedTransaction));
    },
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const connection = useMemo(() => resilientConnection(), []);
  const [standard, setStandard] = useState<Wallet[]>([]);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const api = getWallets();
    const sync = () => setStandard(api.get().filter(isSolanaWallet));
    sync();
    const offs = [api.on('register', sync), api.on('unregister', sync)];
    return () => offs.forEach((o) => o());
  }, []);

  const options = useMemo<WalletOption[]>(
    () => [
      ...standard.map((w) => ({ name: w.name, icon: w.icon, kind: 'standard' as const, wallet: w })),
      {
        name: 'Burner wallet',
        icon: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2a1a12"/><path d="M16 6c3 4 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3-1-5 1-8z" fill="#ff7a3d"/></svg>'),
        kind: 'burner' as const,
      },
    ],
    [standard],
  );

  const refreshBalance = useCallback(async () => {
    if (!signer) return setBalance(null);
    try {
      setBalance((await connection.getBalance(signer.publicKey)) / 1e9);
    } catch {
      /* rpc hiccup */
    }
  }, [signer, connection]);

  useEffect(() => {
    refreshBalance();
    const id = setInterval(refreshBalance, 15_000);
    return () => clearInterval(id);
  }, [refreshBalance]);

  const connect = useCallback(async (o: WalletOption) => {
    if (o.kind === 'burner') {
      setSigner(keypairSigner(burnerKeypair()));
    } else {
      const w = o.wallet!;
      const res = await (w.features['standard:connect'] as { connect: () => Promise<{ accounts: readonly WalletAccount[] }> }).connect();
      const account = res.accounts[0] ?? w.accounts[0];
      if (!account) throw new Error('Wallet returned no account');
      setSigner(standardSigner(w, account));
    }
    setWalletName(o.name);
    localStorage.setItem('curvesmith:wallet', o.name);
    setPickerOpen(false);
  }, []);

  // reconnect the burner silently; standard wallets reconnect on click (no surprise popups)
  useEffect(() => {
    if (localStorage.getItem('curvesmith:wallet') === 'Burner wallet' && !signer) {
      setSigner(keypairSigner(burnerKeypair()));
      setWalletName('Burner wallet');
    }
  }, [signer]);

  const disconnect = useCallback(() => {
    setSigner(null);
    setWalletName(null);
    localStorage.removeItem('curvesmith:wallet');
  }, []);

  return (
    <WalletCtx.Provider
      value={{ connection, options, signer, walletName, balance, connect, disconnect, refreshBalance, pickerOpen, setPickerOpen }}
    >
      {children}
    </WalletCtx.Provider>
  );
}

export function useWallet() {
  const c = useContext(WalletCtx);
  if (!c) throw new Error('useWallet outside provider');
  return c;
}
