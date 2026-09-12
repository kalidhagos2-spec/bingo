import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // Allow the ngrok tunnel host to reach the dev server.
    allowedHosts: true,
    // Forward API calls to the backend during development.
    proxy: {
      '/api': process.env.API_URL || 'http://127.0.0.1:3000',
      '/socket.io': { target: process.env.API_URL || 'http://127.0.0.1:3000', ws: true },
    },
  },
});
