import { useCallback, useEffect, useState } from 'react';
import { Studio } from './pages/Studio';
import { Market } from './pages/Market';
import { PresetPage } from './pages/PresetPage';
import { PoolPage } from './pages/PoolPage';
import { Atlas } from './pages/Atlas';
import { Docs } from './pages/Docs';
import { Modal, ToastProvider, useToast, humanError } from './components/ui';
import { useWallet } from './wallet';
import { short } from './lib/format';

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash || '#/');
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [path] = hash.slice(1).split('?');
  return path.split('/').filter(Boolean);
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const parts = useRoute();
  const [page, arg] = parts;
  const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
  let body;
  if (page === 'market') body = <Market />;
  else if (page === 'preset' && arg) body = <PresetPage config={arg} />;
  else if (page === 'pool' && arg) body = <PoolPage address={arg} />;
  else if (page === 'atlas') body = <Atlas />;
  else if (page === 'docs') body = <Docs />;
  else if (page === 'fork' && arg) body = <Studio key={arg} forkConfig={arg} forkCluster={q.get('cluster') === 'mainnet' ? 'mainnet' : 'devnet'} />;
  else body = <Studio key="studio" />;
  const active = page || 'studio';
  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/">
          <Logo />
          <span>Curvesmith</span>
          <span className="net">devnet</span>
        </a>
        <nav>
          <a className={active === 'studio' || active === 'fork' ? 'on' : ''} href="#/">
            Studio
          </a>
          <a className={active === 'market' || active === 'preset' || active === 'pool' ? 'on' : ''} href="#/market">
            Market
          </a>
          <a className={active === 'atlas' ? 'on' : ''} href="#/atlas">
            Atlas
          </a>
          <a className={active === 'docs' ? 'on' : ''} href="#/docs">
            Build with it
          </a>
        </nav>
        <WalletButton />
      </header>
      <main>{body}</main>
      <footer className="foot">
        <span>Built on Meteora Dynamic Bonding Curve + DAMM v2.</span>
        <span>
          <a href="https://github.com/zxreigns/curvesmith" target="_blank" rel="noreferrer">
            GitHub
          </a>
          {' · '}
          <a href="https://docs.meteora.ag/developer-guides/dbc" target="_blank" rel="noreferrer">
            DBC docs
          </a>
        </span>
      </footer>
      <WalletPicker />
      <AutoFund />
    </div>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ff5f2e" />
          <stop offset="1" stopColor="#ffc24b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#1a1210" />
      <path d="M12 50 C 26 49, 36 40, 52 14" stroke="url(#lg)" strokeWidth="6" fill="none" strokeLinecap="round" />
      <circle cx="52" cy="14" r="5" fill="#ffc24b" />
    </svg>
  );
}

function WalletButton() {
  const { signer, walletName, balance, setPickerOpen, disconnect } = useWallet();
  const [menu, setMenu] = useState(false);
  if (!signer)
    return (
      <button className="btn primary sm" onClick={() => setPickerOpen(true)}>
        Connect
      </button>
    );
  return (
    <div className="wallet-wrap">
      <button className="btn sm wallet-btn" onClick={() => setMenu((m) => !m)}>
        <span className="live-dot" />
        {short(signer.publicKey.toBase58())}
        <span className="muted">{balance !== null ? `${balance.toFixed(2)} SOL` : ''}</span>
      </button>
      {menu && (
        <div className="menu" onMouseLeave={() => setMenu(false)}>
          <div className="menu-head">{walletName}</div>
          <button onClick={() => navigator.clipboard?.writeText(signer.publicKey.toBase58())}>Copy address</button>
          <FundButton />
          <button
            onClick={() => {
              disconnect();
              setMenu(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function useDrip() {
  const { signer, refreshBalance } = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const drip = useCallback(
    async (auto = false) => {
      if (!signer) return;
      setBusy(true);
      const t = toast.push({ kind: 'pending', title: auto ? 'Funding your burner wallet' : 'Requesting devnet SOL', body: auto ? 'Free devnet SOL so you can publish, launch and trade right away.' : undefined });
      try {
        const r = await fetch(`/api/drip?to=${signer.publicKey.toBase58()}`, { method: 'POST' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Faucet unavailable');
        toast.update(t, { kind: 'ok', title: `${j.amount} devnet SOL on the way`, sig: j.sig });
        setTimeout(refreshBalance, 2500);
        setTimeout(refreshBalance, 7000);
      } catch (e) {
        toast.update(t, { kind: 'err', title: 'Faucet said no', body: `${humanError(e)} You can also use faucet.solana.com.` });
      } finally {
        setBusy(false);
      }
    },
    [signer, refreshBalance, toast],
  );
  return { drip, busy };
}

/** A fresh burner wallet gets devnet SOL automatically, once, so the first click is never a dead end. */
function AutoFund() {
  const { signer, walletName, balance } = useWallet();
  const { drip } = useDrip();
  useEffect(() => {
    if (!signer || walletName !== 'Burner wallet' || balance === null || balance > 0.02) return;
    const k = `curvesmith:autofund:${signer.publicKey.toBase58()}`;
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, '1');
    drip(true);
  }, [signer, walletName, balance, drip]);
  return null;
}

function FundButton() {
  const { signer } = useWallet();
  const { drip, busy } = useDrip();
  if (!signer) return null;
  return (
    <button disabled={busy} onClick={() => drip(false)}>
      {busy ? 'Requesting…' : 'Get devnet SOL'}
    </button>
  );
}

function WalletPicker() {
  const { options, connect, pickerOpen, setPickerOpen } = useWallet();
  const toast = useToast();
  return (
    <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Connect a wallet">
      <p className="muted small">Curvesmith runs on Solana devnet. Switch your wallet to devnet, or use a burner wallet to try everything in one click.</p>
      <div className="wallets">
        {options.map((o) => (
          <button
            key={o.name}
            className="wallet-opt"
            onClick={() => connect(o).catch((e) => toast.push({ kind: 'err', title: 'Could not connect', body: humanError(e) }))}
          >
            <img src={o.icon} alt="" width={28} height={28} />
            <span>{o.name}</span>
            {o.kind === 'burner' && <span className="pill">instant</span>}
          </button>
        ))}
      </div>
      {options.length === 1 && <p className="micro">No browser wallet detected. The burner wallet lives in this browser only; fund it from the menu.</p>}
    </Modal>
  );
}
