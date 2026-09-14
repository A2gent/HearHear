# HearHear by Agent ²

Chrome extension that finds a readable article on the page, injects a compact audio player, and reads the cleaned text aloud through a local Brute Speech API. Synthesis starts only when you press Play. Russian and English are supported.

HearHear is part of the Agent ² / A2gent workspace. It does not talk to remote agents by itself: it sends article text to the Brute server you configure (default `http://localhost:5445`).

## Install

Requirements: Node.js 22+, Chrome 116+ (current Chrome recommended), and a running Brute server with `GET /speech/models` and `POST /speech/completion`.

```sh
npm ci
npm run check
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this repository root (`HearHear`). The `dist/` directory also works as a standalone installation. Build first; do not install both copies at once.
3. Open the toolbar popup for settings. Default server: `http://localhost:5445`.
4. Open or reload an article, for example <https://kurapov.ee/ru/blog/tech/hdr-formats-and-xiaomi-17/>.
5. Press the Play icon. A loader remains until audio is ready. Playback starts automatically; if Chrome blocks autoplay, press Play again.
6. Pause/resume with the same icon or use the seek slider within the current chunk. The clock shows chunk number/count and time within that chunk. Closing or navigating away from the source tab cancels synthesis and discards audio. A new article replaces the currently playing one.

After changing source files, run `npm run build`, reload the extension, then reload the article tab. Chrome internal pages, Web Store pages, PDFs, iframes, and closed shadow-root article content are not supported.

### Brute requirement

Rebuild and restart Brute so the extension can list engines and skip low-quality macOS compact voices by default. Older servers still synthesize if `model` is omitted.

```http
GET /speech/models
Accept: application/json
```

Response: `{ "models": [{ "id": "auto" | "engine:voice", "label": "...", "engine": "piper_tts", "available": true, "languages": ["ru"] }] }`. Only engines Brute can actually run are listed (Edge if `edge-tts` is installed, Piper with auto-download, macOS `say` on Darwin, ElevenLabs when an API key is configured).

```http
POST /speech/completion
Content-Type: application/json
Accept: audio/*

{"text":"Здравствуйте. Это статья.","language":"ru","model":"piper_tts:ru_RU-ruslan-medium"}
```

Response: raw audio bytes, e.g. `audio/mpeg` or `audio/mp4`. Auto ranking is ElevenLabs, Edge multilingual (`en-US-EmmaMultilingualNeural` for RU and EN), Piper neural, then macOS `say`. Explicit `model` tries that engine first. Piper can download a voice on first use; macOS compact voices must already be installed.

## Incremental playback and word highlighting

- Pressing Play sends the first sentence (or heading) immediately, not the entire article. Paragraph boundaries are preserved; long sentences split at whitespace with a hard 400-character limit.
- Once a chunk starts playing, exactly one following chunk may be synthesized ahead. Completing that request does not drain the rest of the article into the queue. Pausing does not start further requests, although an already-running prefetch may finish.
- Playback advances automatically. If the next chunk is still generating, the player displays the loader until it is ready. Navigation, tab close, or another article cancels current/prefetched synthesis.
- The slider seeks **within the current chunk**, not the whole article. Completed chunks are discarded to bound audio memory. Replaying a completed multi-chunk article synthesizes it again.
- The spoken word is highlighted on the original page without inserting wrappers or rewriting content. Normalized text is mapped back to its text nodes, including inline formatting. Generated labels such as “Code” have no source word and are not highlighted. The player stays fixed at the bottom of the viewport while the article scrolls.
- The page automatically follows playback when the highlighted word leaves the central reading area. Scrolling is smooth and only happens near the top or bottom of the viewport, so every word does not trigger page movement.
- **Timing is approximate:** Brute currently returns only raw audio, not word timestamps. Word duration is estimated by text length within each chunk, so alignment resets at each boundary. Pausing freezes the highlight; seeking updates it. Exact synchronization requires backend word timestamps/forced alignment.
- Word highlighting and automatic reading-position scrolling require the CSS Custom Highlight API (current Chrome); playback still works without them.

