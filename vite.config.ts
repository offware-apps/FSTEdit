/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // relative paths, so any static host serves it from any folder
  base: './',
  plugins: [tailwindcss()],
  // the service worker reads this list to store the app for offline use
  build: { manifest: true },
  worker: { format: 'es' },
  // ffmpeg.wasm starts its own worker from a URL Vite's pre-bundling would break
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  test: { include: ['tests/*.spec.ts'] },
});
