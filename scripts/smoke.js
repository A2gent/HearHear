import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const extensionPath = resolve(process.argv[2] || 'dist');
const requests = [];
const answers = [];
const wav = Buffer.alloc(44 + 8000 * 2 * 20);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  if (req.method === 'GET' && req.url === '/speech/models') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({models:[{id:'auto', label:'Auto', available:true},{id:'piper_tts:ru_RU-ruslan-medium', label:'Piper Ruslan', engine:'piper_tts', voice:'ru_RU-ruslan-medium', languages:['ru'], available:true}]}));
    return;
  }
  assert.equal(req.url, '/speech/completion');
  requests.push(JSON.parse(body));
  answers.push(() => { res.writeHead(200, {'Content-Type':'audio/wav'}); res.end(wav); });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const profile = await mkdtemp(join(tmpdir(), 'article-sound-'));
let context;
const eventually = async fn => {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Condition not reached within 10 seconds');
};
try {
  context = await chromium.launchPersistentContext(profile, {channel:'chromium', headless:true, args:[`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(baseURL => chrome.storage.local.set({baseURL}), `http://127.0.0.1:${server.address().port}`);
  const popup = await context.newPage();
  const popupURL = await worker.evaluate(() => chrome.runtime.getURL(chrome.runtime.getManifest().action.default_popup));
  await popup.goto(popupURL);
  await eventually(async () => (await popup.locator('#url').inputValue()) === `http://127.0.0.1:${server.address().port}`);
  await eventually(async () => (await popup.locator('#model option').count()) >= 2);
  assert.equal(await popup.locator('#model').inputValue(), 'auto');
  await popup.close();
  const page = await context.newPage();
  await page.route('https://article.test/**', route => route.fulfill({contentType:'text/html; charset=utf-8', headers:{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}, body:`<html lang="ru"><h1>Тест</h1><div style="height:1200px"></div><article><h1>Статья о фотографии</h1><p>${'Это длинная русская статья о форматах фотографий и технологиях обработки изображений. '.repeat(8)}</p><pre>${'function secretPayload() { return SECRET_CODE; }\n'.repeat(4)}</pre></article></html>`}));
  await page.goto('https://article.test/one');
  await page.locator('[data-chrome-sound]').waitFor();
  const playerPosition = await page.locator('[data-chrome-sound]').evaluate(host => {
    const rect = host.getBoundingClientRect();
    return {position:getComputedStyle(host).position, bottom:Math.round(innerHeight - rect.bottom)};
  });
  assert.deepEqual(playerPosition, {position:'fixed', bottom:16});
  assert.equal(requests.length, 0, 'must not send before a click');
  const cdp = await context.newCDPSession(page);
  async function clickControl(tag, label) {
    function attr(node, name) {
      const attrs = node.attributes || [];
      for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === name) return attrs[i + 1];
    }
    function search(node) {
      const attrs = node.attributes || [];
      const matchLabel = !label || attr(node, 'aria-label') === label || node.children?.some(c => c.nodeValue === label);
      if (node.nodeName === tag && matchLabel && (tag !== 'INPUT' || attrs.includes('range'))) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = search(child); if (found) return found; }
    }
    let node;
    await eventually(async () => {
      const {root: currentRoot} = await cdp.send('DOM.getDocument', {depth:-1, pierce:true});
      node = search(currentRoot);
      return Boolean(node);
    });
    assert.ok(node, `control ${tag} ${label}`);
    const {model} = await cdp.send('DOM.getBoxModel', {nodeId:node.nodeId});
    const b = model.content; await page.mouse.click((b[0] + b[2]) / 2, (b[1] + b[5]) / 2);
  }
  const owner = await worker.evaluate(async () => (await chrome.tabs.query({})).at(-1).id);
  const state = () => worker.evaluate(owner => chrome.runtime.sendMessage({target:'offscreen', action:'status', owner}), owner);
  await clickControl('BUTTON', 'Слушать');
  await eventually(() => requests.length === 1);
  assert.equal(requests[0].language, 'ru'); assert.equal(requests[0].text, 'Статья о фотографии'); assert.doesNotMatch(requests[0].text, /secret code/);
  assert.equal((await state()).phase, 'loading');
  answers[0]();
  await eventually(async () => ['playing','paused'].includes((await state()).phase));
  if ((await state()).phase === 'paused') await clickControl('BUTTON', 'Слушать');
  await eventually(async () => (await state()).phase === 'playing');
  await clickControl('BUTTON', 'Пауза');
  await eventually(async () => (await state()).phase === 'paused');
  // Pausing right after play() must not surface an autoplay error; resume must work after a real wait.
  await new Promise(r => setTimeout(r, 1500));
  assert.equal((await state()).error, '');
  await clickControl('BUTTON', 'Слушать');
  await eventually(async () => (await state()).phase === 'playing');
  await clickControl('BUTTON', 'Скорость 1x');
  await eventually(async () => (await state()).rate === 1.2);
  assert.equal((await worker.evaluate(() => chrome.storage.local.get('playbackRate'))).playbackRate, 1.2);
  await eventually(async () => (await state()).currentTime > 0.5);
  await clickControl('BUTTON', 'Сначала фрагмент');
  await eventually(async () => (await state()).currentTime < 0.5 && (await state()).phase === 'playing');
  await eventually(() => requests.length === 2);
  assert.ok(requests.every(req => req.text.length <= 400));
  assert.match(requests[1].text, /^Это длинная/);
  // CSS Highlight registry is inspected in the content script's isolated world.
  await cdp.send('Runtime.enable');
  const {frameTree} = await cdp.send('Page.getFrameTree');
  const {executionContextId} = await cdp.send('Page.createIsolatedWorld', {frameId:frameTree.frame.id, worldName:'hearhear-smoke'});
  const highlighted = async () => {
    const result = await cdp.send('Runtime.evaluate', {contextId:executionContextId, expression:"Array.from(CSS.highlights.get('hearhear-word') || []).map(r => r.toString()).join('')", returnByValue:true});
    return result.result.value;
  };
  await eventually(async () => Boolean(await highlighted()));
  await eventually(async () => await page.evaluate(() => scrollY > 0));
  const fixedAfterScroll = await page.locator('[data-chrome-sound]').evaluate(host => {
    const rect = host.getBoundingClientRect();
    return Math.round(innerHeight - rect.bottom);
  });
  assert.equal(fixedAfterScroll, 16);
  await page.screenshot({path:'dist/smoke-player.png'});
  const command = (action, value) => worker.evaluate(({owner, action, value}) => chrome.runtime.sendMessage({target:'offscreen', owner, action, value}), {owner, action, value});
  await command('seek', 19.9);
  await eventually(async () => (await state()).chunkIndex === 1 && (await state()).phase === 'loading');
  await eventually(async () => !(await highlighted()));
  assert.equal(requests.length, 2, 'must reuse pending next chunk');
  answers[1]();
  await eventually(async () => (await state()).phase === 'playing');
  await eventually(() => requests.length === 3);
  await eventually(async () => (await highlighted()) === 'Это');
  // Advancing is automatic and bounded; the rest of the article is not queued.
  assert.equal((await state()).chunkIndex, 1);
  await page.goto('https://article.test/two');
  await page.locator('[data-chrome-sound]').waitFor();
  await eventually(async () => (await state()).phase === 'idle');
  assert.equal(await page.locator('[data-chrome-sound]').count(), 1);
  console.log(extensionPath, 'PASS: popup settings, real MV3 load, fixed player during auto-scroll, closed-shadow trusted click, CSP, RU payload, loading, offscreen playback, pause/resume, speed, restart, bounded chunk prefetch, automatic advance, word highlighting, navigation cleanup.');
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  await rm(profile, {recursive:true, force:true});
}
