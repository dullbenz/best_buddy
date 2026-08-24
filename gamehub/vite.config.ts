import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath } from "node:url";

/**
 * The game hub is its own app, not a route inside the claim site.
 *
 * The claim site's whole pitch is that nothing sits between you and the chain,
 * and its bundle is already heavy with Solana libraries. Six games, a canvas
 * renderer and an arcade UI layer do not belong in the page people load to
 * verify a Merkle proof. Separate app, separate subdomain, separate deploy —
 * and the games are code-split again per route inside it.
 */
export default defineConfig({
  plugins: [
    react(),
    // Solana libraries touch Node globals while their modules evaluate.
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  resolve: {
    alias: {
      // The browser compiles the real simulation source. The server gets a
      // synced copy (scripts/gamehub-sync.mjs) because a function deploy can
      // only upload files inside its own directory. One source, two consumers.
      "@game-core": fileURLToPath(new URL("../game-core", import.meta.url)),
    },
  },
  server: {
    // Bind IPv4 explicitly. Vite's default "localhost" resolves to ::1 on
    // macOS, which the end-to-end runner's 127.0.0.1 health check cannot reach.
    host: "127.0.0.1",
    proxy: {
      // Local dev talks to the devnet API running in the Functions emulator,
      // so the same relative "/api/..." paths work in dev, staging and prod.
      "/api": {
        target: "http://127.0.0.1:5001/demo-gamehub/us-central1/gamehubApiStaging",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@solana") || id.includes("node_modules/bs58")) {
            return "vendor-solana";
          }
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) {
            return "vendor-firebase";
          }
          return undefined;
        },
      },
    },
  },
});
