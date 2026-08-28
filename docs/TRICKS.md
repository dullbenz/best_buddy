# New Tricks — creator-made games

**Status: design RFC, not implemented.** This document proposes the hub's
seventh game: a workshop where the community teaches Buddy new tricks —
players author small games from fixed templates, everyone else plays and
rates them, and the best one each week becomes the Game of the Week with a
prize for its creator.

It is written against the code as it stands (see `docs/GAMEHUB.md` for the
hub itself). Section 10 lists exactly which existing files change.

---

## 1. What it is

One loop, repeated weekly:

**create → review → publish → play & rate → feature → pay.**

A creator fills in a template (a quiz, a word scramble, an emoji riddle) and
submits it with a payout address. An admin approves it. Approved games appear
in a "Community tricks" shelf on the hub, playable by anyone — including
visitors who never connect a wallet. Players rate what they finish. Monday's
weekly job shortlists the eligible games, features the top one for the coming
week, and adds its creator to the prize snapshot the team already pays by
hand from the Squads vault.

### Four decisions that shape everything here

**Creator content is data, never code.** A trick is a Firestore document
validated against one of a fixed set of templates, exactly the way a hunt is
(`functions-gamehub/admin.js`, `prepareHunt`). Nothing a creator submits is
ever executed, rendered as HTML, or fetched from elsewhere. That is what
keeps moderation tractable (you review content, not behaviour), keeps every
trick working on mobile inside the existing shell, and means the play /
scoring / leaderboard plumbing is built once and shared by every trick ever
made.

**Answers never reach the bundle.** Every template splits the way hunts
split: the questions live in a world-readable document, the answers live in a
document nobody can read, as salted hashes or private indices
(`hunts/{id}` / `huntsPrivate/{id}` is the precedent, including
`normalizeAnswer` and `hashSecret` from `functions-gamehub/games/hunt.js`).
The client learns whether it was right from the server, after submitting.

**No wallet is needed to make or play a trick.** People have been reluctant
to connect wallets to a new site, and nothing about playing a quiz needs a
key. Guests get a real session without one (§3). A wallet address appears in
exactly one place: as a plain payout destination on the submission form —
pasted, not connected, and never asked to sign anything.

**Featuring feeds the existing prize pipeline; nothing new touches money.**
The creator's reward becomes one more winner row in `prizeCycles/{week}`,
flows through the same receipts-in-the-repo, Squads-proposal,
`mark-paid` runbook as every other prize (`docs/GAMEHUB.md` §4), and gets the
same human review before anything is sent. Ratings can be gamed; a reviewed
snapshot is the backstop, same as replay validation's backstop today.

---

## 2. The templates

Three at launch, chosen because each is: authorable as plain text in one
sitting, playable in under two minutes, and gradeable by deterministic
integer maths a server can re-run.

| Template | Creator supplies | Player does | Server grades with |
|---|---|---|---|
| **Quiz** | 5–15 questions, 2–4 options each, the correct index, optional 280-char intro | Answers under a per-question clock | Correct indices held in the private doc; speed bonus from answer ticks |
| **Word scramble** | 5–15 words (3–16 letters) with an optional hint each | Unscrambles against the clock | Salted answer hashes; the scramble permutation derives from the round seed via `game-core` RNG, so both sides shuffle identically |
| **Emoji riddle** | 5–12 puzzles: an emoji string (≤ 8 emoji), the answer, an optional hint | Types the answer | Salted answer hashes, hunt-style normalisation ("Block 299825" == "block299825") |

Scoring is shared across templates: a fixed base per correct answer plus a
speed bonus computed from claimed per-item ticks, clamped by the server's own
elapsed-time measurement the way runner clamps (`MIN_ELAPSED_RATIO` in
`games/runner.js`). All of it integer arithmetic in a new
`game-core/tricks-sim.js`, stamped and checked with `SIM_VERSION` like every
other sim, with pinned fixtures in `game-core/test/`.

