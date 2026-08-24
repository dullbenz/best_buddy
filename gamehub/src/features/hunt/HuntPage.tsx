/**
 * Bone Hunt.
 *
 * Clues point at the project's own record — the 2014 Bitcoin message, the block
 * it sits in, the snapshot, the roots. Solving one hands you a bone code; the
 * bones themselves are tucked around the hub as quiet little buttons.
 *
 * Digging costs a shovel whether or not you find anything, which is what makes
 * solving the clue worth more than clicking everything.
 */
import React, { useState } from "react";

import { GameShell, HudItem } from "../../components/GameShell";
import { SignInPrompt } from "../../components/HubHeader";
import { BoneGlyph, CountdownClock, EmptyState } from "../../components/ui";
import { api, type HuntView } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { usePoll } from "../../lib/poll";
import { sfx } from "../../lib/sfx";
import { commas } from "../../lib/format";

export default function HuntPage() {
  const { signedIn } = useSession();
  const hunt = usePoll<HuntView>(() => api.huntCurrent(), 30000, [signedIn]);
  const inventory = usePoll(() => (signedIn ? api.huntInventory() : Promise.resolve({ bones: [] })), 60000, [
    signedIn,
  ]);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [solved, setSolved] = useState<Record<string, { clue: string | null; code: string | null }>>({});
  const [wrong, setWrong] = useState<Record<string, boolean>>({});
  const [digCode, setDigCode] = useState("");
  const [digResult, setDigResult] = useState<string | null>(null);

  const view = hunt.data;
  const shovels = view?.shovels;

  const submitAnswer = async (puzzleId: string) => {
    if (!view?.hunt) return;
    const answer = (answers[puzzleId] || "").trim();
    if (!answer) return;

    try {
      const result = await api.huntAnswer(view.hunt.huntId, puzzleId, answer);
      if (result.correct) {
        sfx.found();
        setSolved((current) => ({ ...current, [puzzleId]: { clue: result.clue, code: result.boneCode } }));
        setWrong((current) => ({ ...current, [puzzleId]: false }));
      } else {
        setWrong((current) => ({ ...current, [puzzleId]: true }));
      }
    } catch (caught: any) {
      setDigResult(caught?.message || "That didn't go through.");
    }
  };

  const dig = async () => {
    if (!view?.hunt || !digCode.trim()) return;
    sfx.dig();
    try {
      const result = await api.huntDig(view.hunt.huntId, digCode.trim());
      if (result.found) {
        sfx.found();
        setDigResult(`Found ${result.name} — finder #${result.finderRank}, +${result.points} points.`);
        hunt.reload();
        inventory.reload();
      } else {
        setDigResult(result.message || "Nothing but dirt here.");
      }
      setDigCode("");
    } catch (caught: any) {
      setDigResult(caught?.message || "That dig didn't work.");
    }
  };

  return (
    <GameShell
      game="hunt"
      title="Bone Hunt"
      rules={
        <>
          <p>
            Bones are buried across the hub. Some are hidden in plain sight on the pages themselves —
            a faint bone glyph you can click, or tab to. Others are behind a riddle.
          </p>
          <p>
            Solving a riddle gives you a bone code. Bring a code back here to dig it up. Every bone
            has a limited number of claims and the earliest finders are worth the most.
          </p>
          <p>
            <strong>A dig costs a shovel whether or not you find anything.</strong> Shovels refill
            daily; stakers get a couple more.
          </p>
          <p className="muted">
            The clues lean on the project's own record. If you have read the main site's provenance
            page, you have an advantage — that is deliberate.
          </p>
        </>
      }
      hud={
        <>
          <HudItem
            label="shovels"
            value={
              shovels ? (
                <span className="shovels" aria-label={`${shovels.remaining} shovels left`}>
                  {Array.from({ length: shovels.allowance }, (_, index) => (
                    <span key={index} className={`shovel ${index < shovels.remaining ? "shovel-ready" : ""}`}>
                      ⛏
                    </span>
                  ))}
                </span>
              ) : (
                "—"
              )
            }
          />
          <HudItem label="found" value={commas(inventory.data?.bones.length || 0)} />
        </>
      }
    >
      <SignInPrompt reason="Sign in to dig." />

      {hunt.loading && <EmptyState kind="loading" message="checking the ground" />}

      {!hunt.loading && !view?.hunt && (
        <EmptyState
          message={
            view?.nextHuntAt
              ? "No hunt running right now. The next one is being buried."
              : "No hunt running right now. Watch this space."
          }
          action={
            view?.nextHuntAt ? (
              <span className="mono tone-warn">
                <CountdownClock until={view.nextHuntAt} prefix="starts in" />
              </span>
            ) : undefined
          }
        />
      )}

      {view?.hunt && (
        <>
          <section className="card">
            <div className="spread">
              <div>
                <span className="label">now hunting</span>
                <h2 className="serif" style={{ margin: "4px 0 0" }}>
                  {view.hunt.title}
                </h2>
              </div>
              <span className="mono tone-warn">
                <CountdownClock until={view.hunt.endAtIso} prefix="ends in" />
              </span>
            </div>
            {view.hunt.intro && <p style={{ marginBottom: 0 }}>{view.hunt.intro}</p>}
          </section>

          <section className="card">
            <span className="label">the bones</span>
            <div className="stack" style={{ marginTop: 12 }}>
              {view.hunt.bones.map((bone) => {
                const found = view.found.includes(bone.boneId);
                return (
                  <div key={bone.boneId} className={`clue-card ${found ? "clue-card-found" : ""}`}>
                    <div className="spread">
                      <span className="row" style={{ gap: 8 }}>
                        <BoneGlyph size={16} className={found ? "tone-good" : "muted"} />
                        <span className="mono" style={{ fontSize: 12 }}>
                          {bone.boneId}
                        </span>
                      </span>
                      <span className={`label ${bone.remaining <= 3 ? "tone-bad" : ""}`}>
                        {found ? "yours" : `${bone.remaining} of ${bone.maxClaims} left`}
                      </span>
                    </div>
                    <p className="clue-riddle" style={{ margin: 0 }}>
                      {bone.clue}
                    </p>
                    {bone.where && <span className="label">{bone.where}</span>}
                  </div>
                );
              })}
            </div>
          </section>

          {view.hunt.puzzles.length > 0 && (
            <section className="card">
              <span className="label">riddles</span>
              <div className="stack" style={{ marginTop: 12 }}>
                {view.hunt.puzzles.map((puzzle) => {
                  const answer = solved[puzzle.puzzleId];
                  return (
                    <div key={puzzle.puzzleId} className={`clue-card ${answer ? "clue-card-found" : ""}`}>
                      <p className="clue-riddle" style={{ margin: 0 }}>
                        {puzzle.prompt}
                      </p>

                      {answer ? (
                        <div className="stack" style={{ gap: 6 }}>
                          <span className="tone-good label">solved</span>
                          {answer.clue && <p style={{ margin: 0 }}>{answer.clue}</p>}
                          {answer.code && (
                            <span className="mono" style={{ fontSize: 13 }}>
                              bone code: <strong className="tone-warn">{answer.code}</strong>
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="row">
                          <input
                            className="pill"
                            style={{ flex: 1, minWidth: 160, textTransform: "none", letterSpacing: 0 }}
                            value={answers[puzzle.puzzleId] || ""}
                            onChange={(event) =>
                              setAnswers((current) => ({ ...current, [puzzle.puzzleId]: event.target.value }))
                            }
                            onKeyDown={(event) => event.key === "Enter" && void submitAnswer(puzzle.puzzleId)}
                            placeholder="your answer"
                            aria-label={`Answer for ${puzzle.puzzleId}`}
                            disabled={!signedIn}
                          />
                          <button
                            className="btn"
                            onClick={() => void submitAnswer(puzzle.puzzleId)}
                            disabled={!signedIn}
                          >
                            answer
                          </button>
                        </div>
                      )}

                      {wrong[puzzle.puzzleId] && (
                        <span className="label tone-bad">not that. try again.</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="card">
            <span className="label">dig with a code</span>
            <div className="row" style={{ marginTop: 10 }}>
              <input
                className="pill"
                style={{ flex: 1, minWidth: 180, textTransform: "none", letterSpacing: 0 }}
                value={digCode}
                onChange={(event) => setDigCode(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void dig()}
                placeholder="bone code"
                aria-label="Bone code"
                disabled={!signedIn || (shovels?.remaining ?? 0) <= 0}
              />
              <button
                className="btn btn-primary"
                onClick={() => void dig()}
                disabled={!signedIn || (shovels?.remaining ?? 0) <= 0}
              >
                dig
              </button>
            </div>
            {digResult && (
              <p className="label" role="status" style={{ marginTop: 10 }}>
                {digResult}
              </p>
            )}
            {shovels && shovels.remaining <= 0 && (
              <p className="label tone-bad" style={{ marginTop: 8 }}>
                out of shovels — they come back tomorrow
              </p>
            )}
          </section>
        </>
      )}

      <section className="card">
        <span className="label">your collection</span>
        {!inventory.data?.bones.length ? (
          <EmptyState message="No bones yet. The first clue is easier than it looks." />
        ) : (
          <table className="ledger" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>bone</th>
                <th>hunt</th>
                <th className="num">finder</th>
                <th className="num">points</th>
              </tr>
            </thead>
            <tbody>
              {inventory.data.bones.map((bone) => (
                <tr key={`${bone.huntId}-${bone.boneId}`}>
                  <td className="mono">{bone.boneId}</td>
                  <td className="muted">{bone.huntId}</td>
                  <td className="num">#{bone.finderRank}</td>
                  <td className="num">{commas(bone.points)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </GameShell>
  );
}
