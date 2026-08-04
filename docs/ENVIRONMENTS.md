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

---

## One-time setup

### 1. Create a second hosting site

In the same Firebase project:

```bash
firebase hosting:sites:create mybestbuddy-staging
```

Then wire both names to targets:

```bash
firebase target:apply hosting production <your-production-site-id> && firebase target:apply hosting staging mybestbuddy-staging
```

That writes the `targets` block in `.firebaserc`. Replace the three
`REPLACE_WITH_YOUR_*` placeholders there — CI refuses to build `main` or
`develop` while any of them survive.

### 2. Upgrade to Blaze and enable functions

Firebase Console → **Upgrade** → Blaze, attach the billing account holding your
credits. Set a budget alert while you are there; it costs nothing and removes
the background worry.

### 3. Point the subdomain

Firebase Console → Hosting → the **staging** site → Add custom domain →
`staging.mybestbuddy.fun`. Add the DNS records at your registrar, same as
production.

### 4. Add the staging secrets

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
