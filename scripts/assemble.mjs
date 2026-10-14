// Inlines the bundled game and stylesheet into single-file pages:
//   dist/index.html     full document (Electron, itch.io, any static host)
//   dist/artifact.html  body-only fragment for publishing as a claude.ai artifact
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'src/styles/game.css'), 'utf8');
const js = readFileSync(join(root, 'dist/game.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
mkdirSync(join(root, 'dist'), { recursive: true });

const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'">`;
const full = tpl.replace('<!--CSP-->', csp).replace('/*CSS*/', () => css).replace('/*JS*/', () => js);
writeFileSync(join(root, 'dist/index.html'), full);

// artifact fragment: title, font link, style, markup, script (the host adds the document skeleton)
const head = tpl.slice(tpl.indexOf('<title>'), tpl.indexOf('</head>')).replace(/<link rel="icon"[^>]*>\s*/, '').replace('/*CSS*/', () => css);
const body = tpl.slice(tpl.indexOf('<body>') + 6, tpl.indexOf('</body>')).replace('/*JS*/', () => js);
writeFileSync(join(root, 'dist/artifact.html'), head.trim() + '\n' + body.trim() + '\n');
console.log(`dist/index.html ${(full.length / 1024).toFixed(0)} KB`);
