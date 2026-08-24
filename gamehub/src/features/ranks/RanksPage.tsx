/**
 * Best Boy — the ladder and how to climb it.
 *
 * The reputation layer is what makes the other five games add up to something.
 * This page has to answer two questions immediately: where am I, and what
 * exactly do I do to move.
 */
import React from "react";

import { HiddenBone } from "../hunt/hiddenBones";
import { SignInPrompt } from "../../components/HubHeader";
import {
  BoneGlyph,
  EmptyState,
  RankBadge,
  RankProgress,
  WalletChip,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { commas } from "../../lib/format";
import { usePoll } from "../../lib/poll";
import { RANKS, STAKING_URL } from "../../config";

const SOURCES: { key: string; label: string; how: string }[] = [
  { key: "pet", label: "Pet the Dog", how: "One point a pet, fifteen for a Super Pet." },
  {
    key: "fetch",
    label: "Daily Fetch",
    how: "Up to 100 a throw, times your streak multiplier. Three throws a day.",
  },
  { key: "runner", label: "Buddy vs. The Rugs", how: "A point for every twenty of your run score." },
  { key: "hunt", label: "Bone Hunt", how: "80 to 500 a bone, with the earliest finders paid most." },
  { key: "tournament", label: "Fetch Tournament", how: "150 for a win, 60 for a draw, 25 for turning up." },
  {
    key: "staking",
    label: "Staking",
    how: "Points every day you hold a stake, scaled by size but not proportional to it.",
  },
];

export default function RanksPage() {
  const { me, signedIn } = useSession();
  const ranks = usePoll(() => api.ranks(50), 60000);

  return (
    <div className="stack">
      <SignInPrompt reason="Sign in to take your place on the ladder." />

      {signedIn && me && (
        <section className="card">
          <div className="spread">
            <div className="row">
              <RankBadge rank={me.profile.rank} size="lg" />
              <span className="big-number">{commas(me.profile.gbp)}</span>
            </div>
            {me.profile.position && <span className="label">#{me.profile.position} in the pack</span>}
          </div>

          <div style={{ marginTop: 14 }}>
            <RankProgress gbp={me.profile.gbp} />
          </div>

          <hr className="divider" />

          <span className="label">where your points came from</span>
          <table className="ledger" style={{ marginTop: 8 }}>
            <tbody>
              {SOURCES.map((source) => (
                <tr key={source.key}>
                  <td>{source.label}</td>
                  <td className="num">{commas(me.profile.sources?.[source.key] || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="spread">
          <span className="label">the ladder</span>
          <HiddenBone id="ranks-ladder" />
        </div>
        <table className="ledger" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>rank</th>
              <th>from</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {RANKS.map((rank) => {
              const reached = (me?.profile.gbp || 0) >= rank.threshold;
              return (
                <tr key={rank.key} className={reached && signedIn ? "is-mine" : ""}>
                  <td>
                    <RankBadge rank={rank.key} />
                  </td>
                  <td className="num">{commas(rank.threshold)}</td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {rank.blurb}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <span className="label">how to earn</span>
        <ol className="stack" style={{ marginTop: 10, paddingLeft: 20, gap: 8 }}>
          {SOURCES.map((source) => (
            <li key={source.key}>
              <strong>{source.label}</strong>
              <div className="muted" style={{ fontSize: 13.5 }}>
                {source.how}
              </div>
            </li>
          ))}
        </ol>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 0 }}>
          Staking points accrue daily rather than the moment you stake, so rank reflects holding
          through time rather than a balance held for the length of one page load.{" "}
          <a href={STAKING_URL} target="_blank" rel="noreferrer">
            Staking lives on the main site.
          </a>
        </p>
      </section>

      <section className="card">
        <span className="label">the pack</span>
        {!ranks.data ? (
          <EmptyState kind="loading" message="reading the ladder" />
        ) : !ranks.data.top.length ? (
          <EmptyState message="Nobody has earned a point yet. That is a rare opportunity." />
        ) : (
          <table className="ledger" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th>wallet</th>
                <th>rank</th>
                <th className="num">points</th>
              </tr>
            </thead>
            <tbody>
              {ranks.data.top.map((entry) => (
                <tr key={entry.wallet} className={entry.wallet === me?.wallet ? "is-mine" : ""}>
                  <td className="mono muted">{entry.position}</td>
                  <td>
                    <WalletChip address={entry.wallet} you={entry.wallet === me?.wallet} />
                  </td>
                  <td>
                    <RankBadge rank={entry.rank} />
                  </td>
                  <td className="num">{commas(entry.gbp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
