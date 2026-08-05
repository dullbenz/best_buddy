# Environments and branching

Two environments, two branches, and one rule that keeps them apart.

| | Staging | Production |
|---|---|---|
| Branch | `develop` | `main` |
| URL | `staging.mybestbuddy.fun` | `mybestbuddy.fun` |
| Chain | **devnet** | **mainnet** |
| Access | basic auth | public |
| Indexed | never (`X-Robots-Tag: noindex`) | yes |
| Workflow | `deploy-staging.yml` | `deploy.yml` |

**The rule: staging never reads mainnet, production never reads devnet.** Both
pipelines enforce it and fail the build rather than shipping a site pointed at
the wrong chain. A devnet build quietly serving real balances — or worse, a
mainnet build offered as a safe place to click around — is the failure mode
worth spending CI checks on.

---

## Day-to-day flow

```
work on develop  →  push  →  CI + staging deploy  →  check staging.mybestbuddy.fun
                                                              ↓
                                                      PR develop → main
                                                              ↓
                                              CI + production deploy → mybestbuddy.fun
```

Do the work on `develop`:

```bash
git checkout develop && git push -u origin develop
```

When staging looks right, open a PR into `main`. Every PR touching `app/` also
gets its own Firebase preview URL from `preview.yml`, expiring after 7 days.

---

## Why staging needs a Cloud Function

Firebase Hosting serves static files and has **no built-in basic auth**. The
staging site therefore rewrites every request to a small Express function
(`functions/index.js`) that checks the `Authorization` header and then serves
the build from its own bundled copy of `app/dist`.

Consequences worth knowing before you set it up:

- **It needs the Blaze plan.** Cloud Functions are not on the free Spark tier.
  With staging traffic measured in a handful of requests a day the actual cost
  rounds to zero, and your $300 GCP credit covers it comfortably — but you do
  have to attach a billing account.
- **The gate fails closed.** No `STAGING_PASSWORD` configured means staging
  returns 503, not an open site. The deploy workflow also refuses to run without
  the secret set.
- **Basic auth is not a security boundary.** It keeps the devnet preview from
  being stumbled upon, indexed, or mistaken for the real thing. That is all it
  is for. Never put anything behind it that would matter if the password leaked.
- **Staging's Hosting `public` directory must stay empty.** It points at
  `staging-empty/`, not `app/dist`. Hosting serves a matching static file
  *before* it applies `rewrites`, so a populated directory would serve `/` and
  every asset around the gate — a site that looks protected and is not. The
  build reaches users inside the function bundle instead, copied to
  `functions/public` by the workflow.

---

## One-time setup

> **Do [CICD.md](./CICD.md) §2 first** if you have not already. It adds Firebase
> to your existing Google Cloud project — the two are the same object, so there
> is no separate "Firebase project" to create and no reason to spend your GCP
> credits twice over. Everything below assumes that is done.

### 1. Create the two hosting sites

One Firebase project can serve several sites. Production and staging are two
sites in the same project, which is why they share a billing account, a service
account and one set of credits:

```bash
firebase hosting:sites:create mybestbuddy && firebase hosting:sites:create mybestbuddy-staging
```

The project also has a default site named after the project id. We do not use
it — a site called `mybestbuddy` gives a cleaner fallback URL than
`influential-bit-411408.web.app`.

Then wire both names to targets:

```bash
firebase target:apply hosting production mybestbuddy && firebase target:apply hosting staging mybestbuddy-staging
```

> `target:apply` **adds** a site to a target rather than replacing it, because
> one target can serve several sites. If you need to re-point a target, clear
> it first: `firebase target:clear hosting production`.

That writes the `targets` block in `.firebaserc`. CI refuses to build `main` or
`develop` while any `REPLACE_WITH_YOUR_*` placeholder survives there, so it will
tell you if a target was missed.

### 2. Upgrade to Blaze and enable the APIs

Firebase Console → **Upgrade** → Blaze, attach the billing account holding your
credits. Set a budget alert while you are there; it costs nothing and removes
the background worry.

Then enable the services a 2nd-gen function is built, stored and run on. The
deploy service account deliberately cannot do this itself — enabling APIs is an
owner-level action, and granting CI that power to save one command is a bad
trade. Run it once, as yourself, in Cloud Shell:

```bash
gcloud services enable artifactregistry.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com run.googleapis.com eventarc.googleapis.com firebaseextensions.googleapis.com pubsub.googleapis.com storage.googleapis.com storage-api.googleapis.com logging.googleapis.com iam.googleapis.com cloudbilling.googleapis.com cloudresourcemanager.googleapis.com serviceusage.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com --project=influential-bit-411408
```

That list is longer than it looks like it should be, and it is deliberate. The
CLI checks its prerequisites in stages, so a short list buys you one further
step and then another `Permissions denied enabling …` on a service you hadn't
heard of. Enabling all of them up front costs nothing — an enabled-but-unused
API is not billed — and turns a sequence of failed deploys into one command.
`cloudbilling` is the surprising one: the CLI reads the project's billing state
to decide whether 2nd-gen functions are permitted at all.

