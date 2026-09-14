import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseURL, synthesize, listSpeechModels, speechModelsFromResponse, normalizeSpeechModel } from '../src/speech.js';
import { Player } from '../src/player.js';
test('only local HTTP(S) origins, no credentials, paths or redirects', () => {
  assert.equal(validateBaseURL('http://localhost:5445/'), 'http://localhost:5445');
  assert.equal(validateBaseURL('http://[::1]:5445'), 'http://[::1]:5445');
  for (const url of ['https://evil.test', 'http://localhost.evil.test', 'file:///tmp/a', 'http://user:pass@localhost', 'http://localhost/api', 'http://localhost/?x=1']) assert.throws(() => validateBaseURL(url));
});
test('posts Russian text and accepts audio only, omitting cookies', async () => {
  const blob = await synthesize({text:'Привет', language:'ru', baseURL:'http://localhost:5445'}, async (url, init) => {
    assert.equal(url, 'http://localhost:5445/speech/completion');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), {text:'Привет', language:'ru'});
    return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}});
  });
  assert.equal(blob.type, 'audio/mpeg');
  await assert.rejects(synthesize({text:'hello'}, async () => new Response('{}', {headers:{'Content-Type':'application/json'}})), /audio/);
  await assert.rejects(synthesize({text:'hello'}, async () => new Response('broken', {status:502})), /502/);
  await assert.rejects(synthesize({text:' '.repeat(5)}), /text/);
});
test('omits auto model and forwards an explicit Brute model id', async () => {
  await synthesize({text:'Hello', language:'en', model:'auto', baseURL:'http://localhost:5445'}, async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {text:'Hello', language:'en'});
    return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}});
  });
  await synthesize({text:'Hello', language:'en', model:'piper_tts:en_US-ryan-high', baseURL:'http://localhost:5445'}, async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {text:'Hello', language:'en', model:'piper_tts:en_US-ryan-high'});
    return new Response('audio', {headers:{'Content-Type':'audio/mpeg'}});
  });
});
test('loads available speech models from Brute and keeps Auto when catalog is missing', async () => {
  assert.equal(normalizeSpeechModel(''), 'auto');
  const models = speechModelsFromResponse({
    models:[
      {id:'auto', label:'Auto', available:true},
      {id:'piper_tts:ru_RU-ruslan-medium', label:'Piper Ruslan', available:true},
      {id:'macos_say_tts:Milena', label:'macOS Milena', available:false},
    ],
  });
  assert.deepEqual(models.map(model => model.id), ['auto', 'piper_tts:ru_RU-ruslan-medium']);
  const fetched = await listSpeechModels('http://localhost:5445', async url => {
    assert.equal(url, 'http://localhost:5445/speech/models');
    return new Response(JSON.stringify({models:[{id:'edge_tts:en-US-EmmaMultilingualNeural', label:'Edge Emma', available:true}]}), {headers:{'Content-Type':'application/json'}});
  });
  assert.deepEqual(fetched.map(model => model.id), ['auto', 'edge_tts:en-US-EmmaMultilingualNeural']);
  const fallback = await listSpeechModels('http://localhost:5445', async () => new Response('nope', {status:404}));
  assert.deepEqual(fallback.map(model => model.id), ['auto']);
});
class FakeAudio extends EventTarget {
  paused = true; currentTime = 0; duration = 120; src = ''; playbackRate = 1;
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() {}
  removeAttribute() { this.src = ''; }
}
const setup = (synth) => {
  const audio = new FakeAudio(); const revoked = [];
  const player = new Player(audio, synth, { createObjectURL: () => 'blob:test', revokeObjectURL: u => revoked.push(u) });
  return { player, audio, revoked };
};
test('loading -> playing -> pause/resume -> seek/end and cached replay', async () => {
  let calls = 0;
  const {player, audio, revoked} = setup(async () => { calls++; return new Blob(['audio']); });
  const pending = player.start(1, {text:'hello'});
  assert.equal(player.status(1).phase, 'loading');
  await pending;
  assert.equal(player.status(1).phase, 'playing');
  await player.command(1, 'toggle');
  assert.equal(player.status(1).phase, 'paused');
  await player.command(1, 'toggle');
  await player.command(1, 'seek', 35);
  assert.equal(audio.currentTime, 35);
  await player.command(2, 'seek', 50);
  assert.equal(audio.currentTime, 35);
  audio.dispatchEvent(new Event('ended'));
  assert.equal(player.status(1).phase, 'ended');
  await player.command(1, 'toggle');
  assert.equal(audio.currentTime, 0);
  assert.equal(calls, 1);
  player.stop(1);
  assert.deepEqual(revoked, ['blob:test']);
});
test('cancel and replacement ignore stale synthesis, release resources', async () => {
  const pending = [];
  const {player} = setup(() => new Promise(resolve => pending.push(resolve)));
  const first = player.start(1, {text:'one'});
  player.stop(1);
  pending[0](new Blob(['old'])); await first;
  assert.equal(player.status(1).phase, 'idle');
  const second = player.start(1, {text:'two'});
  const third = player.start(2, {text:'three'});
  pending[1](new Blob(['old'])); pending[2](new Blob(['new']));
  await Promise.all([second, third]);
  assert.equal(player.status(1).phase, 'idle');
  assert.equal(player.status(2).phase, 'playing');
});
test('autoplay rejection offers manual play, synthesis failure offers retry', async () => {
  const {player, audio} = setup(async () => new Blob(['audio']));
  audio.play = async () => { throw new Error('autoplay denied'); };
  await player.start(1, {text:'one'});
  assert.equal(player.status(1).phase, 'paused');
  const {player: broken} = setup(async () => { throw new Error('server unavailable'); });
  await broken.start(1, {text:'one'});
  assert.equal(broken.status(1).phase, 'error');
});
