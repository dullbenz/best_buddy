/**
 * A hand-rolled History API router, matching the claim site's approach
 * (app/src/router.ts). No dependency, no nested routes, one param route.
 *
 * Deep links work because both Firebase Hosting and the Vite dev server rewrite
 * unknown paths to index.html.
 */
import { useEffect, useState } from "react";

export const TABS = [
  "arcade",
  "fetch",
  "pet",
  "ranks",
  "hunt",
  "runner",
  "tournament",
  "tricks",
  "prizes",
] as const;

export type Tab = (typeof TABS)[number] | "profile" | "trick";

export type Route = { tab: Tab; param?: string };

const SLUGS: Record<string, Tab> = {
  "": "arcade",
  fetch: "fetch",
  pet: "pet",
  ranks: "ranks",
  hunt: "hunt",
  runner: "runner",
  tournament: "tournament",
  tricks: "tricks",
  prizes: "prizes",
};

function looksLikeAddress(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

/** Trick ids are server-minted 12-byte hex — the guard must match exactly,
 *  because anything that falls through is silently rewritten to the arcade. */
function looksLikeTrickId(value: string) {
  return /^[0-9a-f]{24}$/.test(value);
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const [first, second] = parts;

  if (first === "wallet" && second && looksLikeAddress(second)) {
    return { tab: "profile", param: second };
  }
  if (first === "tricks" && second && looksLikeTrickId(second)) {
    return { tab: "trick", param: second };
  }

  const tab = SLUGS[first ?? ""];
  return tab ? { tab } : { tab: "arcade" };
}

export function pathFor(tab: Tab, param?: string): string {
  if (tab === "profile") return `/wallet/${param}`;
  if (tab === "trick") return `/tricks/${param}`;
  return tab === "arcade" ? "/" : `/${tab}`;
}

export function navigate(tab: Tab, param?: string) {
  const path = pathFor(tab, param);
  if (path !== location.pathname) {
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

export function replaceRoute(tab: Tab, param?: string) {
  history.replaceState({}, "", pathFor(tab, param));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    // An unknown path renders the arcade; correct the URL so a reload or a
    // shared link lands somewhere real.
    const parsed = parseRoute(location.pathname);
    if (parsed.tab === "arcade" && location.pathname !== "/") {
      history.replaceState({}, "", "/");
    }
  }, [route]);

  return route;
}
