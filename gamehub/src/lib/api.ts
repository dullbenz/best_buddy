/**
 * The typed client for the hub API.
 *
 * One place that knows about URLs, bearer tokens, error envelopes and server
 * time. Components call the named functions and never see a fetch.
 */
import { API_BASE } from "../config";

export class ApiError extends Error {
  code: string;
  status: number;
  details: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type TokenProvider = () => Promise<string | null>;

let getToken: TokenProvider = async () => null;
export function setTokenProvider(provider: TokenProvider) {
  getToken = provider;
}

/**
 * Difference between this device's clock and the server's.
 *
 * Countdowns matter here — "your throws come back in 4h" is wrong and annoying
 * on a device whose clock is off. Every response carries a time; we keep the
 * offset and every countdown in the app is drawn against server time.
 */
let clockSkewMs = 0;
export const serverNow = () => Date.now() + clockSkewMs;

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(
  path: string,
  { method = "GET", body, auth = true }: { method?: string; body?: any; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) {
    const token = await getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "OFFLINE", "Can't reach the hub. Check your connection.");
  }

  const serverDate = response.headers.get("date");
  if (serverDate) {
    const parsed = Date.parse(serverDate);
    if (Number.isFinite(parsed)) clockSkewMs = parsed - Date.now();
  }

  const text = await response.text();
  const payload = text ? safeParse(text) : null;