**Why no drawing game.** The Skribbl-style game people first imagine needs
realtime multiplayer rooms and image moderation, each of which is more
infrastructure than everything else in this document combined. The emoji
riddle keeps the guess-the-picture fun at none of that cost. If tricks get
traction, a drawing game is its own RFC.

**One attempt per player per trick per day.** Enforced with a day-keyed play
document (§8), the same shape as fetch's daily throws. This is also the
answer-leak budget: a submit response reveals the correct answers (that is
half the fun of a quiz), and one attempt a day is what keeps that reveal from
becoming a farming loop.

---

## 3. Identity without a wallet — guest sessions

Today a session is a wallet signature traded for a Firebase custom token with
uid `{cluster}:{wallet}` (`functions-gamehub/auth.js`). Guests reuse those
exact pipes minus the signature:

```
POST /api/auth/guest        (rate-limited per IP, same limiter as challenge)
  → custom token, uid = {cluster}:g:{16 bytes hex}, claim { guest: true }
  → client signInWithCustomToken, same as the wallet flow
```

The client remembers its guest id in localStorage and re-mints on a new
device; the Firebase SDK keeps the session alive in between. Minting through
our own endpoint rather than Firebase anonymous auth is deliberate: staging
and production share one Auth instance, and embedding the cluster in the uid
is what lets `requireSession` reject cross-cluster tokens today. Guest uids
keep that invariant.

The player key throughout tricks is a **playerId**: a base58 wallet address
for signed-in wallets, `g:{hex}` for guests. The two cannot collide (base58
has no `:`).

What each identity can do:

| | Guest | Wallet session |
|---|---|---|
| Play approved tricks, appear on trick boards | yes | yes |
| Rate what they finished | yes | yes |
| Author and submit a trick | yes | yes |
| Earn GBP / rank from playing tricks | no | yes |
| Receive a creator prize | yes — to the payout address on the submission | yes |

**The trade-off, stated plainly:** guests keep the existing points ledger
untouched — `players`, `profiles`, GBP and ranks stay keyed by wallet
exactly as they are, and tricks award GBP only to wallet sessions (§5).
Guests are also free to mint, which is why nothing a guest does carries
weight anywhere money is decided without the gates in §6 and the human
review in §7. Migrating the whole ledger to playerId (so guests accrue GBP
and can attach a wallet later) is possible but invasive, and is out of scope
until tricks prove worth it.

---

## 4. Authoring and moderation

Submission is one endpoint, open to any session:

```
POST /api/tricks/submit     (session + requestId)
{
  "template": "quiz",
  "title": "Buddy Lore: The Early Blocks",
  "intro": "Six questions about where this all started.",
  "payoutWallet": "C2k9…",            ← validated as a 32-byte ed25519 pubkey
  "questions": [
    { "prompt": "Which block carries the 2014 message?",
      "options": ["299825", "310000", "285001"], "answer": 0 }
  ]
}
```

The server mints the `trickId` (12 bytes hex, like challenge ids) — ids are
never client-chosen, so there is nothing to squat. Validation is strict and
boring: template must be one of the three, every string length-capped,
counts within template bounds, the payout address must decode. The payload
then splits, hunt-style: prompts and options into `tricks/{id}` with
`status: "pending"`, answers into `tricksPrivate/{id}` as salted hashes (or
private indices, for quiz). `createdByPlayer` records who to talk to;
`payoutWallet` records who gets paid. They are allowed to differ — an
address that only ever receives money proves nothing and needs to prove
nothing.

**Publication is an admin decision.** `pending → approved | rejected`, via
admin routes (§9). This is the moderation model for v1: curation *is*
moderation, which matches how everything else here ships (hunts are
authored, prizes are reviewed). Auto-publishing with after-the-fact
takedowns can come later if review volume demands it; the status field
already supports it.

After approval, two more transitions exist: `removed` (admin takedown, kept
for the record rather than deleted) and `paused` — set automatically when a
trick accumulates report flags from distinct players past a config
threshold, so the community can yank something offensive off the shelf at
3am without waiting for an admin, and an admin later confirms or reinstates.

