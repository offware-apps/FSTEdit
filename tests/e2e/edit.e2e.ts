import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;

async function openTalk(page: Page) {
  await page.goto('/');
  await page.locator('#video-file').setInputFiles(fixture('talk.mp4'));
  await expect(page.locator('#status')).toContainText('is open');
  await page.locator('#project-file').setInputFiles(fixture('talk.vtt'));
  await expect(page.locator('#transcript .w')).toHaveCount(25);
}

const struck = (page: Page) => page.locator('#transcript .cut').allTextContents();

test('strikes by keyboard and by mouse, and undoes', async ({ page }) => {
  await openTalk(page);
  await page.locator('#tab-clean').click();
  await page.locator('#cut-fillers').click();
  expect(await struck(page)).toEqual(['Um,']);

  // a drag from "so," to "the" strikes the run
  const from = page.locator('#transcript .w', { hasText: /^so,$/ });
  const to = page.locator('#transcript .w', { hasText: /^the$/ });
  await from.hover();
  await page.mouse.down();
  await to.hover();
  await page.mouse.up();
  await expect(page.locator('#selection-info')).toHaveText('4 selected');
  await page.keyboard.press('x');
  expect(await struck(page)).toEqual(['Um,', 'so,', 'we', 'strike', 'the']);

  await page.keyboard.press('Control+z');
  expect(await struck(page)).toEqual(['Um,']);
  await page.keyboard.press('Control+Shift+z');
  expect(await struck(page)).toHaveLength(5);
  await expect(page.locator('#edit-summary')).not.toBeEmpty();
});

test('finds silences and keeps the edit across a reload', async ({ page }) => {
  await openTalk(page);
  await page.locator('#tab-clean').click();
  await page.locator('#find-silences').click();
  await expect(page.locator('#transcript .p')).toHaveCount(2);
  await page.locator('#cut-silences').click();
  await expect(page.locator('#transcript .p.cut')).toHaveCount(2);
  await page.waitForTimeout(700);
  await page.reload();
  await page.locator('#video-file').setInputFiles(fixture('talk.mp4'));
  await expect(page.locator('#status')).toContainText('Restored your last edit');
  await expect(page.locator('#transcript .p.cut')).toHaveCount(2);
});

test('exports a GIF and an MP4 with an intro and music', async ({ page }) => {
  await openTalk(page);
  await page.locator('#tab-extras').click();
  for (const [i, name] of [[0, 'intro.mp4'], [2, 'music.mp3']] as const) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#slots .slot button.ghost').nth(i).click();
    await (await chooser).setFiles(fixture(name));
    await expect(page.locator('#status')).toContainText(`${name} added`);
  }
  await page.keyboard.press('Control+e');
  await expect(page.locator('#export-dialog')).toBeVisible();
  await expect(page.locator('#export-summary')).toContainText('the intro, the talk, the music');

  let download = page.waitForEvent('download');
  await page.locator('#export-go').click();
  expect((await download).suggestedFilename()).toBe('talk-edit.mp4');
  await expect(page.locator('#export-status')).toContainText('Done');

  await page.locator('#formats .format', { hasText: 'GIF' }).click();
  await page.locator('#opt-gif-limit').selectOption('5');
  download = page.waitForEvent('download');
  await page.locator('#export-go').click();
  const gif = await download;
  expect(gif.suggestedFilename()).toBe('talk-edit.gif');
  const bytes = await (await import('node:fs/promises')).readFile(await gif.path());
  expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
});

test('cuts the setup before the playhead and exports the sound alone as MP3', async ({ page }) => {
  await openTalk(page);
  await page.locator('#seek').fill('20');
  await page.locator('#tab-clean').click();
  await page.locator('#cut-before').click();
  await expect(page.locator('#transcript .p.marked.cut')).toHaveCount(1);
  await expect(page.locator('#transcript .p.marked')).toContainText('Before the start, 2.0 s');
  await page.locator('#export').click();
  await page.locator('#formats .format', { hasText: 'MP3' }).click();
  await expect(page.locator('#export-summary')).toContainText('sound only');
  const download = page.waitForEvent('download');
  await page.locator('#export-go').click();
  const mp3 = await download;
  expect(mp3.suggestedFilename()).toBe('talk-edit.mp3');
  const bytes = await (await import('node:fs/promises')).readFile(await mp3.path());
  // an MP3 opens on an ID3 tag or a frame sync
  expect(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)).toBe(true);
});

