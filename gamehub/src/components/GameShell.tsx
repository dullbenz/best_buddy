/**
 * The frame every game sits in.
 *
 * One place that owns the back link, the rules sheet, the mute toggle, the HUD
 * strip and the leaderboard tail — so six games cannot drift into six slightly
 * different layouts, and a fix to the mobile safe-area applies to all of them.
 */
import React, { useEffect, useState } from "react";

import { KEYS, read, write } from "../lib/storage";
import { isMuted, setMuted } from "../lib/sfx";
import { navigate } from "../router";

export function GameShell({
  game,
  title,
  rules,
  hud,
  children,
  below,
}: {
  /** Stable key, used to remember whether the rules have been read. */
  game: string;
  title: string;
  rules: React.ReactNode;
  hud?: React.ReactNode;
  children: React.ReactNode;
  below?: React.ReactNode;
}) {
  const [showRules, setShowRules] = useState(false);
  const [muted, setMutedState] = useState(() => isMuted());

  /**
   * First visit shows the rules inline, above the game, rather than in a modal.
   *
   * A dialog that opens by itself the moment you arrive is something to dismiss
   * before you can play — the game's first interaction becomes closing a box.
   * Inline, the rules are read if wanted and ignored if not, and the first tap
   * still goes to the dog.
   */
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    if (!read<boolean>(KEYS.helpSeen(game), false)) {
      setShowIntro(true);
      write(KEYS.helpSeen(game), true);
    }
  }, [game]);

  useEffect(() => {
    if (!showRules) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowRules(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showRules]);

  return (
    <div className="game-shell">
      <div className="game-bar">
        <button
          className="icon-btn"
          onClick={() => navigate("arcade")}
          aria-label="Back to the arcade"
          title="Back to the arcade"
        >
          ‹
        </button>
        <h1>{title}</h1>
        <button
          className="icon-btn"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            setMutedState(next);
          }}
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
          title={muted ? "Sound off" : "Sound on"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <button
          className="icon-btn"
          onClick={() => setShowRules(true)}
          aria-label="How to play"
          title="How to play"
        >
          ?
        </button>
      </div>

      {hud && <div className="hud">{hud}</div>}

      {showIntro && (
        <section className="card card-tight" style={{ borderStyle: "dashed" }}>
          <div className="spread">
            <span className="label">how to play</span>
            <button className="icon-btn" onClick={() => setShowIntro(false)} aria-label="Hide the rules">
              ×
            </button>
          </div>
          <div style={{ fontSize: 14, marginTop: 6 }}>{rules}</div>
        </section>
      )}

      {children}

      {below}

      {showRules && (
        <div className="celebration" role="dialog" aria-label={`How to play ${title}`} onClick={() => setShowRules(false)}>
          <div
            className="celebration-card"
            style={{ textAlign: "left", maxWidth: 460 }}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="label">how to play</span>
            <h2 className="serif" style={{ margin: "6px 0 12px" }}>
              {title}
            </h2>
            <div style={{ fontSize: 14 }}>{rules}</div>
            <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => setShowRules(false)}>
              got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function HudItem({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="hud-item">
      <span className="label">{label}</span>
      <span className={`hud-value ${tone || ""}`}>{value}</span>
    </div>
  );
}
