import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  resolve: { alias: { buffer: 'buffer' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, sourcemap: false },
  test: { environment: 'node' },
});
