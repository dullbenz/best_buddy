# The game hub

`gamehub.mybestbuddy.fun` — six games, a points ledger, and a weekly prize cycle
paid by hand from the Squads vault.

This document is for whoever operates it: how the pieces fit, how to run a prize
cycle, how to author a hunt, and how to test the whole thing before it ships.

---

## 1. What it is

| | |
|---|---|
| Frontend | `gamehub/` — its own Vite + React app, its own subdomain, its own deploy. Not part of the claim site. |
| Backend | `functions-gamehub/` — a second Cloud Functions codebase: one Express API, one staging gate, five scheduled jobs. |
| Shared | `game-core/` — the deterministic simulations both sides run. |
| Data | Firestore, under `gamehub/{cluster}/…` |

Six games: **Pet the Dog**, **Daily Fetch**, **Buddy vs. The Rugs**, **Bone
Hunt**, **Fetch Tournament**, and **Best Boy** (the reputation layer that ties
the other five together).

### Three things that shape every decision here

**Points are off chain, and prizes are paid by people.** The distributor program
is immutable and has no instruction that pays an arbitrary wallet — there is no
version of this that settles on chain. So the games keep score in Firestore, the
weekly job seals the boards into a snapshot, and a human pays that snapshot from
the team's 2-of-3 Squads vault. Every payout links to its transaction on the
`/prizes` page. No hot wallet ever holds the prize pool.

**Staging and production share one Firebase project.** One Firestore database,
one function namespace. Every document lives under `gamehub/{cluster}/…`, and
every function exists twice under different names (`gamehubApi` /
`gamehubApiStaging`) with the cluster baked in at export time. That is why the
deploy workflows name every function explicitly in `--only`: an unqualified
deploy from `develop` would overwrite production. (The claim site's `terms`
function has exactly this problem today; the hub does not repeat it.)

**A client that reports its own score is not trusted with one.** The browser
sends what the player did — where they aimed, which keys they pressed — and the
server re-runs the same simulation to decide what it was worth. See §5.

---

## 2. Running it locally

```bash
npm install                        # root
npm --prefix gamehub install
npm --prefix functions-gamehub install

cp functions-gamehub/.env.example functions-gamehub/.env.local   # then fill in
cp gamehub/.env.example gamehub/.env.local                       # then fill in

npm run gamehub:sync               # copy game-core + IDL into the functions
npm run emulators                  # auth + functions + firestore
npm run gamehub:dev                # in another shell
```

The dev server proxies `/api` to the devnet function in the emulator, so the
same relative paths work in development, staging and production.

For `functions-gamehub/.env.local`, the values that matter locally:

```
GAMEHUB_SERVER_RPC_URL=https://api.devnet.solana.com
GAMEHUB_PROGRAM_ID=<devnet program id>
GAMEHUB_TEST_KEY=local-test-key
GAMEHUB_STAKE_STUB=*          # treat every wallet as staked, emulator only
STAGING_USER=buddy
STAGING_PASSWORD=local
```

`GAMEHUB_STAKE_STUB` is read only when the Functions emulator is running, so
setting it in a deployed environment does nothing.

---

## 3. Testing

Three layers, cheapest first:

```bash
npm run gamehub:test      # simulation fixtures only — pure, no emulator needed
npm run gamehub:test:api  # the API suite, under the emulators
npm run gamehub:e2e       # the browser suite, under the emulators
```

The split matters: `gamehub:test` is what the deploy workflows run as a
pre-flight, so it must not need anything running. The other two drive real HTTP
against the Functions emulator and start it themselves.

and, against the real deployment:

```bash
# needs the staging basic-auth credentials
E2E_BASE_URL=https://gamehub-staging.mybestbuddy.fun \
E2E_BASIC_USER=buddy E2E_BASIC_PASSWORD=<password> \
GAMEHUB_TEST_KEY=<key> \
npm --prefix gamehub run e2e:staging
```

CI runs the first two on every push. The third runs automatically as a smoke
subset after each staging deploy, and in full from the
**Game hub end-to-end (staging)** workflow.

### The test wallet

Playwright cannot drive a wallet extension, so `gamehub/src/testWallet.ts`
registers a Wallet Standard wallet holding an ephemeral key. Three things keep it
out of production:

1. It is imported only when `VITE_ENABLE_TEST_WALLET=true` at build time, so Vite
   drops the module from every other bundle.
2. CI and the production deploy grep `dist/` for its marker and fail if it is
   present.
3. It stays inert unless a test injects a secret, so even the staging build —
   which does ship it, behind basic auth, on devnet — offers a visitor nothing.

### Testing time

Streaks and weekly cycles are the hard part to test. The devnet API mounts
`/api/test/*` routes, guarded by `GAMEHUB_TEST_KEY`, that call the scheduled jobs
directly:

| Route | Does |
|---|---|
| `POST /api/test/force-daily-rollover` | Seals yesterday's boards, opens today's, expires stale games |
| `POST /api/test/force-weekly-rollover` | Seals the week and cuts a prize snapshot |
| `POST /api/test/reset-wallet/:wallet` | Wipes one wallet's state |

