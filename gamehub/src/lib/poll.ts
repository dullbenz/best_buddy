/**
 * Polling that stops when nobody is looking.
 *
 * A backgrounded tab polling a Cloud Function every ten seconds costs money and
 * tells nobody anything, so every poller pauses on `visibilitychange` and
 * fetches immediately on return — which is also the moment the data is most
 * obviously stale to the person looking at it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PollState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
};

export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const run = async () => {
      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (caught: any) {
        if (!cancelled) setError(caught);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(async () => {
        await run();
        schedule();
      }, intervalMs);
    };

    const onVisibility = () => {
      if (document.hidden) {
        window.clearTimeout(timer);
      } else {
        void run();
        schedule();
      }
    };

    void run();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, nonce, ...deps]);

  // Memoised: callers put this in dependency arrays, and a fresh object every
  // render silently restarts whatever those dependencies drive — which, in a
  // game loop, means a run that can never end.
  return useMemo(() => ({ data, error, loading, reload }), [data, error, loading, reload]);
}

/** A ticking clock for countdowns. One interval, shared by whoever needs it. */
export function useClock(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