Submission abuse is capped the same way fetch caps throws: a per-day counter
on the player's tricks state (config `tricksSubmissionsPerDay`, default 1),
plus a cap on total `pending` docs so a queue cannot be flooded.

---

## 5. Playing and scoring honestly

The universal hub shape, unchanged: start issues a seed, the client sends
inputs, the server re-runs the grading and awards points in the same
transaction, all idempotent under `requestId`.

```
POST /api/tricks/:id/start   → { playId, seed, deadlineIso }
POST /api/tricks/:id/submit  → { answers: [...], ticks: [...], requestId }
                             → { score, correct: [...], answers: [...] }
```

| Template | What the client sends | What the server does |
|---|---|---|
| Quiz | Chosen option index + tick per question | Compares against private indices, scores base + speed bonus, clamps against its own clock |
| Scramble | Typed word + tick per item | Normalises, compares salted hashes; the scramble itself is re-derived from the seed |
| Emoji riddle | Typed answer + tick per item | Normalises, compares salted hashes |

The play writes `trickPlays/{trickId}__{playerId}__{day}` — the daily
attempt gate, the rating gate (§6), and the score record, in one document.
Points flow:

- **The trick's own board** — `awardPoints` to board `tricks:game:{trickId}`
  for every player, guest or wallet. (The id fits the existing board regex
  `^[a-z]+:[a-z]+:[A-Za-z0-9-]+$` as-is.)
- **The featured week's board** — `tricks:weekly:{weekId}`, only while this
  trick is the featured one, so the week has a race worth watching.
- **GBP** — wallet sessions only, `awardPoints({ game: "tricks" })`, capped
  per day (config `tricksPointsCapPerDay`) so a hundred quizzes do not
  out-earn Daily Fetch.

**The field-name trap, called out because it will bite:** `awardPoints`
interpolates its `game` argument into Firestore field names
(`totals.{game}Points`, `profiles.sources.{game}` — see
`functions-gamehub/points.js`). The literal string `"tricks"` is the only
value tricks ever passes there. A `trickId` must never reach that argument,
or user-controlled keys grow in every profile document unboundedly.

---

## 6. Ratings

Two dimensions, 1–5 each: **originality** and **fun**. Two because every
extra dimension halves how many people finish the form.

```
POST /api/tricks/:id/rate    { originality: 4, fun: 5, requestId }
```

Three gates, all cheap:

1. **You rate what you finished.** The endpoint requires a `trickPlays`
   document for this player and trick. No play, no opinion.
2. **One rating per player per trick**, enforced the way hunt claims enforce
   one claim — the rating's document id is `{trickId}__{playerId}`, so a
   second write is an overwrite of your own opinion, not a second vote.
3. **Creators cannot rate their own trick** (playerId match), for the look
   of the thing more than the arithmetic.

Aggregates (`ratingCount`, per-dimension sums, and a plays counter) live on
the public `tricks/{id}` document, updated in the rating transaction, so the
shelf renders scores without a collection scan and without opening the
ratings collection to reads.

Guest ratings count. Guests are also mintable, which is why ratings choose a
shortlist rather than move money — the distinction §7 leans on.

---

## 7. Game of the Week

Monday 00:05 UTC, inside the existing `gamehubWeekly` job (`runWeeklyRollover`
in `functions-gamehub/jobs.js`) — no new scheduled function, no new IAM:

1. **Seal** `tricks:weekly:{closing week}` alongside the other weekly boards.
2. **Shortlist** approved tricks with at least `tricksMinPlaysToFeature`
   plays by at least `tricksMinRatersToFeature` distinct raters this window
   (both config). Rank by mean rating damped toward the middle by rating
   count — a Bayesian mean, so three 5.0s from three friends do not beat
   forty 4.6s.
3. **Feature** the top-ranked trick that has not been featured before:
   write `featuredTricks/{next weekId}` with the trick, the shortlist, and
   the aggregates that decided it. "What is featured right now" is then the
   same one-document query pattern hunts already use for `activeHunt()`.
