import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1600 },
  // A MapLibre 6 workerét a forrás mellől tölti be; az előcsomagolás ezt megtörné.
  optimizeDeps: { exclude: ['maplibre-gl'] },
});
