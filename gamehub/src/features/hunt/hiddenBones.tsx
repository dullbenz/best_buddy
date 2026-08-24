/**
 * Bones hidden around the hub.
 *
 * A `<HiddenBone>` is a faint bone glyph tucked into a corner of a page. Nearly
 * invisible until you hover or focus it, and a real `<button>` with a real
 * label — so someone tabbing through the hub can hunt exactly as well as
 * someone with a mouse. Hiding a game behind pointer-only interaction would
 * quietly exclude people, and there is no reason to.
 *
 * The id here is only a location marker. The code that actually claims a bone
 * comes from the server when the dig succeeds, so reading this component's
 * source tells you where to look and nothing more — which is the fun part
 * anyway.
 */
import React, { useState } from "react";

import { BoneGlyph } from "../../components/ui";
import { api } from "../../lib/api";
import { useSession } from "../../lib/auth";
import { sfx } from "../../lib/sfx";

/** Every place a bone can be tucked. Referenced by hunt clues. */
export const BONE_SPOTS = [
  "home-rank-card",
  "home-feed",
  "pet-milestone",
  "ranks-ladder",
  "prizes-footer",
  "profile-header",
  "tournament-empty",
] as const;

export function HiddenBone({ id }: { id: (typeof BONE_SPOTS)[number] }) {
  const { signedIn } = useSession();
  const [state, setState] = useState<"idle" | "digging" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const dig = async () => {
    if (state !== "idle") return;
    setState("digging");
    sfx.dig();

    try {
      const current = await api.huntCurrent();
      if (!current.hunt) {
        setMessage("Nothing buried here right now.");
        setState("idle");
        return;
      }
      if (!signedIn) {
        setMessage("Something is buried here — sign in to dig it up.");
        setState("idle");
        return;
      }

      // The spot id is the code. Where it is hidden is the puzzle; what it is
      // called is not a secret worth keeping.
      const result = await api.huntDig(current.hunt.huntId, id);
      if (result.found) {
        sfx.found();
        setMessage(`Found ${result.name}! Finder #${result.finderRank} · +${result.points}`);
        setState("done");
      } else {
        setMessage(result.message || "Nothing but dirt.");
        setState("idle");
      }
    } catch (caught: any) {
      setMessage(caught?.message || "That dig didn't work.");
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <span className="chip" role="status">
        <BoneGlyph size={12} /> found
      </span>
    );
  }

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        className="hidden-bone"
        onClick={() => void dig()}
        aria-label="Dig here"
        title="Dig here"
        disabled={state === "digging"}
      >
        <BoneGlyph size={16} />
      </button>
      {message && (
        <span className="label" role="status" style={{ whiteSpace: "nowrap" }}>
          {message}
        </span>
      )}
    </span>
  );
}
