# GitHub + Firebase setup

One-time setup to get `mybestbuddy.fun` deploying automatically from `main`.

Total time: about 30 minutes. Nothing here touches mainnet or costs money.

---

## What the pipeline does

| Workflow | Runs when | What it does |
|---|---|---|
| `ci.yml` | push to `main`/`develop`, and every PR | keypair guard, typecheck, Rust tests, program build, IDL drift check, 28 integration tests, app build |
| `deploy-staging.yml` | push to `develop` | devnet build → `staging.mybestbuddy.fun`, behind basic auth |
| `deploy.yml` | push to `main` touching `app/` | mainnet build → `mybestbuddy.fun` |
| `preview.yml` | every PR touching `app/` | temporary preview URL, expires after 7 days |

Branching, the staging auth gate and the Blaze requirement are covered in
[ENVIRONMENTS.md](./ENVIRONMENTS.md). This file covers the Firebase and GitHub
setup common to both.

Two guards are worth knowing about, because they exist for this project
specifically:

**The keypair guard** fails the build if any file matching `*keypair*` or
`id.json` is ever tracked by git. Committing the program keypair would let
someone replace your deployed contract; committing the authority keypair would
let them drain the buckets before the config lock.

**The IDL drift check** rebuilds the program and compares the result to
`idl/buddy_distributor.json`. The site builds against that committed copy so
deploys take seconds instead of ten minutes — this check is what stops that
shortcut from ever shipping a UI that disagrees with the deployed contract.

---

## 1. The GitHub repository — already done

`github.com/dullbenz/best_buddy`, currently **private**.

It has to be public before launch: the Verify page asks people to clone the repo
to reproduce the snapshot and to confirm the deployed bytecode matches the
source, and neither works against a private repo.

```bash
gh repo edit dullbenz/best_buddy --visibility public --accept-visibility-change-consequences
```

While it stays private, note that Actions minutes are metered — 2,000/month on
the free tier, versus unlimited for public repos. The `program` job compiles
Rust, so expect roughly 10–25 minutes per push.

---

## 2. Add Firebase to your Google Cloud project

**A Firebase project *is* a Google Cloud project.** They are the same object
seen through two consoles — Firebase is a layer of services switched on over a
GCP project. The CLI says so plainly: `firebase projects:create` is documented
as *"creates a new Google Cloud Platform project, then adds Firebase resources
to the project."*

So you do not need a second project. You already have one, holding your $300
credits, and you should use it — one project, one billing account, and no doubt
about whether the credits apply.

```bash
npm install -g firebase-tools && firebase login
```

```bash
firebase projects:addfirebase <your-gcp-project-id>
```

Find the project id with `gcloud projects list`, or in the Google Cloud console
next to the project name. It is the id, not the display name — often something
like `buddy-472013`.

Then enable Hosting: [console.firebase.google.com](https://console.firebase.google.com)
→ your project → **Build → Hosting → Get started**. Click through the CLI steps
shown; you do not need to run them, the workflow handles deployment.

<details>
<summary>If you would rather start a fresh project instead</summary>

```bash
firebase projects:create mybestbuddy
```

This creates a *new* GCP project underneath. Your credits live on the billing
account rather than the project, so they still apply — but you must link the
same billing account to the new project, or it will bill separately. Reusing
the project you already have avoids that whole question.

</details>

Put the project id into `.firebaserc`, replacing the placeholder. CI refuses to
build `main` or `develop` while any placeholder survives.

---

## 3. Create the deploy service account

This is the credential GitHub uses to publish. Easiest route:

```bash
npm install -g firebase-tools && firebase login && firebase init hosting:github
```

When prompted, point it at your GitHub repo. It creates the service account and
sets the `FIREBASE_SERVICE_ACCOUNT` secret for you.

It may also offer to write its own workflow files — **decline**, or let it and
then delete what it adds. The workflows in `.github/workflows/` already handle
this and include the safety checks.

<details>
<summary>Manual route, if you prefer not to use the CLI</summary>

In Google Cloud Console → IAM → Service Accounts → Create:

- Role: **Firebase Hosting Admin**
- Create a JSON key, download it
- Paste the entire file contents as the GitHub secret `FIREBASE_SERVICE_ACCOUNT`
- Delete the downloaded file afterwards

</details>

---

## 4. Set the GitHub secrets and variables

**Settings → Secrets and variables → Actions.**

Under **Secrets** (encrypted, never printed in logs):

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | the full service-account JSON |

Under **Variables** (visible in logs — never put a secret here):

| Name | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | your Firebase project ID |
| `VITE_RPC_URL` | your Helius/Triton RPC URL |
| `VITE_PROGRAM_ID` | `GBJbhGqP5HR3XfYEqnu7hboEk6PsXcT1y2WNAobQZY11` |

> **On `VITE_RPC_URL`:** anything in a frontend build is public by definition —
> anyone can read the key out of the JavaScript bundle. That is normal and
> unavoidable for a browser dApp. Protect it at the provider instead: in Helius,
> restrict the key to your domain and set a rate limit. Do not reuse the key
> your deploy scripts use.

The deploy workflow fails fast if `VITE_RPC_URL` is unset, rather than shipping
a site that 403s for every visitor.

---

## 5. Connect the domain

Firebase Console → **Hosting → Add custom domain** → `mybestbuddy.fun`.

Firebase gives you DNS records to add at your registrar — typically two A
records, plus a TXT record to prove ownership. Add `www.mybestbuddy.fun` too and
set it to redirect.

DNS propagation takes anywhere from minutes to a few hours. The SSL certificate
is issued automatically once it resolves; until then you will see a certificate
warning, which is expected.

---

## 6. Verify it works

```bash
git commit --allow-empty -m "trigger deploy" && git push
```

Watch **Actions** in GitHub. When it goes green, `https://mybestbuddy.fun`
should show the dashboard. Until the program is deployed to mainnet it will
display "Could not read the distributor" — that is correct, and it means the
site is live and talking to the chain.

---

## Publishing the snapshot proofs

The claim page reads two files from the deployed site:

- `app/public/proofs/old-holders.json`
- `app/public/proofs/influencers.json`

After you run the snapshot:

```bash
cp snapshot/proofs.json app/public/proofs/old-holders.json && cp snapshot/influencers-proofs.json app/public/proofs/influencers.json
```

Commit and push — CI validates the JSON and the deploy publishes them.

Committing them to a public repo is deliberate, not a leak. They contain only
allocations derived from public chain data, and having them in git history
means the community can see exactly when they were published and that they were
never quietly edited afterwards.

---

## Branch protection

Once the repo is public and others are involved, **Settings → Branches → Add
rule** on `main`:

- Require a pull request before merging
- Require status checks: `Safety checks`, `Program build and tests`, `App build`

This stops anyone — including you at 3am on launch night — from pushing
straight to the live claim site.