They are mounted inside a `cluster === "devnet"` check, so they are *absent* from
the production function rather than merely guarded within it. The production
deploy verifies this by asserting a 404.

---

## 4. The prize cycle

Once a week, end to end:

**1. Monday 00:05 UTC — the job seals the week.** `gamehubWeekly` freezes the
top of each weekly board into `leaderboardMeta`, applies the prize table from the
config document, and writes `prizeCycles/{cycle}` with the winners and a hash.
Later scores cannot change a sealed board.

**2. Fetch the snapshot.**

```
GET /api/admin/prize-cycle/2026-W35     (admin wallet session)
```

Commit it to the repo so the list is public before it is paid:

```
gamehub/public/receipts/2026-W35.json           # mainnet
gamehub/public/receipts/devnet/2026-W35.json    # staging rehearsals
```

The cluster-scoped path is the same rule the claim site uses for proofs: a
devnet fixture must never be reachable at a real mainnet path.

**3. Build the proposals.**

```bash
RPC_URL=<rpc> SNAPSHOT=gamehub/public/receipts/2026-W35.json \
MINT=G93spDaBFKHEjjURJ38uGoXwD7Wpfv5inihDLhybpump \
npm run gamehub:payout
```

Read-only by default: it verifies the snapshot's hash, aggregates wallets that
won on more than one board, checks the vault's balance, and prints exactly what
would be sent. Then:

```bash
ACTION=propose MULTISIG=<msig> KEYPAIR=<member.json> ... npm run gamehub:payout
```

which creates one Squads proposal per chunk of winners and approves each as that
member. If the vault is short, top it up first with
`scripts/team-withdraw.ts`.

**4. Approve and execute.** Other members approve in the Squads app, or with
`ACTION=approve INDEX=<n>` on `scripts/team-withdraw.ts`, which drives the same
proposals. Then `ACTION=execute INDEX=<n>`.

**5. Record it.**

```
POST /api/admin/prize-cycle/2026-W35/mark-paid
{ "txSignatures": ["…"], "receiptUrl": "/receipts/2026-W35.json" }
```

This publishes `payouts/{cycle}`, which is world-readable, and the `/prizes` page
starts linking every winner's row to the transaction that paid them. Until this
happens the cycle shows publicly as **sealed, not yet paid** — which is the
honest state, and it stays visible.

Two independent copies of every payout exist afterwards: the JSON in the repo and
the document in Firestore. They can be diffed.

---

## 5. How each game is kept honest

| Game | What the client sends | What the server does |
|---|---|---|
| Daily Fetch | Aim and power (two integers) | Re-runs `fetch-sim` on the seed it issued and grades the throw itself |
| Buddy vs. The Rugs | The input trace: which key, which tick | Replays `runner-sim` and keeps its own score; also refuses a run that came back faster than it takes to play |
| Pet the Dog | Nothing but a request | Enforces the cooldown against its own clock, inside a transaction |
| Bone Hunt | A bone code or a puzzle answer | Compares salted hashes it holds in a collection no client can read |
| Tournament | Aim and power | Same as fetch, against a seed shared by both players |
| Best Boy | Nothing | Points only ever arrive through the games above and the daily staking job |

The simulations live once, in `game-core/`, and are copied into the functions by
`scripts/gamehub-sync.mjs` at build and deploy time. `game-core/test/` pins their
exact outputs for known seeds — **if a change moves a fixture, rounds already
issued would replay to a different score than the player watched.** Bump
`SIM_VERSION` and regenerate deliberately; never edit a fixture to make a test
pass.

What replay validation proves is that a run was really played out. It does not
prove a human played it — a script with perfect information will beat any person
at an endless runner. That is one more reason prizes are settled from a reviewed
snapshot rather than paid automatically.

### Rate limits and idempotency

There was no rate limiting anywhere in this project before the hub. Every
mutating endpoint now takes a client-generated `requestId` and records its
response, so a retry after a dropped connection replays instead of scoring twice.
Sign-in is limited per IP; game actions per wallet. App Check is deliberately not
enabled — wallet-bound writes and server-recomputed scores already carry the
weight, and it would add a reCAPTCHA dependency for a deterrent that is routinely
bypassed.

---

## 6. Authoring a hunt

A hunt has two halves, and the split is the security model: `hunts/{id}` is
world-readable and carries clues; `huntsPrivate/{id}` carries salted hashes and
is readable by nobody.

```
POST /api/admin/hunt          (admin wallet session)
{
  "huntId": "hunt-4",
  "title": "The Fourth Dig",
  "intro": "Everything you need is already published.",
  "startAtIso": "2026-09-01T12:00:00Z",
  "endAtIso":   "2026-09-08T12:00:00Z",
  "bones": [
    { "boneId": "home-feed", "name": "The Loud Bone",
      "clue": "Where the pack announces itself.",
      "where": "somewhere on the arcade",
      "code": "home-feed", "maxClaims": 25 }
  ],
  "puzzles": [
    { "puzzleId": "block", "prompt": "Which block carries the message?",
      "answer": "299825",
      "unlocksClue": "Look where the receipts are kept.",
      "revealsBoneCode": "prizes-footer" }
  ]
}
```

