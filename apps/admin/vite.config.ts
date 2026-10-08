import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_ADMIN_BASE || '/admin-assets/',
  server: {
    proxy: {
      '/auth': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
  build: { target: 'es2022' },
});
