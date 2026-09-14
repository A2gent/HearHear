const EXCLUDED = 'script,style,noscript,nav,aside,footer,form,button,input,textarea,select,[hidden],[aria-hidden="true"],[inert],[contenteditable="true"],.related-articles,.article-meta,.comments,#comments,[role="navigation"],[data-chrome-sound]';
const SPECIAL = 'table,img,svg,canvas,pre,code,.mermaid,[role="img"]';
const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd';
export function cleanText(text) {
  return text.normalize('NFKC')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/\b[a-f\d]{24,}\b/gi, '')
    .replace(/\d(?:[\d\s-]{11,}\d)/g, '')
    // Control characters are deliberately stripped before sending text to TTS.
    // eslint-disable-next-line no-control-regex
    .replace(/[«»„“”"`]|[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ')
    .replace(/[_=~*#|]{3,}/g, ' ')
    .replace(/[—–]/g, ', ')
    .replace(/\s+/g, ' ').trim();
}
function excluded(el) {
  if (el.matches(EXCLUDED)) return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.display === 'none' || style?.visibility === 'hidden';
}
function visualWidth(el) {
  return el.getBoundingClientRect?.().width || el.clientWidth || 0;
}
function isListingCard(el) {
  // WHY: homepage/blog grids are many sibling <article> cards. A player inside one
  // of them splits the grid. Keep only a uniquely wide sibling (article + sidebar).
  const siblings = [...(el.parentElement?.children || [])].filter(node => node.matches?.('article'));
  if (siblings.length < 2) return false;
  if (siblings.length >= 3) return true;
  const widths = siblings.map(visualWidth);
  const widest = Math.max(...widths);
  return widest <= 0 || visualWidth(el) < widest * 0.85;
}
function label(el) {
  const ids = el.getAttribute('aria-labelledby');
  return cleanText(el.getAttribute('aria-label') || (ids && ids.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent || '').join(' ')) || el.getAttribute('alt') || '');
}
function collect(root, language) {
  const ru = language === 'ru';
  const segments = [];
  let buffer = '';
  let source = root;
  const flush = () => {
    const text = cleanText(buffer);
    if (text) segments.push({ text, element: source });
    buffer = '';
  };
  function walk(node) {
    if (node.nodeType === 3) { buffer += node.textContent; return; }
    if (node.nodeType !== 1 || excluded(node)) return;
    if (node !== root && node.matches('article')) return;
    if (node.matches(SPECIAL)) {
      let text = '';
      if (node.matches('table')) {
        const headers = [...node.querySelectorAll('th')].filter(el => !excluded(el)).slice(0, 16).map(el => cleanText(el.textContent)).join(', ');
        text = `${ru ? 'Таблица' : 'Table'}${headers ? ': ' + headers : ''}.`;
      } else if (node.matches('pre,code')) text = ru ? 'Код.' : 'Code.';
      else if (node.matches('svg,canvas,.mermaid')) text = ru ? 'Диаграмма.' : 'Diagram.';
      else if (label(node)) text = `${ru ? 'Изображение' : 'Image'}: ${label(node)}.`;
      buffer += ` ${text} `;
      return;
    }
    const block = node.matches(BLOCK);
    if (block) { flush(); source = node; }
    if (node.matches('li') && node.parentElement?.matches('ol') && !node.parentElement.parentElement.closest('ol,ul')) {
      let ordinal = Number(node.parentElement.getAttribute('start')) || (node.parentElement.hasAttribute('reversed') ? node.parentElement.children.length : 1);
      const step = node.parentElement.hasAttribute('reversed') ? -1 : 1;
      for (const item of node.parentElement.children) {
        if (item.hasAttribute('value')) ordinal = Number(item.getAttribute('value'));
        if (item === node) break;
        ordinal += step;
      }
      buffer += `${ru ? 'Пункт' : 'Item'} ${ordinal}. `;
    }
    if (node.matches('br,hr')) buffer += ' ';
    for (const child of node.childNodes) walk(child);
    if (block) { flush(); source = root; }
  }
  walk(root);
  flush();
  return segments;
}
export function extractArticle(document) {
  const candidates = [...document.querySelectorAll('[itemprop="articleBody"],article,main,[role="main"],.post-content,.entry-content')];
  const qualified = [];
  for (const root of candidates) {
    if (root.closest(EXCLUDED) || excluded(root) || isListingCard(root)) continue;
    const sample = root.textContent.slice(0, 10000);
    const lang = document.documentElement.lang.toLowerCase();
    const language = lang.startsWith('ru') || (!lang && (sample.match(/[а-яё]/gi)?.length || 0) > (sample.match(/[a-z]/gi)?.length || 0)) ? 'ru' : 'en';
    const segments = collect(root, language);
    const text = segments.map(s => s.text).join('\n\n');
    const paragraphs = segments.filter(s => s.element.matches('p') && s.text.length >= 80);
    const heading = root.querySelector('h1,h2');
    if (!heading || text.length < 300 || paragraphs.length === 0) continue;
    const links = [...root.querySelectorAll('a')].reduce((sum, a) => sum + a.textContent.length, 0);
    if (links > text.length * 0.55) continue;
    qualified.push({ title: cleanText(heading.textContent), language, text, segments, root, width: visualWidth(root) });
  }
  if (!qualified.length) return null;
  const maxWidth = Math.max(...qualified.map(item => item.width));
  const pool = maxWidth > 0 ? qualified.filter(item => item.width >= maxWidth * 0.85) : qualified;
  pool.sort((a, b) => {
    const boost = el => el.matches('article,[itemprop="articleBody"]') ? 1.2 : 1;
    return (b.text.length * boost(b.root)) - (a.text.length * boost(a.root));
  });
  const best = pool[0];
  if (best.text.length > 60000) throw new Error('Article exceeds 60000 characters / Статья длиннее 60000 символов.');
  return best;
}
