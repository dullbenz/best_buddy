/**
 * The submission form: fill in a template, paste a payout address, done.
 *
 * The bounds come from TRICKS_LIMITS — the same object the server validates
 * against, so the form cannot promise what the API will refuse. The payout
 * address is pasted, never connected, and never signs anything: it is a
 * destination, not an identity.
 */
import React, { useMemo, useState } from "react";
import bs58 from "bs58";

import { TRICKS_LIMITS } from "@game-core/tricks-sim.js";
import { api, type TrickTemplate } from "../../lib/api";
import { TEMPLATE_LABELS } from "./common";

type QuizDraft = { prompt: string; options: string[]; answer: number };
type ScrambleDraft = { word: string; hint: string };
type RiddleDraft = { emoji: string; answer: string; hint: string };

const blankQuiz = (): QuizDraft => ({ prompt: "", options: ["", ""], answer: 0 });
const blankScramble = (): ScrambleDraft => ({ word: "", hint: "" });
const blankRiddle = (): RiddleDraft => ({ emoji: "", answer: "", hint: "" });

function validPayout(value: string): boolean {
  if (value.length < 32 || value.length > 44) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>{children}</div>;
}

export function AuthorForm({ onSubmitted }: { onSubmitted: (trickId: string) => void }) {
  const [template, setTemplate] = useState<TrickTemplate>("quiz");
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [payout, setPayout] = useState("");
  const [quizItems, setQuizItems] = useState<QuizDraft[]>(() =>
    Array.from({ length: TRICKS_LIMITS.quiz.minItems }, blankQuiz),
  );
  const [scrambleItems, setScrambleItems] = useState<ScrambleDraft[]>(() =>
    Array.from({ length: TRICKS_LIMITS.scramble.minItems }, blankScramble),
  );
  const [riddleItems, setRiddleItems] = useState<RiddleDraft[]>(() =>
    Array.from({ length: TRICKS_LIMITS.riddle.minItems }, blankRiddle),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bounds = TRICKS_LIMITS[template] as { minItems: number; maxItems: number };
  const count =
    template === "quiz" ? quizItems.length : template === "scramble" ? scrambleItems.length : riddleItems.length;

  /** What the API will be sent, or a reason it would refuse. */
  const problem = useMemo((): string | null => {
    if (!title.trim()) return "give it a title";
    if (!validPayout(payout.trim())) return "the payout address doesn't decode as a Solana address";
    if (template === "quiz") {
      for (const [index, item] of quizItems.entries()) {
        if (!item.prompt.trim()) return `question ${index + 1} needs a prompt`;
        if (item.options.some((option) => !option.trim()))
          return `question ${index + 1} has an empty option`;
        if (!item.options[item.answer]?.trim()) return `question ${index + 1} needs its answer picked`;
      }
    }
    if (template === "scramble") {
      const shape = new RegExp(`^[a-z]{${TRICKS_LIMITS.scramble.wordMin},${TRICKS_LIMITS.scramble.wordMax}}$`);
      for (const [index, item] of scrambleItems.entries()) {
        if (!shape.test(item.word.trim().toLowerCase()))
          return `word ${index + 1} must be ${TRICKS_LIMITS.scramble.wordMin}-${TRICKS_LIMITS.scramble.wordMax} letters, nothing else`;
      }
    }
    if (template === "riddle") {
      for (const [index, item] of riddleItems.entries()) {
        if (!item.emoji.trim()) return `riddle ${index + 1} needs its emoji`;
        if (!item.answer.trim()) return `riddle ${index + 1} needs an answer`;
      }
    }
    return null;
  }, [title, payout, template, quizItems, scrambleItems, riddleItems]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const items =
        template === "quiz"
          ? quizItems.map((item) => ({
              prompt: item.prompt.trim(),
              options: item.options.map((option) => option.trim()),
              answer: item.answer,
            }))
          : template === "scramble"
            ? scrambleItems.map((item) => ({
                word: item.word.trim().toLowerCase(),
                hint: item.hint.trim(),
              }))
            : riddleItems.map((item) => ({
                emoji: item.emoji.trim(),
                answer: item.answer.trim(),
                hint: item.hint.trim(),
              }));
      const submitted = await api.trickAuthor({
        template,
        title: title.trim(),
        intro: intro.trim(),
        payoutWallet: payout.trim(),
        items,
      });
      onSubmitted(submitted.trickId);
    } catch (caught: any) {
      setError(caught?.message || "The submission was refused.");
    } finally {
      setBusy(false);
    }
  };

  const setItemCount = (next: number) => {
    const clamp = (length: number) => Math.max(bounds.minItems, Math.min(bounds.maxItems, length));
    if (template === "quiz")
      setQuizItems((items) => resize(items, clamp(next), blankQuiz));
    else if (template === "scramble")
      setScrambleItems((items) => resize(items, clamp(next), blankScramble));
    else setRiddleItems((items) => resize(items, clamp(next), blankRiddle));
  };

  return (
    <div className="card" data-testid="author-form">
      <span className="label">teach Buddy a new trick</span>

      <div className="btn-row" style={{ margin: "10px 0" }}>
        {TRICKS_LIMITS.templates.map((option: TrickTemplate) => (
          <button
            key={option}
            className={`btn ${template === option ? "btn-primary" : ""}`}
            onClick={() => setTemplate(option)}
          >
            {TEMPLATE_LABELS[option]}
          </button>
        ))}
      </div>

      <Row>
        <input
          className="input"
          placeholder={`title (up to ${TRICKS_LIMITS.titleMax} characters)`}
          maxLength={TRICKS_LIMITS.titleMax}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          className="input"
          placeholder="one-line intro (optional)"
          maxLength={TRICKS_LIMITS.introMax}
          value={intro}
          onChange={(event) => setIntro(event.target.value)}
        />
        <input
          className="input mono"
          placeholder="payout address — where a Game of the Week prize would go"
          value={payout}
          onChange={(event) => setPayout(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="label">
          pasted, never connected — this address signs nothing and only ever receives
        </span>
      </Row>

      <div className="spread" style={{ margin: "6px 0 10px" }}>
        <span className="label">
          {count} of {bounds.minItems}–{bounds.maxItems} items
        </span>
        <span className="btn-row">
          <button className="btn" disabled={count <= bounds.minItems} onClick={() => setItemCount(count - 1)}>
            − item
          </button>
          <button className="btn" disabled={count >= bounds.maxItems} onClick={() => setItemCount(count + 1)}>
            + item
          </button>
        </span>
      </div>

      {template === "quiz" &&
        quizItems.map((item, index) => (
          <div key={index} className="card" style={{ marginBottom: 8 }}>
            <Row>
              <input
                className="input"
                placeholder={`question ${index + 1}`}
                maxLength={TRICKS_LIMITS.quiz.promptMax}
                value={item.prompt}
                onChange={(event) =>
                  setQuizItems(patch(quizItems, index, { ...item, prompt: event.target.value }))
                }
              />
              {item.options.map((option, optionIndex) => (
                <div key={optionIndex} className="row" style={{ gap: 8 }}>
                  <input
                    type="radio"
                    name={`answer-${index}`}
                    aria-label={`option ${optionIndex + 1} is the answer`}
                    checked={item.answer === optionIndex}
                    onChange={() =>
                      setQuizItems(patch(quizItems, index, { ...item, answer: optionIndex }))
                    }
                  />
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder={`option ${optionIndex + 1}${item.answer === optionIndex ? " (the answer)" : ""}`}
                    maxLength={TRICKS_LIMITS.quiz.optionMax}
                    value={option}
                    onChange={(event) =>
                      setQuizItems(
                        patch(quizItems, index, {
                          ...item,
                          options: patch(item.options, optionIndex, event.target.value),
                        }),
                      )
                    }
                  />
                </div>
              ))}
              <span className="btn-row">
                <button
                  className="btn"
                  disabled={item.options.length <= TRICKS_LIMITS.quiz.minOptions}
                  onClick={() =>
                    setQuizItems(
                      patch(quizItems, index, {
                        ...item,
                        options: item.options.slice(0, -1),
                        answer: Math.min(item.answer, item.options.length - 2),
                      }),
                    )
                  }
                >
                  − option
                </button>
                <button
                  className="btn"
                  disabled={item.options.length >= TRICKS_LIMITS.quiz.maxOptions}
                  onClick={() =>
                    setQuizItems(patch(quizItems, index, { ...item, options: [...item.options, ""] }))
                  }
                >
                  + option
                </button>
              </span>
            </Row>
          </div>
        ))}

      {template === "scramble" &&
        scrambleItems.map((item, index) => (
          <div key={index} className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input
              className="input mono"
              style={{ flex: 1 }}
              placeholder={`word ${index + 1} (letters only)`}
              maxLength={TRICKS_LIMITS.scramble.wordMax}
              value={item.word}
              onChange={(event) =>
                setScrambleItems(patch(scrambleItems, index, { ...item, word: event.target.value }))
              }
            />
            <input
              className="input"
              style={{ flex: 2 }}
              placeholder="hint (optional)"
              maxLength={TRICKS_LIMITS.scramble.hintMax}
              value={item.hint}
              onChange={(event) =>
                setScrambleItems(patch(scrambleItems, index, { ...item, hint: event.target.value }))
              }
            />
          </div>
        ))}

      {template === "riddle" &&
        riddleItems.map((item, index) => (
          <div key={index} className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              style={{ width: 120 }}
              placeholder="🐕🦴"
              value={item.emoji}
              onChange={(event) =>
                setRiddleItems(patch(riddleItems, index, { ...item, emoji: event.target.value }))
              }
            />
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder={`answer ${index + 1}`}
              maxLength={TRICKS_LIMITS.riddle.answerMax}
              value={item.answer}
              onChange={(event) =>
                setRiddleItems(patch(riddleItems, index, { ...item, answer: event.target.value }))
              }
            />
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="hint (optional)"
              maxLength={TRICKS_LIMITS.riddle.hintMax}
              value={item.hint}
              onChange={(event) =>
                setRiddleItems(patch(riddleItems, index, { ...item, hint: event.target.value }))
              }
            />
          </div>
        ))}

      {(error || problem) && (
        <p className="label" role={error ? "alert" : undefined} style={{ margin: "8px 0" }}>
          {error || problem}
        </p>
      )}

      <button
        className="btn btn-primary"
        disabled={busy || Boolean(problem)}
        onClick={() => void submit()}
      >
        {busy ? "submitting…" : "submit for review"}
      </button>
      <p className="label" style={{ marginTop: 8 }}>
        an admin reviews every trick before it reaches the shelf · one submission per day
      </p>
    </div>
  );
}

function patch<T>(list: T[], index: number, value: T): T[] {
  return list.map((entry, position) => (position === index ? value : entry));
}

function resize<T>(list: T[], length: number, blank: () => T): T[] {
  if (list.length >= length) return list.slice(0, length);
  return [...list, ...Array.from({ length: length - list.length }, blank)];
}
