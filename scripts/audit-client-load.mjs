// Static import graph estimates, not a network trace or a memory measurement.
// Run after npm run build. Only the explicitly selected dynamic roots are added.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

const root = resolve('dist/public');
const files = readdirSync(resolve(root, 'assets'));
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const entry = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)]
  .map(match => resolve(root, '.' + match[1]));
if (!entry.length) throw new Error('No local entry assets found');

const graph = new Set();
function add(file) {
  if (graph.has(file)) return;
  graph.add(file);
  if (!file.endsWith('.js')) return;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
        && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text.startsWith('.')) {
      add(resolve(dirname(file), statement.moduleSpecifier.text));
    }
  }
}
function asset(prefix) {
  const file = files.find(name => name.startsWith(prefix) && name.endsWith('.js'));
  if (!file) throw new Error('Build asset missing: ' + prefix);
  return resolve(root, 'assets', file);
}

const stages = [
  ['entry', entry],
  ['app', [asset('App-')]],
  ['home', [asset('home-')]],
  ['home_music_3d', [asset('HybridMusicEngine-'), asset('visual-3d-')]],
];
const results = [];
for (const [name, roots] of stages) {
  roots.forEach(add);
  const buffers = [...graph].map(file => readFileSync(file));
  results.push({
    name, fileCount: graph.size,
    rawBytes: buffers.reduce((sum, buffer) => sum + buffer.length, 0),
    gzipBytes: buffers.reduce((sum, buffer) => sum + gzipSync(buffer, { level: 9 }).length, 0),
    files: [...graph].map(file => relative(root, file)).sort(),
  });
}
const output = resolve('.tloque_cache/product-audit');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'client-load-results.json'), JSON.stringify({
  method: 'Cumulative static JS imports/exports and entry CSS; selected dynamic roots only; per-file gzip level 9.',
  limitations: 'Excludes unselected dynamic imports, Vite dynamic preloads, fonts, images, audio, HTML and API. Not measured network traffic, RAM or installed size.',
  results,
}, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ files, ...summary }) => summary)));