4. **Reward** — append a winner row for the trick's `payoutWallet` to
   `prizeCycles/{week}` with board `tricks:weekly:{week}` and the amount
   from `config.prizeTable["tricks:weekly"]`.

From there the money path is exactly §4 of `docs/GAMEHUB.md`: the snapshot
is fetched, committed to `gamehub/public/receipts/`, proposed from the
Squads vault, executed, and `mark-paid` publishes the receipt. The humans in
that loop are the sybil backstop: a featured trick whose forty raters were
born yesterday is visible in the snapshot review, and the shortlist stored
beside the pick is the audit trail for choosing the runner-up instead. An
admin override (`POST /api/admin/tricks/feature/:weekId`) exists for exactly
that intervention, before payment, in the open.

Prizes for the *players* of the featured week's board are deliberately not
in v1 — creator reward first, and the featured board race already pays in
GBP for wallet sessions. Extending the prize table to the board's top
finishers later is a config-plus-one-loop change.

---

## 8. Data

All under `gamehub/{cluster}/…`, like everything else.

| Collection | Doc id | Holds |
|---|---|---|
| `tricks` | server-minted hex | Public half: template, title, intro, prompts/options, status, `createdByPlayer`, `payoutWallet`, rating aggregates, play count, `featuredWeek` once featured |
| `tricksPrivate` | same id | Salted answer hashes / correct indices. Readable by nobody, ever |
| `trickPlays` | `{trickId}__{playerId}__{day}` | Score, ticks, submittedAt — attempt gate and rating gate |
| `trickRatings` | `{trickId}__{playerId}` | The two dimensions, playerId, createdAt |
| `trickReports` | `{trickId}__{playerId}` | One flag per player; the count drives auto-pause |
| `featuredTricks` | weekId | The featured trick, the shortlist it beat, the aggregates that decided it |

`firestore.rules` additions, alongside the existing named allowances:
`tricks/{id}` readable when `resource.data.status == "approved"` (clients
must query with that filter, which the shelf does anyway), and
`featuredTricks/{week}` readable. Everything else stays under the default
deny; ratings and plays are served through the API and the aggregates on the
public doc.

Indexes: `tricks` on `status + approvedAt desc` (the shelf), `status +
ratingCount desc` (the shortlist), and `trickPlays` on `trickId + day` if
per-trick daily stats want a cheap query later.

---

## 9. API surface

One new module, `functions-gamehub/games/tricks.js`, exporting
`mountTricksRoutes(app, cluster, { rateLimits })` like its six siblings.

| Route | Session | Does |
|---|---|---|
| `GET  /api/tricks` | none | The shelf: approved tricks, featured first |
| `GET  /api/tricks/:id` | none | One public doc |
| `POST /api/auth/guest` | none (IP-limited) | Mints a guest session |
| `POST /api/tricks/submit` | any | Author a trick (§4) |
| `POST /api/tricks/:id/start` | any | Open today's attempt, issue the seed |
| `POST /api/tricks/:id/submit` | any | Grade, record, award (§5) |
| `POST /api/tricks/:id/rate` | any, played | Rate (§6) |
| `POST /api/tricks/:id/report` | any, played | Flag (§4) |
| `GET  /api/admin/tricks/pending` | admin | Review queue |
| `POST /api/admin/tricks/:id/approve` `reject` `remove` `reinstate` | admin | The status pipeline |
| `POST /api/admin/tricks/feature/:weekId` | admin | Override the auto-pick, before payment |

Rate limits reuse the middleware scopes: guest minting shares the auth
limiter's shape, answer submission sits near the hunt-answer limiter, and
everything mutating takes the standard `requestId`.

Creator display names come for free: the shelf shows `payoutWallet` through
the existing `/api/names` pump.fun proxy, address always visible beside the
name, same rule as everywhere else.

---

## 10. Wiring — what existing code changes

The hub has no game registry; the report of record is that adding a game
touches six places. Tricks touches the same six, once, and is itself
data-driven from then on — new tricks are documents, not deploys.

