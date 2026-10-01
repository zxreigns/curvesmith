import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { explorer } from '../core/chain';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
  log,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
  log?: boolean;
}) {
  const toPos = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (p: number) => (log ? min * (max / min) ** p : min + p * (max - min));
  const snap = (v: number) => (log ? Number(v.toPrecision(3)) : Math.round(v / step) * step);
  return (
    <label className="slider">
      <div className="slider-top">
        <span>{label}</span>
        <b>{format ? format(value) : value}</b>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(toPos(value) * 1000)}
        onChange={(e) => onChange(snap(fromPos(+e.target.value / 1000)))}
        style={{ ['--p' as string]: `${toPos(value) * 100}%` }}
      />
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* ---------- transaction toasts ---------- */
export interface Toast {
  id: number;
  title: string;
  body?: string;
  sig?: string;
  kind: 'pending' | 'ok' | 'err';
}
const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => number; update: (id: number, t: Partial<Toast>) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { ...t, id }]);
    if (t.kind !== 'pending') setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 7000);
    return id;
  }, []);
  const update = useCallback((id: number, t: Partial<Toast>) => {
    setList((l) => l.map((x) => (x.id === id ? { ...x, ...t } : x)));
    if (t.kind && t.kind !== 'pending') setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 8000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push, update }}>
      {children}
      <div className="toasts">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <div className="toast-title">
              {t.kind === 'pending' && <span className="spin" />}
              {t.kind === 'ok' && <span className="ok-dot">✓</span>}
              {t.kind === 'err' && <span className="err-dot">!</span>}
              {t.title}
            </div>
            {t.body && <div className="toast-body">{t.body}</div>}
            {t.sig && (
              <a href={explorer('tx', t.sig)} target="_blank" rel="noreferrer" className="toast-link">
                View on Solscan ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast outside provider');
  return c;
}

/** Turn wallet/RPC errors into one human sentence. */
export function humanError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/User rejected|rejected the request|declined/i.test(m)) return 'You declined the signature in your wallet.';
  if (/insufficient (funds|lamports)|0x1\b|debit an account/i.test(m)) return 'Not enough devnet SOL. Top up your wallet and try again.';
  if (/blockhash/i.test(m)) return 'The network was slow and the transaction expired. Try again.';
  if (/Virtual pool is completed/i.test(m)) return 'This curve is complete. It can graduate to DAMM v2 now.';
  if (/429|Too Many/i.test(m)) return 'The public devnet RPC is rate-limiting. Wait a few seconds and retry.';
  return m.length > 180 ? m.slice(0, 180) + '…' : m;
}
