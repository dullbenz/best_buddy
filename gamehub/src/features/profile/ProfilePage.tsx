/**
 * A public profile.
 *
 * The target of every wallet chip in the hub. Public because rank is a social
 * object — a leaderboard that does not let you look at the person above you is
 * only half a leaderboard.
 */
import React from "react";

import { HiddenBone } from "../hunt/hiddenBones";
import { BoneGlyph, EmptyState, RankBadge, RankProgress } from "../../components/ui";
import { BuddySprite } from "../../components/buddy/BuddySprite";
import { api } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { commas, shortAddress } from "../../lib/format";
import { usePoll } from "../../lib/poll";
import { explorerAddress } from "../../config";

const SOURCE_LABELS: Record<string, string> = {
  pet: "Pet the Dog",
  fetch: "Daily Fetch",
  runner: "Buddy vs. The Rugs",
  hunt: "Bone Hunt",
  tournament: "Fetch Tournament",
  staking: "Staking",
};

export default function ProfilePage({ address }: { address: string }) {
  const { me } = useSession();
  const profile = usePoll(() => api.reputation(address), 60000, [address]);
  const isYou = me?.wallet === address;

  if (profile.loading) return <EmptyState kind="loading" message="looking them up" />;

  if (profile.error || !profile.data) {
    return (
      <EmptyState
        kind="error"
        message="No profile for that address. They may not have played yet."
      />
    );
  }

  const data = profile.data;
  const sources = Object.entries(data.sources || {}).filter(([, value]) => value > 0);

  return (
    <div className="stack">
      <section className="card">
        <div className="spread">
          <div className="row">
            <BuddySprite pose={data.gbp > 0 ? "idle" : "miss"} size={64} />
            <div>
              <div className="row" style={{ gap: 8 }}>
                <RankBadge rank={data.rank} size="lg" />
                {isYou && <span className="wallet-chip-you">you</span>}
              </div>
              <a
                className="mono muted"
                style={{ fontSize: 12 }}
                href={explorerAddress(address)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(address, 6, 6)}
              </a>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="big-number">{commas(data.gbp)}</div>
            <span className="label">good boy points</span>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <RankProgress gbp={data.gbp} />
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="spread">
            <span className="label">record</span>
            <HiddenBone id="profile-header" />
          </div>
          <table className="ledger" style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <td>Pets given</td>
                <td className="num">{commas(data.petCount)}</td>
              </tr>
              <tr>
                <td>Fetch streak</td>
                <td className="num">{data.streakDays} days</td>
              </tr>
              <tr>
                <td>Longest streak</td>
                <td className="num">{data.longestStreak} days</td>
              </tr>
              <tr>
                <td>Runner best</td>
                <td className="num">{commas(data.runnerBest)}</td>
              </tr>
              <tr>
                <td>Matches</td>
                <td className="num">
                  {data.wins}–{data.losses}
                  {data.draws ? ` (${data.draws} drawn)` : ""}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <span className="label">points by game</span>
          {!sources.length ? (
            <p className="muted" style={{ fontSize: 13.5, marginBottom: 0, marginTop: 10 }}>
              Nothing earned yet.
            </p>
          ) : (
            <table className="ledger" style={{ marginTop: 8 }}>
              <tbody>
                {sources
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, value]) => (
                    <tr key={key}>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <BoneGlyph size={12} className="muted" />
                          {SOURCE_LABELS[key] || key}
                        </span>
                      </td>
                      <td className="num">{commas(value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
