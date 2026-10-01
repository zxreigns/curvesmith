import { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { launchToken } from '../core/chain';
import { useWallet } from '../wallet';
import { humanError, Modal, useToast } from './ui';

export function tokenUri(name: string, symbol: string) {
  const o = typeof window !== 'undefined' ? window.location.origin : 'https://curvesmith.vercel.app';
  return `${o}/api/meta?n=${encodeURIComponent(name)}&s=${encodeURIComponent(symbol)}`;
}

export function LaunchModal({ open, onClose, config, presetName, quoteSymbol = 'SOL' }: { open: boolean; onClose: () => void; config: string; presetName: string; quoteSymbol?: string }) {
  const { connection, signer, setPickerOpen, refreshBalance } = useWallet();
  const toast = useToast();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [firstBuy, setFirstBuy] = useState(0.1);
  const [busy, setBusy] = useState(false);
  const isSol = quoteSymbol === 'SOL';

  const go = async () => {
    if (!signer) return setPickerOpen(true);
    setBusy(true);
    const t = toast.push({ kind: 'pending', title: `Launching $${symbol}`, body: 'Approve in your wallet…' });
    try {
      const res = await launchToken(
        connection,
        signer,
        new PublicKey(config),
        { name: name.trim(), symbol: symbol.trim().toUpperCase(), uri: tokenUri(name.trim(), symbol.trim().toUpperCase()) },
        isSol ? Math.round(firstBuy * 1e9) : 0,
        (sig) => toast.update(t, { body: 'Confirming on devnet…', sig }),
      );
      toast.update(t, { kind: 'ok', title: `$${symbol.toUpperCase()} is live on its curve`, body: 'Opening the pool…', sig: res.sigs[0] });
      refreshBalance();
      onClose();
      window.location.hash = `#/pool/${res.pool.toBase58()}`;
    } catch (e) {
      toast.update(t, { kind: 'err', title: 'Launch failed', body: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  const valid = name.trim().length >= 2 && /^[a-zA-Z0-9]{2,10}$/.test(symbol.trim());
  return (
    <Modal open={open} onClose={onClose} title={`Launch a token on “${presetName}”`}>
      <p className="muted small">
        Anyone can launch on a published preset. Your token gets its own DBC pool on this exact curve, and the preset author earns their fee share on every trade.
      </p>
      <div className="form">
        <label>
          Token name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Forge Cat" maxLength={32} />
        </label>
        <label>
          Ticker
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="FCAT" maxLength={10} />
        </label>
        {isSol && (
          <label>
            Your first buy (atomic with the launch, so nobody snipes you)
            <div className="inline">
              <input type="number" min={0} step={0.05} value={firstBuy} onChange={(e) => setFirstBuy(Math.max(0, +e.target.value))} />
              <span className="unit">SOL</span>
            </div>
          </label>
        )}
      </div>
      <button className="btn primary block" disabled={!valid || busy} onClick={go}>
        {signer ? (busy ? 'Launching…' : 'Launch on devnet') : 'Connect a wallet'}
      </button>
    </Modal>
  );
}
