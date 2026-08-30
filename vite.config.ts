import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/generator/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
  },
  preview: {
    host: '0.0.0.0',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
