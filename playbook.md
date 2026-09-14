# Playbook

- Check component Git roots and agent project bindings before Git operations/delegation. Workspace-wide coder and reviewer definitions may be unavailable to this project.
- Discover Brute routes and tool schemas before assuming `/api` prefixes or voice/model keys. Piper takes `model_path`, not `model`.
- Run test-file syntax checks before debugging behavior; an extra parenthesis in `assert.rejects` prevents the whole test file from loading.
- Explain intentional control-character filtering with a scoped ESLint suppression instead of disabling the rule globally.
- Browser tests must wait for the content player's polling/render cycle, not only the offscreen audio state; state can change before the Pause button appears.
- A focused closed Shadow DOM host is not evidence that the user is dragging a seek slider. Track drag state explicitly and set slider max before value.
- Cancellation must invalidate pending offscreen creation as well as in-flight synthesis to prevent late playback after Stop/navigation.
- Inspect command recipe/file names before reading them: Brute uses `justfile`, not `Makefile`, and CLI source filenames may differ from command names.
- A root manifest makes users expect the repository itself to be loadable. Point it to built assets and test both root and dist installations, including options and offscreen paths; testing only dist misses this installation failure.
- Player unit tests must call `destroy()`: `mountPlayer` starts a status polling interval that keeps the Node event loop alive after assertions finish.
- Closed Shadow DOM is opaque to tests. Patch `Element.prototype.attachShadow` on the JSDOM window (not the Node global) to capture the returned root.
- Do not treat every `<article>` as the page article. Homepage and blog index cards on kurapov.ee are sibling `<article>` elements with long excerpts; injecting a player into one of them breaks the CSS grid. Skip 3+ sibling article cards, require a heading inside the candidate, and prefer the widest remaining column.
- `new URL('..', import.meta.url)` already points at the parent directory. Extra `dirname()` on that path walks one level too far when the URL has a trailing slash.
- Origin is `git@github.com:A2gent/HearHear.git`. Push is possible; do not assume there is no remote.
