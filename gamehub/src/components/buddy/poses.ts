/**
 * Buddy's geometry, as path data.
 *
 * Kept as plain strings rather than JSX so the canvas renderer in the runner
 * can build `Path2D` objects from the exact same outlines the SVG components
 * draw. One dog, two renderers — he should not change shape when he starts
 * running.
 *
 * All paths are authored in a 100x100 box with the ground at y=88, facing
 * right. The wobble in the outlines is deliberate: the project's diagrams are
 * hand-drawn and Buddy should look drawn too, not vector-perfect.
 */

export const SIDE = {
  /** Body, from chest around the back to the hindquarters. */
  body: "M26,52 C24,42 32,36 44,35 C58,34 70,37 76,44 C81,50 80,60 76,66 C70,73 58,76 46,75 C34,74 27,66 26,52 Z",
  head: "M70,34 C70,24 78,18 86,20 C93,22 96,29 94,36 C92,43 85,46 79,44 C73,42 70,39 70,34 Z",
  /** The floppy ear, rotated per pose. */
  ear: "M74,24 C70,20 64,21 62,26 C60,32 63,40 68,42 C72,43 75,39 76,34 C77,30 76,26 74,24 Z",
  snout: "M92,34 C97,33 100,35 100,38 C100,41 97,43 93,42 C90,41 89,37 92,34 Z",
  tail: "M26,50 C18,46 12,38 12,30 C12,26 15,24 18,26 C21,28 22,34 26,40 Z",
  legFrontUpper: "M62,70 C61,76 61,82 62,88 L69,88 C69,82 69,76 69,70 Z",
  legFrontBack: "M50,70 C49,76 49,82 50,88 L57,88 C57,82 57,76 57,70 Z",
  legRearUpper: "M34,68 C32,75 32,82 33,88 L41,88 C41,82 41,75 41,68 Z",
  legRearBack: "M44,69 C43,76 43,82 44,88 L51,88 C51,82 51,76 51,69 Z",
  collar: "M70,40 C73,46 75,50 76,55 L71,57 C69,51 67,46 65,42 Z",
};

/** Front-facing Buddy, for the pet page. Authored in the same 100x100 box. */
export const FRONT = {
  head: "M50,14 C68,14 80,26 80,44 C80,62 68,74 50,74 C32,74 20,62 20,44 C20,26 32,14 50,14 Z",
  earLeft: "M24,22 C16,18 10,24 11,34 C12,44 19,52 26,50 C31,48 32,40 30,32 C29,27 27,24 24,22 Z",
  earRight: "M76,22 C84,18 90,24 89,34 C88,44 81,52 74,50 C69,48 68,40 70,32 C71,27 73,24 76,22 Z",
  muzzle: "M50,48 C61,48 68,54 68,61 C68,69 60,74 50,74 C40,74 32,69 32,61 C32,54 39,48 50,48 Z",
  nose: "M50,54 C54,54 57,56 57,59 C57,62 54,64 50,64 C46,64 43,62 43,59 C43,56 46,54 50,54 Z",
  eyeLeft: "M38,38 C41,38 43,41 43,44 C43,47 41,50 38,50 C35,50 33,47 33,44 C33,41 35,38 38,38 Z",
  eyeRight: "M62,38 C65,38 67,41 67,44 C67,47 65,50 62,50 C59,50 57,47 57,44 C57,41 59,38 62,38 Z",
  patch: "M62,20 C72,22 78,30 79,40 C74,36 68,30 62,26 Z",
  tongue: "M50,64 C53,64 55,66 55,70 C55,74 53,76 50,76 C47,76 45,74 45,70 C45,66 47,64 50,64 Z",
};

export const BONE_PATH =
  "M14,26 C10,26 7,23 7,19 C7,15 10,12 14,12 C16,12 18,13 19,15 L41,15 C42,13 44,12 46,12 C50,12 53,15 53,19 C53,23 50,26 46,26 C44,26 42,25 41,23 L19,23 C18,25 16,26 14,26 Z";

export type Pose =
  | "idle"
  | "run"
  | "jump"
  | "slide"
  | "catch"
  | "miss"
  | "victory"
  | "defeat"
  | "dig";
