import { defineConfig } from "vite";
import { resolve } from "node:path";

// The public page's live pieces (site/live.ts): the Loom in the hero and one of Robin's days, as one script, into site/live/.
export default defineConfig({
  base: "/live/",
  build: {
    outDir: resolve(__dirname, "../site/live"),
    emptyOutDir: true,
    assetsDir: "",
    rollupOptions: {
      input: resolve(__dirname, "site/live.ts"),
      output: { entryFileNames: "live.js", chunkFileNames: "[name]-[hash].js", assetFileNames: "[name]-[hash][extname]" },
    },
  },
});
