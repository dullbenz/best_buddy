/**
 * Jumping between tabs from inside a tab.
 *
 * The app has no router — tabs are a `useState` in `App`. That is fine until a
 * claim on one page needs to point at the proof on another: "these files match
 * the fingerprint on chain" is worth nothing if checking it means reading a
 * sentence, switching tabs by hand, and hunting for the right card.
 *
 * A custom event rather than prop-drilling `go` through five components, or a
 * context that exists for one interaction. Any component can ask to be taken
 * somewhere; `App` is the only thing that knows how to get there.
 */
export const NAVIGATE_EVENT = "buddy:navigate";

export interface NavigateDetail {
  tab: string;
  /** Element id to scroll to once the tab has rendered. */
  anchor?: string;
}

export function goTo(tab: string, anchor?: string) {
  window.dispatchEvent(
    new CustomEvent<NavigateDetail>(NAVIGATE_EVENT, { detail: { tab, anchor } })
  );
}

/**
 * Stable ids for the Verify checks that other pages link to.
 *
 * Named rather than indexed: an index would silently point at the wrong card
 * the first time a check is inserted above it, and the failure would be a
 * plausible-looking wrong answer rather than a broken link.
 */
export const VERIFY_ANCHORS = {
  snapshotReproducible: "verify-snapshot-reproducible",
  sourceMatchesDeployed: "verify-source-matches-deployed",
  noBackend: "verify-no-backend",
} as const;