test('saves subtitles timed to the edit, without the struck words', async ({ page }) => {
  await openTalk(page);
  await page.locator('#tab-clean').click();
  await page.locator('#cut-fillers').click();
  await page.locator('#save-menu summary').click();
  const download = page.waitForEvent('download');
  await page.locator('#save-list button', { hasText: 'Subtitles for the edit, .srt' }).click();
  const text = await (await import('node:fs/promises')).readFile(await (await download).path(), 'utf8');
  expect(text).not.toContain('Um,');
  expect(text).toContain('so, we strike');
  expect(text).toMatch(/^1\n00:00:00,2\d\d --> /);
});

test('speaks the struck state, and leaves Space to the control in focus', async ({ page }) => {
  await openTalk(page);
  await page.locator('#tab-clean').click();
  await page.locator('#cut-fillers').click();
  await expect(page.locator('#transcript .w.cut')).toHaveAttribute('aria-label', 'Um, struck');
  const box = page.locator('#show-video');
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).not.toBeChecked();
  await expect(page.locator('#play')).toHaveAttribute('data-playing', 'false');
});

test.describe('with a finger', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 700, height: 930 } });

  test('a tap selects a word, a swipe scrolls and keeps the selection', async ({ page }) => {
    await openTalk(page);
    await page.locator('#transcript .w', { hasText: /^demo$/ }).tap();
    await expect(page.locator('#transcript .sel')).toHaveText('demo');
    await expect(page.locator('#selection-tools')).toBeVisible();
    // a vertical swipe that starts on another word is a scroll, not a new selection
    const word = await page.locator('#transcript .w', { hasText: /^want\.$/ }).boundingBox();
    await page.dispatchEvent('#transcript', 'pointerdown', { pointerType: 'touch', clientX: word!.x + 5, clientY: word!.y + 5, pointerId: 7, isPrimary: true });
    await page.dispatchEvent('#transcript', 'pointermove', { pointerType: 'touch', clientX: word!.x + 6, clientY: word!.y + 60, pointerId: 7, isPrimary: true });
    await page.dispatchEvent('#transcript', 'pointercancel', { pointerType: 'touch', pointerId: 7, isPrimary: true });
    await expect(page.locator('#transcript .sel')).toHaveText('demo');
  });
});

test('exports an MP4 as long as the talk minus every cut', async ({ page }) => {
  await openTalk(page);
  await page.locator('#tab-clean').click();
  await page.locator('#cut-fillers').click();
  await page.locator('#find-silences').click();
  await page.locator('#cut-silences').click();
  const removed = Number((await page.locator('#edit-summary').textContent())!.match(/([\d.]+) s/)![1]);
  expect(removed).toBeGreaterThan(2);
  await page.locator('#export').click();
  await page.locator('#formats .format', { hasText: 'MP4' }).click();
  await page.locator('#opt-mp4-quality').selectOption('draft');
  const download = page.waitForEvent('download');
  await page.locator('#export-go').click();
  const file = await (await download).path();
  const { execFileSync } = await import('node:child_process');
  const probe = (args: string[]) => Number(execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'csv=p=0', file]).toString().trim());
  const source = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fixture('talk.mp4')]).toString());
  const video = probe(['-select_streams', 'v:0', '-show_entries', 'stream=duration']);
  const sound = probe(['-select_streams', 'a:0', '-show_entries', 'stream=duration']);
  // the summary rounds to a tenth, and each cut snaps to a frame, 40 ms at 25 fps
  expect(Math.abs(video - (source - removed))).toBeLessThan(0.25);
  expect(Math.abs(sound - video)).toBeLessThan(0.1);
});

test('a model folder without the model says what it lacks, and downloads nothing', async ({ page, context }) => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(`${tmpdir()}/whisper-`);
  await mkdir(`${dir}/onnx`);
  for (const f of ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json']) await writeFile(`${dir}/${f}`, '{}');
  const outside: string[] = [];
  await context.route(/^(?!http:\/\/localhost:5174\/)https?:/, (r) => {
    outside.push(r.request().url());
    return r.abort();
  });
  await page.goto('/');
  await page.locator('#video-file').setInputFiles(fixture('talk.mp4'));
  await expect(page.locator('#status')).toContainText('is open');
  await page.locator('#model button', { hasText: 'Your folder' }).click();
  await expect(page.locator('#transcribe-note')).toContainText('Nothing is downloaded');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#transcribe').click();
  await (await chooser).setFiles(dir);
  await expect(page.locator('#status')).toContainText('Your folder: the folder has no encoder_model and decoder_model_merged ONNX pair');
  expect(outside).toEqual([]);
});

