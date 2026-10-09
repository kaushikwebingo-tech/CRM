import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Plan Section 14: 180 KB gzipped target, 250 KB hard ceiling. Splitting
    // the vendor libraries out means the app chunk changes without
    // invalidating React and the table/query runtimes on every deploy.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-table': ['@tanstack/react-table', '@tanstack/react-virtual'],
          'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The dev server proxies /api so the browser stays same-origin and the
      // session cookie is sent without a CORS exception.
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:9000',
        changeOrigin: true,
      },
    },
  },
});
