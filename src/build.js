// inline css/model/app into a single artifact html
const fs = require('fs'), path = require('path');
const src = __dirname;
const page = fs.readFileSync(path.join(src, 'page.html'), 'utf8');
const css = fs.readFileSync(path.join(src, 'style.css'), 'utf8');
const model = fs.readFileSync(path.join(src, 'model.js'), 'utf8');
const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');
const doc = fs.readFileSync(path.join(src, 'doc.html'), 'utf8');
const out = page.replace('/* __CSS__ */', () => css).replace('/* __MODEL__ */', () => model).replace('/* __APP__ */', () => app).replace('<!-- __DOC__ -->', () => doc);
const dist = path.join(src, '..', 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'chatter-lab.html'), out);
const wrap = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + out + '</body></html>';
fs.writeFileSync(path.join(dist, 'test.html'), wrap);
console.log('built', (out.length / 1024).toFixed(0), 'KB');
