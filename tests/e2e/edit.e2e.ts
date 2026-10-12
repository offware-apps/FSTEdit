import { expect, test, type Page } from '@playwright/test';

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
