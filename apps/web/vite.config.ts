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

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
