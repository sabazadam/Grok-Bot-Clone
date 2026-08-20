import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load the repo-root .env so WEB_HOST / WEB_PORT set by setup.sh apply here too.
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
dotenv.config({ path: rootEnv });

const WEB_HOST = process.env.WEB_HOST || "127.0.0.1";
const WEB_PORT = Number(process.env.WEB_PORT || "5173");

/** Mirror of apps/server/src/net.ts — keep in sync. Blocks agent containers from the Vite API proxy. */
function isContainerSourceAddress(addr?: string | null): boolean {
  if (!addr) return false;
  const ip = addr.replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, ...number[]];
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168 && c === 65) return true;
  if (a === 192 && b === 168 && c === 205) return true;
  if (a === 198 && b === 19) return true;
  return false;
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "block-container-control-plane",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (!url.startsWith("/api") && !url.startsWith("/ws")) return next();
          if (isContainerSourceAddress(req.socket.remoteAddress)) {
            res.statusCode = 403;
            res.end("forbidden");
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    host: WEB_HOST, // 127.0.0.1 for single-device; a Tailscale IP / 0.0.0.0 for server/commander
    port: WEB_PORT,
    // The proxy runs on the server (Mac mini), so it always targets loopback.
    proxy: {
      "/api": { target: "http://127.0.0.1:8484", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8484", ws: true },
      "/screenshots": { target: "http://127.0.0.1:8484", changeOrigin: true },
      "/uploads": { target: "http://127.0.0.1:8484", changeOrigin: true },
    },
  },
});
