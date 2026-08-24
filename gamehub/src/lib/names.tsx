/**
 * pump.fun display names, resolved in batches.
 *
 * A leaderboard renders twenty-five wallet chips and a feed renders forty more.
 * If each one fetched its own name that would be sixty-five requests for one
 * screen, so chips register interest here instead and the provider asks once,
 * shortly after the render settles.
 *
 * Names are decoration. Nothing waits on them, nothing breaks without them, and
 * a wallet that has no pump.fun profile simply keeps showing its address —
 * which is the identifier that was actually verifiable to begin with.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "./api";

export type PumpName = { username: string; image: string | null };

type NamesState = {
  names: Map<string, PumpName>;
  request: (address: string) => void;
};

const NamesContext = createContext<NamesState>({ names: new Map(), request: () => {} });

/** How long to gather addresses before asking. One frame is too eager. */
const BATCH_DELAY_MS = 200;
const BATCH_SIZE = 40;

export function NamesProvider({ children }: { children: React.ReactNode }) {
  const [names, setNames] = useState<Map<string, PumpName>>(new Map());
  // Everything already asked about, found or not, so a wallet with no profile
  // is not re-requested on every render.
  const asked = useRef<Set<string>>(new Set());
  const queue = useRef<Set<string>>(new Set());
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    const batch = [...queue.current].slice(0, BATCH_SIZE);
    if (!batch.length) return;
    batch.forEach((address) => queue.current.delete(address));

    try {
      const result = await api.names(batch);
      const found = Object.entries(result.names || {});
      if (!found.length) return;
      setNames((current) => {
        const next = new Map(current);
        for (const [address, name] of found) next.set(address, name as PumpName);
        return next;
      });
    } catch {
      // Silent: the addresses are already on screen and remain correct.
    }
  }, []);

  const request = useCallback(
    (address: string) => {
      if (!address || asked.current.has(address)) return;
      asked.current.add(address);
      queue.current.add(address);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), BATCH_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const value = useMemo(() => ({ names, request }), [names, request]);
  return <NamesContext.Provider value={value}>{children}</NamesContext.Provider>;
}

/** The pump.fun name for a wallet, once known. Registers interest on first use. */
export function useName(address: string | null | undefined): PumpName | null {
  const { names, request } = useContext(NamesContext);

  useEffect(() => {
    if (address) request(address);
  }, [address, request]);

  return address ? names.get(address) ?? null : null;
}
