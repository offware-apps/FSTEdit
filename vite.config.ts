/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// writes sw.js with this build's files and an id hashed from their contents, so each deploy that changes a byte installs a new version
function serviceWorker(): Plugin {
  return {
    name: 'fstedit-sw',
    apply: 'build',
    // after the page itself is written, so its markup counts toward the id
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).sort();
      const hash = createHash('sha256');
      for (const f of files) {
        const out = bundle[f];
        hash.update(f).update(out.type === 'chunk' ? out.code : out.source);
      }
      const source = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // relative paths, so any static host serves it from any folder
  base: './',
  plugins: [tailwindcss(), serviceWorker()],
  worker: { format: 'es' },
  // ffmpeg.wasm starts its own worker from a URL Vite's pre-bundling would break
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  test: { include: ['tests/*.spec.ts'] },
});
