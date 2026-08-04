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
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    esbuildOptions: { target: "es2020" },
  },
});
