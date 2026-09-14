import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const expectedName = 'HearHear by Agent ²';
const expectedIcons = {
  16: 'icons/hearhear-16.png',
  32: 'icons/hearhear-32.png',
  48: 'icons/hearhear-48.png',
  128: 'icons/hearhear-128.png',
};

function pngSize(filePath) {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${filePath} must be a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('repository manifest points to built assets for root-folder installation', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.background.service_worker, 'dist/background.js');
  assert.deepEqual(manifest.content_scripts[0].js, ['dist/content.js']);
  assert.equal(manifest.options_page, 'dist/options.html');
  assert.equal(manifest.action.default_popup, 'dist/popup.html');
});

test('extension is branded HearHear by Agent ²', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, expectedName);
  assert.equal(manifest.short_name, 'HearHear');
  assert.equal(manifest.action.default_title, expectedName);
  const popup = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
  const options = await readFile(new URL('../options.html', import.meta.url), 'utf8');
  assert.match(popup, /<title>HearHear by Agent ²<\/title>/);
  assert.match(popup, /<h1>HearHear<\/h1>/);
  assert.match(options, /<title>HearHear by Agent ²<\/title>/);
  assert.match(options, /<h1>HearHear \/ Озвучивание статей<\/h1>/);
});

test('toolbar popup hosts settings instead of the article player', async () => {
  const popup = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
  assert.match(popup, /id="url"/);
  assert.match(popup, /id="model"/);
  assert.match(popup, /options.js/);
});

test('bundled HearHear icons exist at Chrome toolbar sizes', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.icons, expectedIcons);
  assert.deepEqual(manifest.action.default_icon, expectedIcons);
  for (const [size, relativePath] of Object.entries(expectedIcons)) {
    const iconPath = join(root, relativePath);
    assert.equal(existsSync(iconPath), true, `${relativePath} should be bundled`);
    assert.deepEqual(pngSize(iconPath), { width: Number(size), height: Number(size) });
  }
});
