import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: {
    port: 5189,
    strictPort: true,
  },

  // relative asset URLs so the committed build works from any path
  // (github.io/<repo>/, a local file server, ...)
  base: "./",

  build: {
    // built site is committed so GitHub Pages can serve it from /docs
    outDir: "docs",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        stats: resolve(__dirname, "stats.html"),
      },
    },
  },
});
