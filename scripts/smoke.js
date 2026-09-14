import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const extensionPath = resolve(process.argv[2] || 'dist');
const requests = [];
let answer;
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
  answer = () => { res.writeHead(200, {'Content-Type':'audio/wav'}); res.end(wav); };
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
  await page.route('https://article.test/**', route => route.fulfill({contentType:'text/html', headers:{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}, body:`<html lang="ru"><h1>Тест</h1><article><h1>Статья о фотографии</h1><p>${'Это длинная русская статья о форматах фотографий и технологиях обработки изображений. '.repeat(8)}</p><pre>secret code</pre></article></html>`}));
  await page.goto('https://article.test/one');
  await page.locator('[data-chrome-sound]').waitFor();
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
  assert.equal(requests[0].language, 'ru'); assert.match(requests[0].text, /Код/); assert.doesNotMatch(requests[0].text, /secret code/);
  assert.equal((await state()).phase, 'loading');
  answer();
  await eventually(async () => ['playing','paused'].includes((await state()).phase));
  if ((await state()).phase === 'paused') await clickControl('BUTTON', 'Слушать');
  await eventually(async () => (await state()).phase === 'playing');
  await clickControl('BUTTON', 'Пауза');
  await eventually(async () => (await state()).phase === 'paused');
  await clickControl('INPUT');
  await eventually(async () => (await state()).currentTime > 5);
  await clickControl('BUTTON', 'Слушать');
  await eventually(async () => (await state()).phase === 'playing');
  assert.equal(requests.length, 1);
  await page.screenshot({path:'dist/smoke-player.png'});
  await page.goto('https://article.test/two');
  await page.locator('[data-chrome-sound]').waitFor();
  await eventually(async () => (await state()).phase === 'idle');
  assert.equal(await page.locator('[data-chrome-sound]').count(), 1);
  console.log(extensionPath, 'PASS: popup settings, real MV3 load, closed-shadow trusted click, CSP, RU payload, loading, offscreen playback, pause, seek, cached resume, navigation cleanup.');
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  await rm(profile, {recursive:true, force:true});
}
