import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local development only: production Nginx injects the private server API key.
const proxy = {
  '/generator/rpc/': {
    target: 'https://toncenter.com', changeOrigin: true,
    rewrite: (path: string) => path.replace('/generator/rpc/', '/api/v2/'),
  },
};

export default defineConfig({
  base: '/generator/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    proxy,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
