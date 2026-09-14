export class Player {
  constructor(audio, synthesize, urls = URL) {
    this.audio = audio; this.synthesize = synthesize; this.urls = urls;
    this.owner = null; this.phase = 'idle'; this.error = ''; this.generation = 0;
    for (const event of ['play', 'pause', 'ended', 'error']) audio.addEventListener(event, () => {
      if (!this.url) return;
      this.phase = {play:'playing', pause:'paused', ended:'ended', error:'error'}[event];
      if (event === 'error') this.error = 'Audio playback failed. / Не удалось воспроизвести аудио.';
    });
  }
  status(owner) {
    if (owner !== this.owner) return {phase:'idle', currentTime:0, duration:0};
    return {phase:this.phase, error:this.error, currentTime:this.audio.currentTime || 0, duration:Number.isFinite(this.audio.duration) ? this.audio.duration : 0};
  }
  stop(owner) {
    if (owner !== this.owner) return;
    this.generation++;
    this.controller?.abort();
    this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    if (this.url) this.urls.revokeObjectURL(this.url);
    this.url = null; this.owner = null; this.phase = 'idle'; this.error = '';
  }
  async start(owner, request) {
    this.stop(this.owner);
    this.owner = owner; this.phase = 'loading';
    this.controller = new AbortController();
    const generation = ++this.generation;
    try {
      const blob = await this.synthesize({...request, signal:this.controller.signal});
      if (generation !== this.generation) return;
      this.url = this.urls.createObjectURL(blob);
      this.audio.src = this.url;
      this.audio.currentTime = 0;
      await this.play(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.phase = 'error'; this.error = error.message;
    }
  }
  async play(generation = this.generation) {
    try { await this.audio.play(); }
    catch {
      if (generation !== this.generation) return;
      this.phase = 'paused';
      this.error = 'Press play to allow audio. / Нажмите воспроизведение ещё раз.';
    }
  }
  async command(owner, action, value) {
    if (owner !== this.owner) return;
    if (action === 'stop') { this.stop(owner); return; }
    if (!this.url) return;
    if (action === 'toggle') {
      this.error = '';
      if (this.phase === 'playing') this.audio.pause();
      else { if (this.phase === 'ended') this.audio.currentTime = 0; await this.play(); }
    }
    if (action === 'seek' && Number.isFinite(value) && Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(value, this.audio.duration));
  }
}
