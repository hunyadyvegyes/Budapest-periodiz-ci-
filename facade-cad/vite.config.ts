import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // set BASE_PATH when hosting under a sub-path (e.g. GitHub Pages: /<repo>/facade-cad/)
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5174 },
  build: { chunkSizeWarningLimit: 1200 },
});
