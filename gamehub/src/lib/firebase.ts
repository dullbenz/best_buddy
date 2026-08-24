/**
 * Firebase client wiring.
 *
 * Auth exists so the hub can hold a session minted by our own sign-in-with-
 * Solana flow; Firestore exists so the pet counter, the activity feed and the
 * leaderboards can update live without polling a function. Both are read-only
 * from the browser's point of view — every write goes through the API.
 */
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";

import { CLUSTER, FIREBASE_CONFIG, USE_EMULATORS } from "../config";

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let emulatorsConnected = false;

export function firebaseReady() {
  return Boolean(FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.apiKey);
}

function ensureApp(): FirebaseApp {
  if (!app) {
    app = getApps()[0] || initializeApp(FIREBASE_CONFIG);
  }
  return app;
}

export function auth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(ensureApp());
    if (USE_EMULATORS && !emulatorsConnected) {
      connectAuthEmulator(authInstance, "http://127.0.0.1:9099", { disableWarnings: true });
    }
  }
  return authInstance;
}

export function db(): Firestore {
  if (!dbInstance) {
    dbInstance = getFirestore(ensureApp());
    if (USE_EMULATORS && !emulatorsConnected) {
      connectFirestoreEmulator(dbInstance, "127.0.0.1", 8085);
      emulatorsConnected = true;
    }
  }
  return dbInstance;
}

/** Root path for everything this cluster's hub stores. */
export const gamehubRoot = () => ["gamehub", CLUSTER] as const;
