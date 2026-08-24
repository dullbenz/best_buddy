/**
 * TEST_WALLET_ADAPTER — an in-page wallet for end-to-end tests.
 *
 * Playwright cannot click through a real wallet extension, so the suite needs
 * something that signs in the page. This registers a Wallet Standard wallet
 * holding an ephemeral ed25519 key, which the Solana wallet adapter discovers
 * on its own — no change to the provider stack, no test-only branch in app code.
 *
 * Three things keep it out of production:
 *
 *   1. main.tsx imports this module only when VITE_ENABLE_TEST_WALLET is "true"
 *      at build time, so Vite eliminates it from every other bundle.
 *   2. The literal above is grepped for in CI and in the production deploy
 *      workflow, which fail if it appears in a production build.
 *   3. It stays inert unless a secret is injected: without
 *      window.__E2E_WALLET_SECRET__ or ?e2ewallet=1 it never registers, so even
 *      the staging build (which does ship it) offers nothing to a visitor.
 *
 * It signs messages and transactions with a key that exists only in the page.
 * It holds no funds and can authorise nothing but a hub sign-in.
 */
import nacl from "tweetnacl";
import bs58 from "bs58";

const MARKER = "TEST_WALLET_ADAPTER";

declare global {
  interface Window {
    __E2E_WALLET_SECRET__?: string;
    __E2E_WALLET__?: { address: string; marker: string };
  }
}

function resolveKeypair(): nacl.SignKeyPair | null {
  const injected = window.__E2E_WALLET_SECRET__;
  if (injected) {
    try {
      return nacl.sign.keyPair.fromSecretKey(bs58.decode(injected));
    } catch {
      console.warn(`${MARKER}: injected secret was not a base58 64-byte key`);
      return null;
    }
  }
  // No secret, but explicitly asked for: a throwaway identity for local poking.
  if (new URLSearchParams(location.search).has("e2ewallet")) {
    return nacl.sign.keyPair();
  }
  return null;
}

const keypair = resolveKeypair();

if (keypair) {
  const publicKey = new Uint8Array(keypair.publicKey);
  const address = bs58.encode(Buffer.from(publicKey));

  const account = {
    address,
    publicKey,
    chains: ["solana:devnet", "solana:mainnet"] as const,
    features: ["solana:signMessage", "solana:signTransaction"] as const,
    label: "E2E Test Wallet",
    icon: undefined,
  };

  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  let connected = false;

  const wallet = {
    version: "1.0.0" as const,
    name: "E2E Test Wallet",
    // A 1x1 transparent PNG: the adapter requires an icon, nothing renders it.
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" as const,
    chains: ["solana:devnet", "solana:mainnet"] as const,

    get accounts() {
      return connected ? [account] : [];
    },

    features: {
      "standard:connect": {
        version: "1.0.0" as const,
        async connect() {
          connected = true;
          (listeners.change || []).forEach((listener) => listener({ accounts: [account] }));
          return { accounts: [account] };
        },
      },
      "standard:disconnect": {
        version: "1.0.0" as const,
        async disconnect() {
          connected = false;
          (listeners.change || []).forEach((listener) => listener({ accounts: [] }));
        },
      },
      "standard:events": {
        version: "1.0.0" as const,
        on(event: string, listener: (...args: any[]) => void) {
          listeners[event] = listeners[event] || [];
          listeners[event].push(listener);
          return () => {
            listeners[event] = (listeners[event] || []).filter((entry) => entry !== listener);
          };
        },
      },
      "solana:signMessage": {
        version: "1.0.0" as const,
        async signMessage(...inputs: { message: Uint8Array }[]) {
          return inputs.map((input) => ({
            signedMessage: input.message,
            signature: nacl.sign.detached(input.message, keypair.secretKey),
          }));
        },
      },
      // The adapter only treats a Standard wallet as usable if it can sign a
      // transaction. The hub never asks it to; this exists to satisfy discovery.
      //
      // `supportedTransactionVersions` is not optional in practice: the adapter
      // reads its length while building the wallet list, so omitting it takes
      // down the whole WalletProvider rather than just this wallet.
      "solana:signTransaction": {
        version: "1.0.0" as const,
        supportedTransactionVersions: ["legacy", 0] as const,
        async signTransaction(...inputs: { transaction: Uint8Array }[]) {
          return inputs.map((input) => ({ signedTransaction: input.transaction }));
        },
      },
    },
  };

  const register = ({ register: doRegister }: { register: (candidate: unknown) => void }) =>
    doRegister(wallet);

  // The Wallet Standard handshake: announce now for an app that is already
  // listening, and answer the app's ready event for the other ordering.
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  window.addEventListener("wallet-standard:app-ready", (event: any) => register(event.detail));

  window.__E2E_WALLET__ = { address, marker: MARKER };
  console.info(`${MARKER}: registered ${address}`);
}
