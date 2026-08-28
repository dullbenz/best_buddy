/**
 * The three template players. Each renders ONE item and reports the chosen
 * answer; the page owns progression, timing and submission. Nothing here
 * knows a correct answer — correctness arrives with the server's reveal.
 */
import React, { useEffect, useRef, useState } from "react";

import type { TrickItem } from "../../lib/api";

export function QuizItem({
  item,
  onAnswer,
}: {
  item: TrickItem;
  onAnswer: (value: number) => void;
}) {
  return (
    <div>
      <p className="serif" style={{ fontSize: 20, margin: "0 0 14px" }}>
        {item.prompt}
      </p>
      <div className="btn-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        {(item.options || []).map((option, index) => (
          <button key={index} className="btn" onClick={() => onAnswer(index)}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Shared typed-answer input for scramble and riddle items. */
function AnswerInput({ onAnswer, placeholder }: { onAnswer: (value: string) => void; placeholder: string }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // A new item mounts a new input; focus follows so play stays keyboard-only.
  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = () => {
    onAnswer(value);
    setValue("");
  };

  return (
    <form
      className="btn-row"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        ref={input}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <button className="btn btn-primary" type="submit">
        answer
      </button>
    </form>
  );
}

export function ScrambleItem({
  item,
  letters,
  onAnswer,
}: {
  item: TrickItem;
  letters: string;
  onAnswer: (value: string) => void;
}) {
  return (
    <div>
      <p className="mono" style={{ fontSize: 26, letterSpacing: 6, margin: "0 0 6px" }}>
        {letters.toUpperCase()}
      </p>
      {item.hint && (
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          hint: {item.hint}
        </p>
      )}
      <AnswerInput onAnswer={onAnswer} placeholder={`${item.length} letters`} />
    </div>
  );
}

export function RiddleItem({
  item,
  onAnswer,
}: {
  item: TrickItem;
  onAnswer: (value: string) => void;
}) {
  return (
    <div>
      <p style={{ fontSize: 40, margin: "0 0 6px", lineHeight: 1.2 }}>{item.emoji}</p>
      {item.hint && (
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          hint: {item.hint}
        </p>
      )}
      <AnswerInput onAnswer={onAnswer} placeholder="what is it?" />
    </div>
  );
}