1. **`gamehub/src/router.ts`** — a `tricks` tab in `TABS`/`SLUGS`, and a
   second param route, `/tricks/:trickId` (the first and only precedent is
   `/wallet/:address`).
2. **`gamehub/src/App.tsx`** — lazy imports and routes for `TricksPage`
   (the shelf + authoring form) and `TrickPlayPage` (one trick inside the
   existing `GameShell`, template-switched on the public doc).
3. **`gamehub/src/features/home/HubHome.tsx`** — a "Community tricks" shelf
   under the six fixed cards: the featured trick with its creator's name,
   then the rest from `GET /api/tricks`. The six-card `GAMES` array stays a
   literal; the shelf is the data-driven part.
4. **`functions-gamehub/api.js`** — import and mount `mountTricksRoutes`,
   and the guest-mint route beside the auth routes.
5. **`functions-gamehub/jobs.js`** — the weekly rollover grows the
   seal/shortlist/feature/reward steps of §7; the daily job needs nothing
   (attempt gates are day-keyed ids, they expire by construction).
6. **`functions-gamehub/db.js` + `firestore.rules` +
   `firestore.indexes.json`** — the new `DEFAULT_CONFIG` keys (the admin
   config endpoint rejects unknown keys, so these land first or nothing is
   tunable): `tricksSubmissionsPerDay`, `tricksAttemptsPerTrickPerDay`,
   `tricksPointsCapPerDay`, `tricksMinPlaysToFeature`,
   `tricksMinRatersToFeature`, `tricksReportsToPause`, and
   `prizeTable["tricks:weekly"]`. Plus the rules and indexes of §8.

And one new sim: `game-core/tricks-sim.js` with pinned fixtures, synced into
`functions-gamehub/core/` by the existing `scripts/gamehub-sync.mjs` with no
changes to that script.

Deploys change **nothing**: same two function exports, same `--only` lists,
no new scheduled jobs, no new IAM. `docs/GAMEHUB.md` gains an "Authoring"
cross-reference (§1's game list, §5's honesty table, and a pointer here).

---

## 11. Tests

The three existing layers, cheapest first:

- **`game-core/test/tricks-sim.test.js`** — pinned fixtures for scoring and
  the seed-derived scramble permutation, the clamp-don't-trust input sweeps,
  malformed-input throws. Same doctrine as `sims.test.js`: never edit a
  fixture to make a test pass; bump `SIM_VERSION` deliberately.
- **API suite** — each route's happy path plus the ways it can be cheated,
  because the second half is the half worth testing: a replayed `requestId`
  does not double-score; a second attempt the same day is refused; rating
  without playing is refused; a creator rating their own trick is refused; a
  guest token from the wrong cluster is rejected; a pending trick is
  invisible to `GET /api/tricks` and unplayable; answers absent from the
  public doc (assert the bundle-side shape directly); the submission
  validator rejects an un-decodable payout address; report flags pause at
  the threshold.
- **Playwright** — a `@smoke`-tagged describe: author as a guest, approve
  through the admin session, play, rate, `force-weekly-rollover`, and see
  the featured banner and the creator's winner row in the snapshot.

The weekly logic takes an injectable `at` like the rest of `jobs.js`, and
staging rehearses a whole cycle under `cycleAcceleration` exactly as prize
weeks are rehearsed today.

---

## 12. Out of scope, and why

- **A drawing/Skribbl game** — realtime rooms and image moderation; its own
  RFC if tricks earn it (§2).
- **Guest GBP and wallet attachment** — a playerId-keyed ledger is invasive
  surgery on collections that work; revisit when guests are a proven
  audience (§3).
- **Player prizes on the featured board** — config-plus-one-loop away once
  the creator cycle has run a few honest weeks (§7).
- **Auto-publishing without review** — the status pipeline supports it; the
  review queue has to hurt first (§4).
- **On-chain anything** — points are off chain and prizes are paid by
  people; nothing in this feature bends either rule.
