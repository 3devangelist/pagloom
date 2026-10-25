// Pagloom — servidor de teste da interface, sem compilar o Go.
// Serve web/ e imita a API do programa: sem scanner; a exportação usa a janela "Guardar como" do Windows.
// Uso: node dev-server.js [porta]   (ou testar-interface.bat no Windows)
// Antes, as bibliotecas têm de estar em web/lib/ (bash fetch-libs.sh).
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { exec, execFile } = require('child_process');

const WEB = path.join(__dirname, 'web'), OUT = path.join(__dirname, 'dev-out');
const PORT = +process.argv[2] || 8765;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const SETTINGS = path.join(OUT, 'settings.json');

if (!fs.existsSync(path.join(WEB, 'lib', 'opencv.js'))) console.warn('Aviso: faltam bibliotecas em web/lib/ — corre "bash fetch-libs.sh" primeiro.');
fs.mkdirSync(OUT, { recursive: true });

function json(res, o) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); }
function body(req) { return new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }
const okDirs = new Set(); // pastas escolhidas no "Guardar como" (escrita permitida, como no programa)
let lastDir = path.join(os.homedir(), 'Documents');
const inOut = (p) => {
  const f = path.resolve(p || '');
  return f.startsWith(OUT + path.sep) || okDirs.has(path.dirname(f).toLowerCase()) ? f : null;
};
// Janela "Guardar como" do Windows (por PowerShell); noutros sistemas grava em dev-out
function saveAs(name, ext, desc) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(path.join(OUT, name)); return; }
    const esc = (s) => String(s).replace(/'/g, "''").replace(/[|\r\n]/g, ' ');
    const ps = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; " +
      '$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; $d = New-Object System.Windows.Forms.SaveFileDialog; ' +
      `$d.Title = 'Guardar como'; $d.FileName = '${esc(name)}'; $d.InitialDirectory = '${esc(lastDir)}'; $d.OverwritePrompt = $true; ` +
      `$d.Filter = '${esc(desc)} (*.${ext})|*.${ext}|Todos os ficheiros (*.*)|*.*'; ` +
      "if ($d.ShowDialog($f) -eq 'OK') { $d.FileName }";
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { encoding: 'utf8' }, (err, out) => resolve((out || '').trim() || null));
  });
}

async function api(req, res, p, q) {
  switch (p) {
    case 'ping': case 'unsaved': case 'lang': return json(res, { ok: true });
    case 'info': return json(res, { os: process.platform === 'win32' ? 'windows' : 'linux', driverUI: false, cpus: os.cpus().length, memTotal: os.totalmem(), memAvail: os.freemem() });
    case 'deps': return json(res, { ok: true });
    case 'devices': return json(res, { devices: [] }); // sem scanner
    case 'scan': return json(res, { error: 'Servidor de teste: não há scanner. Adiciona imagens ou PDFs.' });
    case 'settings':
      if (req.method === 'POST') { fs.writeFileSync(SETTINGS, await body(req)); return json(res, { ok: true }); }
      res.setHeader('Content-Type', 'application/json');
      return res.end(fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : '{}');
    case 'choose': {
      const name = path.basename(q.get('name') || 'saida').replace(/[<>:"/\\|?*]/g, '_');
      const ext = (q.get('ext') || '').replace(/[^a-z0-9]/gi, '') || '*';
      const p = await saveAs(name, ext, q.get('desc') || ext.toUpperCase());
      if (!p) return json(res, { cancelled: true });
      okDirs.add(path.dirname(p).toLowerCase()); lastDir = path.dirname(p);
      return json(res, { path: p, dir: path.dirname(p), note: '' });
    }
    case 'devsave': { // só no servidor de teste: grava em dev-out sem perguntar (bancada, diagnóstico)
      fs.writeFileSync(path.join(OUT, path.basename(q.get('name') || 'saida')), await body(req));
      return json(res, { ok: true });
    }
    case 'write': {
      const f = inOut(q.get('path'));
      if (!f) { res.statusCode = 403; return res.end('caminho não autorizado'); }
      fs.writeFileSync(f, await body(req));
      return json(res, { path: f });
    }
    case 'exists': return json(res, { exists: fs.existsSync(q.get('path') || '') });
    case 'reveal': {
      const f = inOut(q.get('path'));
      if (f) exec(process.platform === 'win32' ? `explorer.exe /select,"${f}"` : `xdg-open "${OUT}"`);
      return json(res, { ok: true });
    }
    default: res.statusCode = 404; return res.end('404');
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) return api(req, res, u.pathname.slice(5), u.searchParams).catch((e) => json(res, { error: e.message }));
  // /dev-out/… serve os ficheiros de teste (scripts de diagnóstico, imagens) da pasta dev-out
  const base = u.pathname.startsWith('/dev-out/') ? OUT : WEB;
  const rel = u.pathname.startsWith('/dev-out/') ? u.pathname.slice(9) : (u.pathname === '/' ? 'index.html' : u.pathname);
  const f = path.join(base, decodeURIComponent(rel));
  if (!f.startsWith(base)) { res.statusCode = 403; return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.statusCode = 404; return res.end('404'); }
    res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(d);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Pagloom (teste da interface): http://127.0.0.1:${PORT}/`);
  console.log('Exportar abre a janela "Guardar como" do Windows; testes e diagnósticos ficam em ' + OUT);
  console.log('Ctrl+C para parar.');
});