Answers are normalised before hashing — case, spaces and punctuation are
ignored, so `Block 299825` and `block299825` are the same answer.

Bone codes correspond to the spots in `gamehub/src/features/hunt/hiddenBones.tsx`
(`BONE_SPOTS`). Each is a real focusable `<button>` with a label, so someone
tabbing through the hub can hunt as well as someone with a mouse.

Good clues lean on the project's own record — the 2014 message, block 299825, the
snapshot, the Merkle roots. That sends people into the main site's provenance and
verify pages, which is the point.

Hunts open and close on their own within five minutes of their times
(`gamehubHuntLifecycle`); `POST /api/admin/hunt/:id/activate` and `/end` override.

---

## 7. Scheduled jobs

Each exists twice, once per cluster. All UTC.

| Job | Schedule | Does |
|---|---|---|
| `gamehubPetAggregate` | every minute | Sums the 20 counter shards, fires milestones |
| `gamehubDaily` | `0 0 * * *` | Seals yesterday's boards, opens today's, expires abandoned games |
| `gamehubWeekly` | `5 0 * * 1` | Seals the week, cuts the prize snapshot |
| `gamehubStakeSnapshot` | `30 0 * * *` | Credits a day of staking points, refreshes stored ranks |
| `gamehubHuntLifecycle` | every 5 min | Opens and closes hunts |

The pet counter is sharded because a single document absorbs roughly one write a
second, which is exactly the traffic shape of a community all petting at once.
Browsers subscribe to the shards and add them up, so the counter feels live
without a function being involved in a single read.

---

## 8. Configuration

Tunable at runtime, without a deploy, in the `gamehub/{cluster}` document:

```
GET  /api/admin/config
POST /api/admin/config  { "config": { "petCooldownMs": 3000 } }
```

Unknown keys are rejected rather than stored, so a typo cannot quietly become a
setting nothing reads. Point values, cooldowns, daily allowances, rank
thresholds, milestones and the prize table all live here.

`cycleAcceleration` exists so staging can run a "week" in an hour during a
rehearsal. Production leaves it at 1.

---

## 8a. One-time IAM the hub needs

Two grants that are easy to miss, because in both cases everything else deploys
and works, and only one narrow thing fails:

**`roles/cloudscheduler.admin` on the deploy service account.** Without it the
API and the gate deploy fine and the five scheduled jobs fail with a 403 on
`cloudscheduler.jobs.update`.

**`roles/iam.serviceAccountTokenCreator` on the functions' runtime service
account, granted on itself.** Minting a Firebase custom token signs a blob, and
without this every `/api/auth/verify` returns a 500 with
`Permission 'iam.serviceAccounts.signBlob' denied` in the logs — sign-in is the
only thing broken, so the hub looks healthy until someone tries to play.

```bash
P=influential-bit-411408
NUM=$(gcloud projects describe $P --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  $NUM-compute@developer.gserviceaccount.com \
  --member="serviceAccount:$NUM-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" --project=$P
```

---

## 9. Environments

| | Staging | Production |
|---|---|---|
| Host | `gamehub-staging.mybestbuddy.fun` | `gamehub.mybestbuddy.fun` |
| Branch | `develop` | `main` |
| Chain | devnet | mainnet |
| Access | basic auth (shared with the claim site's staging) | public |
| API | `gamehubApiStaging` | `gamehubApi` |
| Firestore root | `gamehub/devnet` | `gamehub/mainnet-beta` |
| Test routes | mounted | absent |

Both staging sites point their Hosting `public` at the empty `staging-empty/`
directory, because Firebase serves a matching static file *before* it consults
rewrites — a populated directory would bypass the gate entirely.

New secrets and variables are listed in `docs/CICD.md`. Two are worth calling
out.

`GAMEHUB_STAGING_PROGRAM_ID` is the devnet distributor program, and is separate
from `STAGING_PROGRAM_ID` because that one is pinned to the mainnet id (the claim
site refuses to start if it disagrees with its bundled IDL). The hub reads real
stake accounts, so it needs the program it is actually talking to.

`GAMEHUB_SERVER_RPC_URL` is **not** the browser's endpoint. That key is
locked to the site's origin and rejects server-side calls, so the backend has its
own unrestricted key — which makes it a real secret, unlike the public one.

---

## 10. Rollback

- **Hosting**: Firebase Console → Hosting → the site → Release history → Rollback.
  Instant, per site.
- **Functions**: no built-in rollback for gen 2. `git revert` on the branch and
  push; the paths filter triggers a redeploy.
- **A bad scheduled job**: pause it in Cloud Scheduler while you fix it.

Because every deploy names the functions it touches, rolling the hub back never
disturbs the claim site's `terms` or either staging gate, and vice versa.
