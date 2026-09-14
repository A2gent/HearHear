export function mountPlayer(article, send) {
  const doc = article.root.ownerDocument;
  const ru = article.language === 'ru';
  const host = doc.createElement('div'); host.dataset.chromeSound = '';
  const shadow = host.attachShadow({mode:'closed'});
  const style = doc.createElement('style');
  style.textContent = `:host{display:block!important;margin:8px 0!important;color-scheme:light dark}*{box-sizing:border-box}.player{font:12px/1.2 system-ui,sans-serif;background:#182337;color:#f5f7ff;border:1px solid #60718c;border-radius:8px;padding:6px 8px;max-width:720px}.row{display:flex;align-items:center;gap:8px}.icon{cursor:pointer;border:1px solid #7284a0;border-radius:6px;background:#263a58;color:#fff;padding:0;width:28px;height:28px;min-width:28px;min-height:28px;display:grid;place-items:center;flex:0 0 auto}.icon:focus-visible,input:focus-visible{outline:3px solid #ffda69;outline-offset:2px}.icon:disabled{opacity:.65;cursor:wait}input{flex:1;min-width:80px;height:16px;accent-color:#8cbfff}.clock{font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.85}.status{margin-top:4px;overflow-wrap:anywhere}.status:empty{display:none}.spinner{display:inline-block;width:12px;height:12px;border:2px solid #7d8ea8;border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}`;
  const box = doc.createElement('section'); box.className = 'player'; box.setAttribute('aria-label', ru ? 'Озвучивание статьи' : 'Article audio');
  const row = doc.createElement('div'); row.className = 'row';
  const play = doc.createElement('button'); play.type = 'button'; play.className = 'icon';
  const seek = doc.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '0'; seek.step = '.1'; seek.value = '0'; seek.disabled = true; seek.setAttribute('aria-label', ru ? 'Перемотка аудио' : 'Seek audio');
  const clock = doc.createElement('span'); clock.className = 'clock'; clock.textContent = '0:00 / 0:00';
  const status = doc.createElement('div'); status.className = 'status'; status.setAttribute('role','status');
  row.append(play, seek, clock); box.append(row, status); shadow.append(style, box);
  const heading = article.root.querySelector('h1');
  if (heading) heading.after(host); else article.root.prepend(host);
  let state = {phase:'idle'}; let busy = false; let disposed = false; let dragging = false;
  const format = seconds => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2,'0')}`;
  function icon(d) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('fill', 'currentColor'); path.setAttribute('d', d); svg.append(path);
    return svg;
  }
  function render(next) {
    if (disposed || !next) return;
    state = next;
    const loading = state.phase === 'loading';
    play.replaceChildren();
    if (loading) { const spinner = doc.createElement('span'); spinner.className = 'spinner'; spinner.setAttribute('aria-hidden','true'); play.append(spinner); }
    else play.append(icon(state.phase === 'playing' ? 'M6 5h4v14H6zm8 0h4v14h-4z' : 'M8 5v14l11-7z'));
    const label = loading ? (ru ? 'Готовим аудио' : 'Generating audio') : state.phase === 'playing' ? (ru ? 'Пауза' : 'Pause') : (ru ? 'Слушать' : 'Play');
    play.setAttribute('aria-label', label); play.disabled = loading; box.setAttribute('aria-busy', String(loading));
    seek.disabled = !state.duration || loading;
    seek.max = String(state.duration || 0);
    if (!dragging) seek.value = String(state.currentTime || 0);
    clock.textContent = `${format(state.currentTime)} / ${format(state.duration)}`;
    // Keep the bar to one row; settings and TTS disclosure live in the toolbar popup.
    status.textContent = state.error || '';
  }
  async function request(action, extra = {}) {
    try { const next = await send({action, ...extra}); render(next); }
    catch { render({phase:'error', error:ru ? 'Brute недоступен или расширение перезагружено. Проверьте настройки в меню расширения и обновите страницу.' : 'Brute unavailable or extension reloaded. Open the toolbar popup to check settings, then reload this page.'}); }
  }
  play.addEventListener('click', async event => {
    if (!event.isTrusted || busy) return;
    busy = true;
    try {
      if (['idle','error'].includes(state.phase)) {
        render({phase:'loading'});
        await request('start', {text:article.text, language:article.language});
      } else await request('toggle');
    } finally { busy = false; }
  });
  seek.addEventListener('pointerdown', () => { dragging = true; });
  seek.addEventListener('pointerup', () => { dragging = false; });
  seek.addEventListener('blur', () => { dragging = false; });
  seek.addEventListener('change', event => { if (event.isTrusted) void request('seek', {value:Number(seek.value)}); });
  render(state);
  let polling = false;
  const timer = setInterval(async () => {
    if (disposed || polling || busy || state.phase === 'idle' || state.phase === 'error') return;
    polling = true;
    try { await request('status'); } finally { polling = false; }
  }, 400);
  return {host, destroy() { disposed = true; clearInterval(timer); host.remove(); void send({action:'stop'}).catch(() => {}); }};
}
