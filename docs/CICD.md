# GitHub + Firebase setup

One-time setup to get `mybestbuddy.fun` deploying automatically from `main`.

Total time: about 30 minutes. Nothing here touches mainnet or costs money.

---

## What the pipeline does

| Workflow | Runs when | What it does |
|---|---|---|
| `ci.yml` | every push and PR | keypair guard, Rust tests, program build, IDL drift check, 28 integration tests, app build |
| `preview.yml` | every PR touching `app/` | deploys a temporary preview URL, expires after 7 days |
| `deploy.yml` | push to `main` touching `app/` | builds and deploys to `mybestbuddy.fun` |

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

## 1. Create the GitHub repository

```bash
cd /Users/dullbenz/Projects/Personal/best_buddy && gh repo create buddy-distributor --public --source=. --remote=origin
```

Public is the right call: the whole pitch is that anyone can verify the
contract. If you want to keep it private until launch, use `--private` and flip
it public before you announce.

Then push:

```bash
git push -u origin main
```

---

## 2. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   sign in with the Google account holding your $300 credits.
2. **Add project** → name it (e.g. `mybestbuddy`) → you can disable Analytics.
3. In the left sidebar: **Build → Hosting → Get started**. Click through the CLI
   steps; you do not need to run them, the workflow handles deployment.
4. Note your **project ID** (shown in Project settings — it may have a numeric
   suffix, like `mybestbuddy-4f2a1`).

Put that ID into `.firebaserc`, replacing the placeholder. CI refuses to build
`main` while the placeholder is still there.

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
