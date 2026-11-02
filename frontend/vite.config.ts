import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/** Absolutize og:image for link previews (Telegram & co. ignore relative
 *  URLs). Deployment sets VITE_SITE_URL (e.g. https://example.uz); without
 *  it the relative path is left untouched for local dev. */
function absoluteOgImage(site: string | undefined): Plugin {
  return {
    name: "absolute-og-image",
    transformIndexHtml: (html) => {
      if (!site) return html;
      const base = site.replace(/\/$/, "");
      return html.replace(
        /(property="og:image" content=")([^"]+)("\s*\/?>)/,
        `$1${base}$2$3`,
      );
    },
  };
}

// Dev server proxies /api to the Django backend (localhost:8000), which keeps
// session cookies same-origin in development — no CORS friction.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  return {
    plugins: [react(), absoluteOgImage(env.VITE_SITE_URL)],
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
    build: {
      // Route chunks are all small now; the ONLY chunk above 550KB is the
      // isolated maplibre engine (~1MB, cached separately, map pages only) —
      // keep the limit high enough not to warn about that known vendor chunk.
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        output: {
          // Split the heavy map engine into its own long-cacheable chunk —
          // loaded only by map pages (adapter is dynamically reachable).
          manualChunks: {
            maplibre: ["maplibre-gl"],
            react: ["react", "react-dom", "react-router-dom"],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
        "/media": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
  };
});
