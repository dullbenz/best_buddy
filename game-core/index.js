/**
 * The deterministic core of every scored game.
 *
 * Nothing in this directory may import anything, touch the DOM, read a clock,
 * or use floating-point arithmetic where a result is compared. The client plays
 * these functions and the server re-runs them on the submitted inputs; a single
 * divergence between the two would reject honest players' scores.
 */
export { createRng } from "./rng.js";
export { SIM_VERSION } from "./version.js";
export { simulateThrow, FETCH_GRADES, describeField } from "./fetch-sim.js";
export { simulateRun, RUNNER_ACTIONS, RUNNER_LIMITS } from "./runner-sim.js";
