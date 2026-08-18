import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The orchestrator serves REST + the event WebSocket under /api and /ws.
// ws: true on /api too, because the VNC socket lives at /api/agents/:id/vnc.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4400', changeOrigin: true, ws: true },
      '/ws': { target: 'http://localhost:4400', changeOrigin: true, ws: true },
    },
  },
});
