import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The lab reads the engine's /api like the app does, but from its own engine (8994 by default).
// WIMYM_API points it at another port or URL. No personal data is ever copied into lab/.
declare const process: { env: Record<string, string | undefined> };
const api = process.env.WIMYM_API || "8994";
const target = /^\d+$/.test(api) ? `http://127.0.0.1:${api}` : api;
const page = (p: string) => resolve(__dirname, p);

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.LAB_PORT) || 5194, proxy: { "/api": target } },
  build: {
    rollupOptions: {
      input: {
        index: page("index.html"), nebula: page("nebula/index.html"), core: page("core/index.html"),
        organism: page("organism/index.html"), globe: page("globe/index.html"), hero: page("hero/demo.html"), firstrun: page("hero/first-run.html"), week: page("hero/week.html"),
      },
    },
  },
});
