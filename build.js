// Junta todo en un único index.html autocontenido.
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
let js = ['engine.js', 'net.js', 'qr.js', 'app.js'].map(src).join('\n;\n');
if (!process.argv.includes('--dev')) {
  const esbuild = require('/opt/npm-tools/node_modules/esbuild');
  js = esbuild.transformSync(js, { minify: true, target: 'es2017', legalComments: 'none' }).code;
}
if (/<\/script/i.test(js)) throw new Error('el código contiene </script>');
const icon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="#e1b33b"/><path d="M20,44V31L32,20L44,31V44Z" fill="#e5383b" stroke="#141414" stroke-width="2.5"/></svg>');
const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0e1622">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="description" content="Hexaldea: juego de mesa de construir y comerciar para jugar con amigos desde el móvil, con el tablero en la tele.">
<title>Hexaldea</title>
<link rel="icon" href="${icon}">
<style>${src('app.css')}</style>
</head>
<body>
<div id="app"></div>
<noscript>Hexaldea necesita JavaScript.</noscript>
<script>${js}</script>
</body>
</html>
`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), html);
console.log('dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
