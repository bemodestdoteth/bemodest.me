// extension/vite.config.js
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@bemodest/utils': path.resolve(__dirname, '../utils/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    crx({ manifest }),
  ],
  build: {
    outDir: 'dist', // Output directory for the built extension
    emptyOutDir: true,
  },
});