import { useCallback, useEffect, useRef, useState } from 'react';
import type { Design } from '../core/model';

/** Design state with a smooth weight tween when switching presets (the curve morphs, not jumps). */
export function useDesign(initial: Design) {
  const [design, setDesign] = useState<Design>(initial);
  const raf = useRef<number>();

  const morphTo = useCallback((target: Design, ms = 520) => {
    cancelAnimationFrame(raf.current!);
    const from = design;
    const t0 = performance.now();
    const ease = (t: number) => 1 - (1 - t) ** 3;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const lerpLog = (a: number, b: number, t: number) => Math.exp(lerp(Math.log(a), Math.log(b), t));
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      setDesign({
        ...target,
        weights: target.weights.map((w, i) => lerp(from.weights[i] ?? w, w, e)),
        initialMarketCap: lerpLog(from.initialMarketCap, target.initialMarketCap, e),
        migrationMarketCap: lerpLog(from.migrationMarketCap, target.migrationMarketCap, e),
      });
      if (t < 1) raf.current = requestAnimationFrame(step);
      else setDesign(target);
    };
    raf.current = requestAnimationFrame(step);
  }, [design]);

  useEffect(() => () => cancelAnimationFrame(raf.current!), []);
  const patch = useCallback((fn: (d: Design) => void) => {
    setDesign((d) => {
      const next: Design = structuredClone(d);
      fn(next);
      return next;
    });
  }, []);
  return { design, setDesign, morphTo, patch };
}

export const encodeDesign = (d: Design) => btoa(unescape(encodeURIComponent(JSON.stringify(d))));
export const decodeDesign = (s: string): Design | null => {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  } catch {
    return null;
  }
};
