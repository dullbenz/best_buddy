import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    // Solana's client libraries touch Buffer and other Node globals at
    // module-evaluation time, which runs before any polyfill an entry file
    // could install. This injects them ahead of all module code.
    //
    // The plugin is also a dependency of the workspace root, not just this
    // app: npm hoists `@solana/*` up there, and those packages have to be able
    // to resolve the shim specifiers this plugin rewrites them to.
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  server: {
    // The Helius production key is domain-locked, and Helius rejects
    // "localhost" as an allowed-domain value — so local dev cannot reach
    // mainnet through it directly. Serving the dev server over our permanent
    // ngrok dev domain gives requests a real Origin that Helius will accept,
    // and doubles as a link testers can open.
    //
    // Vite blocks unknown Host headers by default (DNS-rebinding protection),
    // so the tunnel host has to be named here or it answers 403.
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app"],
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    esbuildOptions: { target: "es2020" },
  },
});
