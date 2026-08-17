/**
 * Real URLs for the tabs.
 *
 * The app was a `useState` switch with no address bar involvement, which meant
 * a refresh dumped you back on the landing page, the back button left the site
 * entirely, and there was no way to send someone a link to the Claims page.
 * On a site whose whole pitch is "go and check this", not being able to link to
 * the thing you are asking people to check is a real gap.
 *
 * Hand-rolled on the History API rather than pulling in a router: there are
 * seven tabs and one optional sub-section, and a dependency would be more code
 * than this file. Firebase Hosting already rewrites `**` to index.html, and
 * Vite's dev server does the same, so deep links resolve on both.
 */

/** Tab label as shown in the nav, e.g. "fund pool" ↔ URL slug "fund-pool". */
export const slugFor = (tab: string) => tab.replace(/\s+/g, "-");
const tabFor = (slug: string) => slug.replace(/-/g, " ");

export interface Route {
  tab: string;
  /** Second path segment, used by the Claims sub-sections. */
  section: string | null;
  /**
   * False when the URL did not name a real tab and `tab` is the home
   * fallback. Callers need this to tell "/" apart from "/nonsense": both
   * render home, but only the second one has a URL that should be corrected.
   */
  matched: boolean;
}

export function pathFor(tab: string, section?: string | null): string {
  if (tab === "home") return "/";
  const base = `/${slugFor(tab)}`;
  return section ? `${base}/${slugFor(section)}` : base;
}

/**
 * Read the current URL.
 *
 * Unknown paths fall back to home rather than rendering nothing: a stale or
 * mistyped link should land somewhere useful, not on a blank page.
 */
export function parseLocation(known: readonly string[]): Route {
  const [, first = "", second = ""] = window.location.pathname.split("/");
  if (!first) return { tab: "home", section: null, matched: true };
  const tab = tabFor(decodeURIComponent(first));
  if (!known.includes(tab)) return { tab: "home", section: null, matched: false };
  return {
    tab,
    section: second ? tabFor(decodeURIComponent(second)) : null,
    matched: true,
  };
}

/** Push only when the path actually changes, so back does not collect repeats. */
export function pushRoute(tab: string, section?: string | null) {
  const next = pathFor(tab, section);
  if (window.location.pathname === next) return;
  window.history.pushState({}, "", next);
}

/** Replace, for corrections that should not add a history entry of their own. */
export function replaceRoute(tab: string, section?: string | null) {
  const next = pathFor(tab, section);
  if (window.location.pathname === next) return;
  window.history.replaceState({}, "", next);
}

export function onRouteChange(handler: () => void): () => void {
  window.addEventListener("popstate", handler);
  return () => window.removeEventListener("popstate", handler);
}