  if (!response.ok) {
    const error = payload?.error || {};
    if (response.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(
      response.status,
      error.code || "ERROR",
      error.message || "Something went wrong.",
      error.details,
    );
  }

  return payload as T;
}

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Client-generated id so a retried request cannot score twice. */
export function requestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* --------------------------------- types -------------------------------- */

export type Grade = "perfect" | "good" | "okay" | "miss";

export type Field = { buddyStartX: number; windPerTick: number };

export type ThrowResult = {
  grade: Grade;
  label: string;
  base: number;
  comboBonus: number;
  multiplierX100: number;
  points: number;
  throwIndex: number;
  throwsRemaining: number;
  todayPoints: number;
  streakDays: number;
  perfectStreak: number;
  resetsAt: string;
  flight: { vx: number; vy: number; flightTicks: number; landingX: number; gravity: number };
  field: Field;
  buddy: { runDistance: number; reach: number; margin: number; speed: number };
  nextField: Field | null;
};

export type FetchRound = {
  roundId: string;
  seed: string;
  mode: "normal" | "golden";
  throwIndex: number;
  throwsRemaining: number;
  throwsPerDay: number;
  streakDays: number;
  multiplierX100: number;
  todayPoints: number;
  resetsAt: string;
  goldenEligible: boolean;
  field: Field;
};

export type Profile = {
  wallet: string;
  gbp: number;
  rank: string;
  rankName: string;
  nextRank: string | null;
  nextRankName: string | null;
  pointsToNext: number;
  progressPct: number;
  sources: Record<string, number>;
  petCount: number;
  wins: number;
  losses: number;
  draws: number;
  streakDays: number;
  longestStreak: number;
  runnerBest: number;
  position?: number | null;
};

export type Me = {
  wallet: string;
  cluster: string;
  admin: boolean;
  profile: Profile;
  stake: { staked: boolean; totalAmount: string; lockupCount: number; source: string };
  perks: { goldenBone: boolean; superPet: boolean; extraShovels: number };
};

export type FeedEvent = {
  id: string;
  type: string;
  wallet: string | null;
  text: string;
  points: number | null;
  createdAtMs: number;
};

export type Summary = {
  cluster: string;
  totalPets: number;
  nextMilestone: number | null;
  lastMilestone: number;
  currentWeek: string;
  currentDay: string;
  boards: { fetchWeekly: string; petDaily: string; runnerWeekly: string };
  feed: FeedEvent[];
};

export type BoardEntry = { position: number; wallet: string; points: number; plays?: number };

export type Leaderboard = {
  board: string;
  status: "open" | "final";
  endsAt: string | null;
  top: BoardEntry[];
  you: (BoardEntry & { position: number }) | null;
};

export type Challenge = {
  challengeId: string;
  from: string;
  to: string | null;
  opponent: string | null;
  status: "open" | "accepted" | "scored" | "expired";
  yourScore: number | null;
  yourThrows: number;
  theirScore: number | null;
  winner: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  yourTurn: boolean;
};

export type HuntView = {
  hunt: {
    huntId: string;
    title: string;
    intro: string;
    startAtIso: string;
    endAtIso: string;
    bones: {
      boneId: string;
      clue: string;
      where: string;
      maxClaims: number;
      claimsSoFar: number;
      remaining: number;
    }[];
    puzzles: { puzzleId: string; prompt: string }[];
  } | null;
  nextHuntAt?: string | null;
  shovels: { remaining: number; allowance: number; used: number; staked: boolean } | null;
  found: string[];
};

/* -------------------------------- endpoints ------------------------------ */

export const api = {
  health: () => request<{ ok: boolean; cluster: string; commit: string }>("/healthz", { auth: false }),

  summary: () => request<Summary>("/summary", { auth: false }),

  me: () => request<Me>("/me"),

  challenge: (wallet: string) =>
    request<{ nonce: string; message: string; expiresAt: string }>("/auth/challenge", {
      method: "POST",
      body: { wallet },
      auth: false,
    }),

  verify: (wallet: string, nonce: string, signature: string) =>
    request<{ token: string; wallet: string; admin: boolean }>("/auth/verify", {
      method: "POST",
      body: { wallet, nonce, signature },
      auth: false,
    }),

  /* pet */
  pet: () =>
    request<{ points: number; cooldownUntil: number; petCount: number }>("/pet", {
      method: "POST",
      body: { requestId: requestId() },
    }),
  superPet: () =>
    request<{ points: number; cooldownUntil: number; petCount: number }>("/pet/super", {
      method: "POST",
      body: { requestId: requestId() },
    }),
  petState: () =>
    request<{ totalPets: number; nextMilestone: number | null; lastMilestone: number | null }>(
      "/pet/state",
      { auth: false },
    ),

  /* fetch */
  fetchStart: () => request<FetchRound>("/fetch/start", { method: "POST" }),
  fetchThrow: (roundId: string, angleQ: number, powerQ: number) =>
    request<ThrowResult>("/fetch/throw", {
      method: "POST",
      body: { roundId, angleQ, powerQ, requestId: requestId() },
    }),
  fetchState: () =>
    request<{
      throwsRemaining: number;
      throwsPerDay: number;
      todayPoints: number;
      streakDays: number;
      multiplierX100: number;
      goldenEligible: boolean;
      resetsAt: string;
    }>("/fetch/state"),

  /* runner */
  runnerStart: () => request<{ runId: string; seed: string }>("/runner/start", { method: "POST" }),
  runnerSubmit: (
    runId: string,
    inputs: { tick: number; action: number }[],
    score: number,
  ) =>
    request<{
      accepted: boolean;
      score: number;
      distance: number;
      bones: number;
      points: number;
      personalBest: number;
      isPersonalBest: boolean;
    }>("/runner/submit", {
      method: "POST",
      body: { runId, inputs, score, requestId: requestId() },
    }),

  /* reputation */
  reputation: (wallet: string) =>
    request<Profile & { ladder: { key: string; name: string; threshold: number }[] }>(
      `/reputation/${wallet}`,
      { auth: false },
    ),
  ranks: (limit = 50) =>
    request<{ top: { position: number; wallet: string; gbp: number; rank: string }[] }>(
      `/ranks?limit=${limit}`,
      { auth: false },
    ),
  leaderboard: (board: string, limit = 25) =>
    request<Leaderboard>(`/leaderboard/${encodeURIComponent(board)}?limit=${limit}`),

  /* hunt */
  huntCurrent: () => request<HuntView>("/hunt/current"),
  huntAnswer: (huntId: string, puzzleId: string, answer: string) =>
    request<{ correct: boolean; clue: string | null; boneCode: string | null }>(
      `/hunt/${huntId}/answer`,
      { method: "POST", body: { puzzleId, answer } },
    ),
  huntDig: (huntId: string, boneCode: string) =>
    request<{
      found: boolean;
      boneId?: string;
      name?: string;
      finderRank?: number;
      points?: number;
      remaining?: number;
      shovelsRemaining: number;
      message?: string;
    }>(`/hunt/${huntId}/dig`, {
      method: "POST",
      body: { boneCode, requestId: requestId() },
    }),
  huntInventory: () =>
    request<{ bones: { huntId: string; boneId: string; finderRank: number; points: number }[] }>(
      "/hunt/inventory",
    ),

  /* tournament */
  tournamentCreate: (opponent?: string | null) =>
    request<Challenge>("/tournament/challenge", { method: "POST", body: { opponent: opponent ?? null } }),
  tournamentAccept: (challengeId: string) =>
    request<Challenge>("/tournament/accept", { method: "POST", body: { challengeId } }),
  tournamentMatch: (challengeId: string) =>
    request<Challenge & { field: Field; throwsPerMatch: number; seed: string }>(
      `/tournament/match/${challengeId}`,
    ),
  tournamentThrow: (challengeId: string, angleQ: number, powerQ: number) =>
    request<
      ThrowResult & { resolved: boolean; winner: string | null; theirScore: number | null; yourScore: number }
    >("/tournament/throw", {
      method: "POST",
      body: { challengeId, angleQ, powerQ, requestId: requestId() },
    }),
  tournamentMine: () =>
    request<{
      yourTurn: Challenge[];
      waiting: Challenge[];
      history: Challenge[];
      openChallenges: Challenge[];
      throwsPerMatch: number;
    }>("/tournament/mine"),

  /* prizes */
  prizes: () =>
    request<{
      prizeTable: Record<string, number[]>;
      awaitingPayment: { cycle: string; winners: number; totalBuddy: number }[];
      paid: {
        cycle: string;
        winners: { wallet: string; game: string; position: number; prizeBuddy: number }[];
        totalBuddy: number;
        txSignatures: string[];
        receiptUrl: string | null;
      }[];
    }>("/prizes", { auth: false }),
};
