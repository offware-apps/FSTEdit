import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const site = 'http://localhost:5175/';
const sw = new URL('../../dist/sw.js', import.meta.url).pathname;

const ready = (page: Page) =>
  page.waitForFunction(async () => (await navigator.serviceWorker.ready) && !!navigator.serviceWorker.controller);
const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

test('opens with the network off once visited', async ({ page, context }) => {
  await page.goto(site);
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#video-file')).toBeAttached();
  await expect(page.locator('h1, h2').first()).toBeVisible();
  await context.setOffline(false);
});

test('a new deploy waits for Reload to update, then keeps the model and the engines', async ({ page }) => {
  await page.goto(site);
  await ready(page);
  const [old] = (await cacheNames(page)).filter((k) => k.startsWith('fstedit-'));
  const wasm = readFileSync(sw, 'utf8').match(/"(assets\/ffmpeg-core-[^"]+\.wasm)"/)![1];
  // a downloaded model and an engine the first export stored
  await page.evaluate(
    async ([old, wasm]) => {
      await (await caches.open('transformers-cache')).put('https://huggingface.co/model.onnx', new Response('model'));
      await (await caches.open(old)).put(new URL(wasm, location.href).href, new Response('engine'));
    },
    [old, wasm],
  );

  const original = readFileSync(sw, 'utf8');
  writeFileSync(sw, original.replace(/const VERSION = '(\w+)'/, "const VERSION = 'deploy2'"));
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.locator('#update-app')).toBeVisible();
    await expect(page.locator('#status')).toHaveText('A new version of FSTEdit is ready.');
    expect(await cacheNames(page)).toContain(old);

    await Promise.all([page.waitForEvent('load'), page.locator('#update-app').click()]);
    await ready(page);
    await expect.poll(() => cacheNames(page)).not.toContain(old);
    const names = await cacheNames(page);
    expect(names).toEqual(expect.arrayContaining(['fstedit-deploy2', 'transformers-cache']));
    const carried = await page.evaluate(
      async (wasm) => (await (await caches.open('fstedit-deploy2')).match(new URL(wasm, location.href).href))?.text(),
      wasm,
    );
    expect(carried).toBe('engine');
    await expect(page.locator('#update-app')).toBeHidden();
  } finally {
    writeFileSync(sw, original);
  }
});