## Reading rules

| Content | Speech |
| --- | --- |
| Headings and paragraphs | Read in DOM order |
| Table | "Table / Таблица" and up to 16 header cells, not data rows |
| Image | Description from `aria-label`, `aria-labelledby`, or `alt`; otherwise omitted |
| SVG, canvas, Mermaid | "Diagram / Диаграмма", without contents |
| Code, including inline code | "Code / Код", without contents |
| Link | Visible label, never URL (no repetitive link announcement) |
| Outer ordered list | Item number, respecting `start`, `value`, and `reversed` |
| Nested or unordered list | Text, without deep numbering |
| Noise | Quotes, raw URLs, long hexadecimal hashes, long numeric sequences and control characters omitted |
| Navigation, related articles, comments, forms, hidden content | Excluded |

Detection requires a heading inside the candidate, substantial prose and low link density in article/main/content containers. Only one player is mounted: among qualifying blocks, the visually widest column wins, then the one with the most text. Sibling article cards (homepage/blog grids) are skipped so the player does not split unrelated tiles. Listing pages and short snippets are intentionally skipped. Dynamically inserted articles and URL changes are rescanned with throttling. Same-URL changes to already-mounted article content require reload. A 60,000-character article limit, 400-character chunk limit, 64 MiB audio limit per chunk and 4-minute synthesis timeout per request bound resource use. Oversized articles are not silently truncated: detection logs an explanatory console message and does not inject a player.

## Architecture and privacy

- `article.js`: extraction, normalization and character-to-DOM source mapping.
- `chunks.js`: sentence/paragraph boundaries, bounded request sizes and approximate word timing.
- `highlight.js`: non-destructive CSS Custom Highlight ranges on the original article.
- `content.js` / `ui.js`: isolated-world detection and accessible, closed Shadow DOM controls. No page `postMessage` bridge; synthesis requires a trusted button click.
- `background.js`: sender validation, loopback-only endpoint configuration, offscreen lifecycle, tab cleanup. No arbitrary API proxy, cookies or redirects.
- `offscreen.js` / `player.js`: speech fetch, cancel, Blob URL lifetime, audio state. The service worker never waits for synthesis. The offscreen document uses the `BLOBS` reason because it owns object URLs, avoiding the 30-second silence timeout of `AUDIO_PLAYBACK` while synthesis runs.
- Only settings are persisted, including the selected Brute speech model id. Text remains in extension memory until stop/replacement/unload; audio is limited to current/next chunks and released as playback advances. Brute can cache audio independently. **Local Brute does not necessarily mean offline TTS**: Edge and ElevenLabs send text to cloud services. This is disclosed in the toolbar popup and options page.
- Content scripts run on HTTP(S) pages to detect articles, but no page data is sent before Play. No remote code or runtime npm dependencies.

## Verification

```sh
npm run check           # node:test, ESLint, unpacked extension build
npx playwright install chromium
npm run test:browser    # actual MV3 in headless Chromium + local fake Speech server
```

Browser smoke tests both root-folder and standalone `dist/` installations, including their toolbar popup settings pages. It covers a CSP-restricted article, trusted clicks into closed Shadow DOM, no premature transmission, bounded RU requests, loader, actual offscreen audio playback, pause, seek, one-ahead prefetch, automatic chunk transitions, word highlights, and navigation cleanup. The mock returns silent WAV; it does not validate speech quality.

## Decisions

- Product name in Chrome is **HearHear by Agent ²**. Toolbar short name is HearHear.
- User selected **local repository + Speech API**, not remote repository publication or LLM-agent sessions.
- One audio track at a time; full audio generated before playback, not streaming chunks.
- English/Russian voice selection is deterministic when language is supplied.
- The toolbar popup lists TTS models from Brute. Auto ranks neural engines above macOS `say` because compact system voices are the poor-quality fallback that previously won on Mac.
- Approximate word highlighting ships now; exact synchronization is deferred pending a backend timestamp contract.
