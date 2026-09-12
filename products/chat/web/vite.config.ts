import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API_TARGET = process.env.VITE_CHAT_API_PROXY ?? "http://127.0.0.1:5191";

/**
 * Guard: the api is proxied under this origin rather than called across origins.
 * The owner cookie is `httpOnly` and `SameSite=Lax`, and a cross-site setup would
 * demote it to `SameSite=None` plus `Secure` — which plain-http localhost drops
 * silently, minting a fresh owner on every request. Proxying also keeps
 * `credentials` at its `same-origin` default, so the AI SDK's transport needs no
 * configuration to carry the cookie.
 */
export default defineConfig({
  server: {
    port: 5190,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/u, ""),
      },
    },
  },
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
});
