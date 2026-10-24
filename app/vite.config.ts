import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { postcardPlayer } from "../lab/hero/player-plugin";

// In development the engine (python3 engine/server.py) answers /api on 8990.
// WIMYM_API points Vite at another engine (a port or a URL), WIMYM_VITE_PORT moves Vite itself,
// WIMYM_VITE_POLL=1 watches files by polling (when edits from scripts go unnoticed).
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const api = process.env.WIMYM_API || "8990";
const target = /^\d+$/.test(api) ? `http://127.0.0.1:${api}` : api;

// The front page's hero comes from the lab (lab/hero/README.md), with one copy of React and three.
// --mode demo builds the demo on Robin's record for the public page, into site/demo (lib/demo.ts, lab/site/export-demo.py).
export default defineConfig(({ mode }) => ({
  ...(mode === "demo" ? { base: "/demo/", build: { outDir: "../site/demo", emptyOutDir: true } } : {}),
  plugins: [react(), postcardPlayer(build)],
  resolve: {
    alias: [
      { find: "@wimym/hero", replacement: here("../lab/hero/index.ts") },
      // the lab's own imports come from app/node_modules, so the app builds without lab/node_modules
      { find: /^(three|react|react-dom|mediabunny)(\/.*)?$/, replacement: here("./node_modules/$1$2") },
    ],
    dedupe: ["react", "react-dom", "three"],
  },
  server: { port: Number(process.env.WIMYM_VITE_PORT) || 5173, strictPort: !!process.env.WIMYM_VITE_PORT, proxy: { "/api": target }, fs: { allow: [".."] },
    watch: process.env.WIMYM_VITE_POLL ? { usePolling: true, interval: 300 } : undefined },
}));
