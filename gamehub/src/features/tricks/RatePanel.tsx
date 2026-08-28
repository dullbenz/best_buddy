/**
 * Two dimensions, five stars each. Two because every extra dimension halves
 * how many people finish the form. A re-rate replaces the old opinion.
 */
import React, { useState } from "react";

import { api } from "../../lib/api";

function Stars({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="spread" style={{ alignItems: "center" }}>
      <span className="label">{label}</span>
      <span>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className="btn"
            style={{ border: "none", background: "none", fontSize: 20, padding: "0 3px" }}
            aria-label={`${star} of 5`}
            onClick={() => onChange(star)}
          >
            {star <= value ? "★" : "☆"}
          </button>
        ))}
      </span>
    </div>
  );
}

export function RatePanel({
  trickId,
  alreadyRated,
  onRated,
}: {
  trickId: string;
  alreadyRated: boolean;
  onRated?: () => void;
}) {
  const [originality, setOriginality] = useState(0);
  const [fun, setFun] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <p className="label" style={{ marginTop: 10 }}>
        thanks — your rating is in
      </p>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.trickRate(trickId, originality, fun);
      setDone(true);
      onRated?.();
    } catch (caught: any) {
      setError(caught?.message || "Couldn't record that rating.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <span className="label">
        {alreadyRated ? "you rated this one — change your mind?" : "what did you think?"}
      </span>
      <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
        <Stars label="originality" value={originality} onChange={setOriginality} />
        <Stars label="fun" value={fun} onChange={setFun} />
      </div>
      {error && (
        <p className="label" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      <button
        className="btn btn-primary"
        style={{ marginTop: 10 }}
        disabled={busy || !originality || !fun}
        onClick={() => void submit()}
      >
        rate it
      </button>
    </div>
  );
}
