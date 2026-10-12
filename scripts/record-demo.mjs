#!/usr/bin/env node
// Records the README's demo GIFs: drives the app in headless Chromium, then
// turns each recording into a GIF with ffmpeg. Needs `npm run dev -- --port 5174` running.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}docs/media/`;
const tmp = `${root}.demo/`;
const fixture = (n) => `${root}tests/fixtures/${n}`;
const size = { width: 1280, height: 720 };

// a dot that follows the mouse, since a headless recording draws no pointer
const cursor = () => {
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(67,56,202,.35);border:2px solid #4338ca;pointer-events:none;left:-40px;top:-40px';
    document.body.append(dot);
    addEventListener('mousemove', (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    });
  });
};

async function scene(name, run) {
  rmSync(tmp, { recursive: true, force: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
  await context.addInitScript(cursor);
  const page = await context.newPage();
  await page.goto('http://localhost:5174/');
  await run(page);
  await page.waitForTimeout(800);
  await context.close();
  await browser.close();
  const webm = `${tmp}${readdirSync(tmp).find((f) => f.endsWith('.webm'))}`;
  // the first frames are the blank page before the app draws
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-ss', '0.6', '-i', webm,
    '-filter_complex', 'fps=12,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    '-loop', '0', `${tmp}${name}.gif`,
  ]);
  renameSync(`${tmp}${name}.gif`, `${out}${name}.gif`);
  rmSync(tmp, { recursive: true, force: true });
}

const move = async (page, locator) => {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
};

async function openTalk(page) {
  await page.locator('#video-file').setInputFiles(fixture('talk.mp4'));
  await page.locator('#status').filter({ hasText: 'is open' }).waitFor();
  await page.locator('#project-file').setInputFiles(fixture('talk.vtt'));
  await page.locator('#transcript .w').first().waitFor();
  await page.waitForTimeout(600);
}

mkdirSync(out, { recursive: true });

await scene('edit', async (page) => {
  await page.waitForTimeout(700);
  await openTalk(page);
  const word = (t) => page.locator('#transcript .w', { hasText: new RegExp(`^${t}$`) });
  await move(page, word('Um,'));
  await page.mouse.down();
  await move(page, word('so,'));
  await page.mouse.up();
  await page.waitForTimeout(500);
  await move(page, page.locator('#strike'));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(900);
  await move(page, page.locator('#tab-clean'));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);
  await move(page, page.locator('#find-silences'));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(700);
  await move(page, page.locator('#cut-silences'));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await move(page, page.locator('#undo'));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(800);
  await move(page, page.locator('#redo'));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(900);
});

await scene('export', async (page) => {
  await openTalk(page);
  await move(page, page.locator('#tab-extras'));
  await page.mouse.down();
  await page.mouse.up();
  for (const [i, name] of [[0, 'intro.mp4'], [2, 'music.mp3']]) {
    const chooser = page.waitForEvent('filechooser');
    await move(page, page.locator('#slots .slot button.ghost').nth(i));
    await page.mouse.down();
    await page.mouse.up();
    await (await chooser).setFiles(fixture(name));
    await page.locator('#status').filter({ hasText: `${name} added` }).waitFor();
    await page.waitForTimeout(500);
  }
  await move(page, page.locator('#export'));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(700);
  await move(page, page.locator('#formats .format', { hasText: 'GIF' }));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(600);
  await move(page, page.locator('#export-go'));
  const download = page.waitForEvent('download');
  await page.mouse.down();
  await page.mouse.up();
  await download;
  await page.waitForTimeout(1500);
});