test('moves a cut edge by dragging it and by the keys, and undoes the key presses as one', async ({ page }) => {
  await openTalk(page);
  await page.locator('#tab-clean').click();
  await page.locator('#cut-fillers').click();
  const edges = page.locator('.cut-edge');
  await expect(edges).toHaveCount(2);
  const before = await page.locator('#edit-summary').textContent();

  // the end of the cut on "Um," dragged later, over the pause before "so,"
  const box = (await edges.nth(1).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#status')).toContainText('End of the cut moved to 0:06.');
  await expect(page.locator('#edit-summary')).not.toHaveText(before!);

  // the playhead at the start of the cut, then three presses of ] move that edge 30 ms later
  await page.locator('#seek').evaluate((el: HTMLInputElement) => {
    el.value = '57';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (let i = 0; i < 3; i++) await page.keyboard.press('BracketRight');
  const moved = (await page.locator('#status').textContent())!;
  expect(moved).toMatch(/^Start of the cut moved to 0:05\.\d\d/);

  await page.keyboard.press('Control+z');
  await expect(page.locator('#status')).toHaveText('Undid move the start of a cut.');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#status')).toHaveText('Undid move the end of a cut.');
  await expect(page.locator('#edit-summary')).toHaveText(before!);
});

test('a reload shows the last project again, and a browser without file links asks for the recording once', async ({ page }) => {
  // as in Firefox and Safari, which give no lasting link to a file
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }));
  await openTalk(page);
  await page.locator('#tab-clean').click();
  await page.locator('#cut-fillers').click();
  // no wait: closing the page writes the edit at once
  await page.reload();
  await expect(page.locator('#transcript .w')).toHaveCount(25);
  await expect(page.locator('#transcript .cut')).toHaveText(['Um,']);
  await expect(page.locator('#status')).toHaveText('Your last edit of talk.mp4 is back; open the recording again to play and export it.');

  const chooser = page.waitForEvent('filechooser');
  await page.locator('#reopen').click();
  await (await chooser).setFiles(fixture('talk.mp4'));
  await expect(page.locator('#status')).toContainText('Restored your last edit of talk.mp4');
  await expect(page.locator('#reopen')).toBeHidden();
  await expect(page.locator('#transcript .cut')).toHaveText(['Um,']);
});

test('a reload opens the recording again by itself where the browser keeps the link', async ({ page }) => {
  const bytes = readFileSync(fixture('talk.mp4')).toString('base64');
  // the browser's picker answers with a file in the page's own storage, a link the page may always read
  await page.addInitScript((b64) => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      value: async () => {
        const dir = await navigator.storage.getDirectory();
        const link = await dir.getFileHandle('talk.mp4', { create: true });
        const w = await link.createWritable();
        await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        await w.close();
        return [link];
      },
    });
  }, bytes);
  await page.goto('/');
  await page.locator('#open-video-big').click();
  await expect(page.locator('#status')).toContainText('talk.mp4 is open');
  await page.locator('#project-file').setInputFiles(fixture('talk.vtt'));
  await page.locator('#tab-clean').click();
  await page.locator('#cut-fillers').click();
  await page.reload();
  await expect(page.locator('#status')).toContainText('Restored your last edit of talk.mp4');
  await expect(page.locator('#transcript .cut')).toHaveText(['Um,']);
  await expect(page.locator('#reopen')).toBeHidden();
  await expect(page.locator('#play')).toBeEnabled();
});

test('marks a model already downloaded, and chooses it until the user picks another', async ({ page }) => {
  await page.goto('/');
  // the turbo model's two files, stored where transformers.js keeps what it downloads
  await page.evaluate(async () => {
    const cache = await caches.open('transformers-cache');
    for (const f of ['encoder_model', 'decoder_model_merged']) {
      await cache.put(`https://huggingface.co/onnx-community/whisper-large-v3-turbo_timestamped/resolve/main/onnx/${f}_q4.onnx`, new Response('x'));
    }
  });
  await page.reload();
  await page.locator('#video-file').setInputFiles(fixture('talk.mp4'));
  await expect(page.locator('#status')).toContainText('is open');
  const best = page.locator('#model button', { hasText: 'Best' });
  await expect(best).toContainText('Whisper turbo, downloaded');
  await expect(best).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#model button', { hasText: 'Light' })).toContainText('142 MB');
  await expect(page.locator('#transcribe-note')).toHaveText('Whisper turbo: already in this browser, works offline.');
});
