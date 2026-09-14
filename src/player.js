import { splitChunks, wordAtTime } from './chunks.js';

export class Player {
  constructor(audio, synthesize, urls = URL) {
    this.audio = audio; this.synthesize = synthesize; this.urls = urls;
    this.owner = null; this.phase = 'idle'; this.error = ''; this.generation = 0;
    this.chunks = []; this.cache = new Map(); this.index = 0; this.rate = 1;
    for (const event of ['play', 'pause', 'ended', 'error']) audio.addEventListener(event, () => {
      if (!this.url) return;
      if (event === 'ended' && this.index + 1 < this.chunks.length) {
        void this.activate(this.index + 1, this.generation);
        return;
      }
      this.phase = {play:'playing', pause:'paused', ended:'ended', error:'error'}[event];
      if (event === 'play') this.prefetch();
      if (event === 'error') this.error = 'Audio playback failed. / Не удалось воспроизвести аудио.';
    });
  }
  status(owner) {
    if (owner !== this.owner) return {phase:'idle', currentTime:0, duration:0};
    const duration = this.url && Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    const currentTime = this.url ? this.audio.currentTime || 0 : 0;
    const word = ['playing','paused'].includes(this.phase) ? wordAtTime(this.chunks[this.index], currentTime, duration) : null;
    return {phase:this.phase, error:this.error, currentTime, duration, rate:this.rate,
      chunkIndex:this.index, chunkCount:this.chunks.length, wordStart:word?.start ?? null, wordEnd:word?.end ?? null};
  }
  releaseAudio() {
    const url = this.url;
    this.url = null;
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    if (url) this.urls.revokeObjectURL(url);
  }
  stop(owner) {
    if (owner !== this.owner) return;
    this.generation++;
    this.controller?.abort();
    this.releaseAudio(); this.cache.clear(); this.chunks = [];
    this.request = null; this.owner = null; this.phase = 'idle'; this.error = '';
  }
  async start(owner, request) {
    this.stop(this.owner);
    this.owner = owner; this.phase = 'loading'; this.index = 0;
    this.controller = new AbortController();
    const generation = ++this.generation;
    try {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 60000) throw new Error('Invalid article.');
      this.chunks = splitChunks(request.text, request.language);
      this.request = request;
      if (request.rate) this.setRate(request.rate);
      await this.activate(0, generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.phase = 'error'; this.error = error.message;
    }
  }
  prepare(index) {
    if (!this.cache.has(index)) {
      // Store failures as results: a failed speculative request must not interrupt
      // the sentence currently playing or become an unhandled rejection.
      const request = {...this.request, text:this.chunks[index].text, signal:this.controller.signal};
      const pending = (async () => {
        try { return {blob:await this.synthesize(request)}; }
        catch (error) { return {error}; }
      })();
      this.cache.set(index, pending);
    }
    return this.cache.get(index);
  }
  prefetch() {
    if (this.phase === 'playing' && this.index + 1 < this.chunks.length) void this.prepare(this.index + 1);
  }
  async activate(index, generation) {
    this.releaseAudio();
    this.index = index; this.phase = 'loading'; this.error = '';
    // Keep only current + one-ahead audio. Replaying a completed article starts
    // synthesis again rather than retaining an unbounded article-sized cache.
    for (const key of this.cache.keys()) if (key < index) this.cache.delete(key);
    const result = await this.prepare(index);
    if (generation !== this.generation) return;
    if (result.error) { this.phase = 'error'; this.error = result.error.message; return; }
    this.url = this.urls.createObjectURL(result.blob);
    this.audio.src = this.url;
    this.audio.currentTime = 0; this.audio.playbackRate = this.rate;
    await this.play(generation);
  }
  async play(generation = this.generation) {
    try { await this.audio.play(); }
    catch (error) {
      if (generation !== this.generation) return;
      this.phase = 'paused';
      // pause() before playback started rejects play() with AbortError; that is the user's pause, not a policy block.
      if (error?.name !== 'AbortError') this.error = 'Press play to allow audio. / Нажмите воспроизведение ещё раз.';
    }
  }
  setRate(value) {
    if (!Number.isFinite(value) || value < 0.5 || value > 3) return;
    this.rate = value;
    // load() resets playbackRate to defaultPlaybackRate, so set both for later chunks.
    this.audio.defaultPlaybackRate = value; this.audio.playbackRate = value;
  }
  async command(owner, action, value) {
    if (action === 'rate') { this.setRate(value); return; }
    if (owner !== this.owner) return;
    if (action === 'stop') { this.stop(owner); return; }
    if (!this.url) return;
    if (action === 'pause') {
      this.error = '';
      this.audio.pause();
      // The pause event is dispatched later; report the new phase now so the reply is not stale.
      if (this.phase === 'playing') this.phase = 'paused';
    }
    if (action === 'restart') { this.error = ''; this.audio.currentTime = 0; await this.play(); }
    if (action === 'play') {
      this.error = '';
      if (this.phase === 'ended' && this.chunks.length > 1) { await this.start(owner, this.request); return; }
      if (this.phase === 'ended') this.audio.currentTime = 0;
      if (this.phase !== 'playing') await this.play();
    }
    if (action === 'seek' && Number.isFinite(value) && Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(value, this.audio.duration));
  }
}
