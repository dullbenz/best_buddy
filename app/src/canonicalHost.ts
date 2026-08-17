/**
 * Send Firebase's default domains to the real one.
 *
 * Firebase Hosting always serves every site on `<site-id>.web.app` and
 * `<site-id>.firebaseapp.com`, and there is no way to switch that off. For this
 * project that matters more than usual: a second working URL for a claim page
 * is a gift to anyone building a lookalike, and it splits the "one canonical
 * address" message the launch depends on.
 *
 * So the app bounces itself. Not a block (a determined visitor can disable
 * JavaScript), but it means every ordinary visit, every shared link and every
 * crawler that follows redirects ends up on the custom domain.
 *
 * Host-specific because staging and production have different canonical
 * addresses; sending staging to the production domain would break it. When
 * `VITE_CANONICAL_HOST` is unset (local dev) this does nothing at all.
 */
const FIREBASE_DEFAULT_DOMAIN = /\.(web\.app|firebaseapp\.com)$/i;

export function enforceCanonicalHost(): void {
  const canonical = import.meta.env.VITE_CANONICAL_HOST as string | undefined;
  if (!canonical) return;

  const { hostname, pathname, search, hash } = window.location;

  // Already home.
  if (hostname === canonical) return;

  // Only rewrite Firebase's own domains. Anything else (localhost, a preview
  // channel, a domain someone deliberately pointed here) is left alone, so
  // this can never trap a visitor in a redirect loop.
  if (!FIREBASE_DEFAULT_DOMAIN.test(hostname)) return;

  window.location.replace(`https://${canonical}${pathname}${search}${hash}`);
}