### 3. About the `.web.app` addresses

Firebase always serves every site on `<site-id>.web.app` and
`<site-id>.firebaseapp.com`, and **there is no way to turn that off.** No
console setting, no CLI flag.

That matters here more than on a normal site: a second working URL for a claim
page helps anyone building a lookalike, and it undercuts the "one canonical
address" message the launch relies on.

Two things cover it:

- **Production redirects.** `app/src/canonicalHost.ts` bounces any Firebase
  default domain to `VITE_CANONICAL_HOST`. Not a block — someone with
  JavaScript disabled still gets the page — but every real visit, shared link
  and redirect-following crawler lands on the custom domain.
- **Staging is already sealed.** Its auth gate fronts *all* hosts, so
  `mybestbuddy-staging.web.app` prompts for the password exactly like the
  custom domain, and every response carries `X-Robots-Tag: noindex`.

The canonical host differs per environment, which is why it is a build
variable rather than a constant — pointing staging at the production domain
would make staging unreachable.

| Environment | `VITE_CANONICAL_HOST` |
|---|---|
| production | `mybestbuddy.fun` |
| staging | `staging.mybestbuddy.fun` |

Both have defaults in the workflows; override with the `CANONICAL_HOST` and
`STAGING_CANONICAL_HOST` repository variables if the domains ever change.

### 4. Point the subdomain

Firebase Console → Hosting → the **staging** site → Add custom domain →
`staging.mybestbuddy.fun`. Add the DNS records at your registrar, same as
production.

### 5. Add the staging secrets

**Settings → Secrets and variables → Actions.**

| Type | Name | Value |
|---|---|---|
| Secret | `STAGING_PASSWORD` | the staging password — required |
| Secret | `STAGING_USER` | optional, defaults to `buddy` |
| Variable | `STAGING_RPC_URL` | a devnet RPC; defaults to the public devnet endpoint |
| Variable | `STAGING_PROGRAM_ID` | your devnet program id, if it differs from mainnet |

Share the password out of band — Signal, a password manager, anything that is
not the repo or a public channel.

---

## Local development against mainnet

The production Helius key is compiled into the public JS bundle — that is
unavoidable for a `VITE_` variable — so it is locked at Helius to the origins
that are allowed to use it. Requests from anywhere else get `Forbidden`.

| Allowed origin | Why |
|---|---|
| `mybestbuddy.fun` | production |
| `www.mybestbuddy.fun` | production, www |
| `ryleigh-companyless-outbully.ngrok-free.dev` | local dev and shared test links |

**`localhost` is not on that list and cannot be.** Helius rejects `localhost` as
an allowed-domain value outright. The tempting workaround — a second,
unrestricted key for local use — is worse than it looks: an unrestricted key is
exactly the thing the lock exists to prevent, and it tends to end up pasted
somewhere public.

So route the dev server through the tunnel instead. Two terminals, from the
repo root (both scripts also exist in `app/`, and forward to the same place):

```bash
npm run dev
```

```bash
npm run tunnel
```

Then open **https://ryleigh-companyless-outbully.ngrok-free.dev** — not
`localhost:5173`. The page still comes off your machine with hot reload intact;
only the Origin differs, and that is the one thing Helius checks.

**If the URL returns 404, read the page — it is almost certainly
`ERR_NGROK_3200, endpoint offline`, which ngrok serves with a 404 status.** It
means no agent is connected: `npm run tunnel` is not running, or it was started
and later killed. It is not a routing or Vite problem, and restarting the tunnel
fixes it. The same page appears if the agent is connected but too slow to
answer, which is why the script pins `--region eu`; the default `us` region put
a 2.4-second leg in front of every request and made the tunnel look dead.

The domain is permanently assigned to the account and survives restarts, which
is why it can be allowlisted at all. Two things follow from being on ngrok's
free tier: visitors see a one-time interstitial they must click through, and
the quota is 20k requests and 1GB a month — ample for development, not a way to
host anything.

`vite.config.ts` lists `.ngrok-free.dev` under `server.allowedHosts`; without
that Vite's DNS-rebinding protection answers the tunnel with a 403.

Staging needs none of this — it runs on devnet, whose public RPC takes no key.

---

## Verifying staging works

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://staging.mybestbuddy.fun
```

Expect **401**. Then with credentials:

```bash
curl -sS -u buddy:<password> -o /dev/null -w '%{http_code}\n' https://staging.mybestbuddy.fun
```

Expect **200**. If you get 503, `STAGING_PASSWORD` was not set at deploy time —
the gate is failing closed, which is correct.

---

## Promoting to production

```bash
gh pr create --base main --head develop --title "Release" --fill
```

Before merging, confirm:

- [ ] Staging has been clicked through, including on a phone
- [ ] CI is green on `develop`
- [ ] `VITE_RPC_URL` (production) points at a **mainnet** endpoint
- [ ] `idl/buddy_distributor.json` matches the deployed program

Merging to `main` deploys to `mybestbuddy.fun` automatically.
