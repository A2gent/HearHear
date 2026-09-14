import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountPlayer } from '../src/ui.js';

function mount(language = 'en') {
  const dom = new JSDOM('<article><h1>Title</h1><p>Hello</p></article>');
  const {document, Element} = dom.window;
  const shadows = new WeakMap();
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = attach.call(this, init);
    shadows.set(this, root);
    return root;
  };
  const player = mountPlayer({root:document.querySelector('article'), language, text:'Hello'}, async () => ({phase:'idle'}));
  return {root:shadows.get(player.host), player};
}

test('idle player is a compact icon row without stop or settings', () => {
  const {root, player} = mount();
  try {
    const buttons = [...root.querySelectorAll('button')];
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].getAttribute('aria-label'), 'Play');
    assert.equal(buttons[0].textContent.trim(), '');
    assert.ok(buttons[0].querySelector('svg path'));
    assert.match(buttons[0].querySelector('svg path').getAttribute('d'), /M8 5v14l11-7/);
    assert.equal(root.querySelector('.status').textContent, '');
    assert.equal(buttons.some(button => /Stop|Settings|Стоп|Настройки/.test(button.textContent)), false);
    const css = root.querySelector('style').textContent;
    assert.match(css, /padding:6px 8px/);
    assert.match(css, /width:28px;height:28px/);
  } finally { player.destroy(); }
});

test('Russian player keeps accessible play label on the icon', () => {
  const {root, player} = mount('ru');
  try {
    const play = root.querySelector('button');
    assert.equal(play.getAttribute('aria-label'), 'Слушать');
    assert.ok(play.querySelector('svg'));
    assert.equal(root.querySelectorAll('button').length, 1);
  } finally { player.destroy(); }
});
