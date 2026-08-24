# Deliberately empty

This is the Hosting `public` directory for **staging**, and it must stay empty.

Firebase Hosting serves a matching static file *before* it consults `rewrites`.
If staging pointed at `app/dist` — as production does — then `/`,
`/assets/index-*.js` and every other built file would be served directly, and
the basic-auth gate in `functions/index.js` would only ever see requests for
paths that don't exist. The site would be wide open while looking protected.

Pointing staging at an empty directory means no request can ever match a static
file, so all of them fall through to the `stagingGate` function, which checks
credentials and then serves its own bundled copy of the build.

The game hub's staging site (`gamehub-staging.mybestbuddy.fun`) points here too,
for the same reason — it falls through to `gamehubStagingGate`, which serves the
hub's own bundle. One empty directory is enough for both: the whole point is
that it contains nothing.

This README is excluded from the deploy by the `**/*.md` ignore rule in
`firebase.json`, so the deployed directory really does contain zero files.
