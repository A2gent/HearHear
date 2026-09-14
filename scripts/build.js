import { build } from 'esbuild';
import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
await rm('dist', {recursive:true, force:true});
await mkdir('dist');
await build({entryPoints:['src/content.js'], bundle:true, outfile:'dist/content.js', format:'iife', target:'chrome116'});
await build({entryPoints:['src/background.js','src/offscreen.js','src/options.js'], bundle:true, outdir:'dist', format:'esm', target:'chrome116'});
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
// The repository manifest loads dist assets; the distributable is self-contained.
manifest.background.service_worker = manifest.background.service_worker.replace(/^dist\//, '');
manifest.options_page = manifest.options_page.replace(/^dist\//, '');
if (manifest.action?.default_popup) manifest.action.default_popup = manifest.action.default_popup.replace(/^dist\//, '');
for (const script of manifest.content_scripts) script.js = script.js.map(path => path.replace(/^dist\//, ''));
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
for (const file of ['options.html','options.css','popup.html','popup.css','offscreen.html']) await copyFile(file, `dist/${file}`);
await mkdir('dist/icons', {recursive:true});
for (const file of new Set([...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {})])) {
  await copyFile(file, `dist/${file}`);
}
console.log('Load unpacked: HearHear (or HearHear/dist)');
