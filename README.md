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
6. Pause/resume with the same icon or use the seek slider. Closing or navigating away from the source tab cancels synthesis and discards audio. A new article replaces the currently playing one.

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

Detection requires a heading inside the candidate, substantial prose and low link density in article/main/content containers. Only one player is mounted: among qualifying blocks, the visually widest column wins, then the one with the most text. Sibling article cards (homepage/blog grids) are skipped so the player does not split unrelated tiles. Listing pages and short snippets are intentionally skipped. Dynamically inserted articles and URL changes are rescanned with throttling. Same-URL changes to already-mounted article content require reload. A 60,000-character article limit, 64 MiB audio limit and 4-minute synthesis timeout bound resource use. Oversized articles are not silently truncated: detection logs an explanatory console message and does not inject a player.

## Architecture and privacy

- `article.js`: extraction, normalization and source-element segment mapping.
- `content.js` / `ui.js`: isolated-world detection and accessible, closed Shadow DOM controls. No page `postMessage` bridge; synthesis requires a trusted button click.
- `background.js`: sender validation, loopback-only endpoint configuration, offscreen lifecycle, tab cleanup. No arbitrary API proxy, cookies or redirects.
- `offscreen.js` / `player.js`: speech fetch, cancel, Blob URL lifetime, audio state. The service worker never waits for synthesis. The offscreen document uses the `BLOBS` reason because it owns object URLs, avoiding the 30-second silence timeout of `AUDIO_PLAYBACK` while synthesis runs.
- Only settings are persisted, including the selected Brute speech model id. Text/audio remain in extension memory until stop/replacement/unload. Brute can cache audio independently. **Local Brute does not necessarily mean offline TTS**: Edge and ElevenLabs send text to cloud services. This is disclosed in the toolbar popup and options page.
- Content scripts run on HTTP(S) pages to detect articles, but no page data is sent before Play. No remote code or runtime npm dependencies.

### Word highlighting

Not implemented: the current Speech API returns no word timestamps. Guessed word timings would drift badly for Russian and summarized tables/code. Extraction retains source segment references for a future timestamp-based highlighter. Playback and seeking work without highlighting.

## Verification

```sh
npm run check           # node:test, ESLint, unpacked extension build
npx playwright install chromium
npm run test:browser    # actual MV3 in headless Chromium + local fake Speech server
```

Browser smoke tests both root-folder and standalone `dist/` installations, including their toolbar popup settings pages. It covers a CSP-restricted article, trusted clicks into closed Shadow DOM, no premature transmission, RU request, loader, actual offscreen audio playback, pause, seek, cached resume, and navigation cleanup. The mock returns silent WAV; it does not validate speech quality.

## Decisions

- Product name in Chrome is **HearHear by Agent ²**. Toolbar short name is HearHear.
- User selected **local repository + Speech API**, not remote repository publication or LLM-agent sessions.
- One audio track at a time; full audio generated before playback, not streaming chunks.
- English/Russian voice selection is deterministic when language is supplied.
- The toolbar popup lists TTS models from Brute. Auto ranks neural engines above macOS `say` because compact system voices are the poor-quality fallback that previously won on Mac.
- Precise highlighting is deferred pending a real timestamp contract.
