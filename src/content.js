import { extractArticle } from './article.js';
import { mountPlayer } from './ui.js';
const send = message => chrome.runtime.sendMessage({target:'background', ...message});
let mounted; let href = location.href; let scheduled; let lastScan = 0;
function scan() {
  scheduled = null;
  if (location.href !== href || (mounted && !mounted.host.isConnected)) {
    mounted?.destroy(); mounted = null; href = location.href;
  }
  if (mounted) return;
  lastScan = Date.now();
  try {
    const article = extractArticle(document);
    if (article) mounted = mountPlayer(article, send);
  } catch (error) { console.info('HearHear:', error.message); }
}
const observer = new MutationObserver(() => {
  if (!scheduled && (!mounted || !mounted.host.isConnected || href !== location.href)) {
    scheduled = setTimeout(scan, Math.max(300, 2000 - (Date.now() - lastScan)));
  }
});
observer.observe(document.documentElement, {childList:true, subtree:true});
scan();
let routeTimer = setInterval(() => { if (href !== location.href) scan(); }, 1500);
addEventListener('pagehide', () => {
  observer.disconnect(); clearInterval(routeTimer); clearTimeout(scheduled); scheduled = null; mounted?.destroy(); mounted = null;
});
addEventListener('pageshow', event => {
  if (!event.persisted) return;
  observer.observe(document.documentElement, {childList:true, subtree:true});
  routeTimer = setInterval(() => { if (href !== location.href) scan(); }, 1500);
  scan();
});
