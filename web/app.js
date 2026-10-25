// Pagloom — interface (corre no WebView2 do Windows)
import * as pdfjsLib from './lib/pdf.min.mjs';
import * as Photo from './photo.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.mjs';
const { PDFDocument, degrees } = window.PDFLib;

// ───────────────────────── utilidades ─────────────────────────
const $ = (id) => document.getElementById(id);
const TOKEN = new URLSearchParams(location.search).get('t') || '';
let uidN = 0;
const uid = () => 'p' + (++uidN) + '_' + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (n, w = 3) => String(n).padStart(w, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function api(path, opts = {}) {
  opts.headers = Object.assign({ 'X-Token': TOKEN }, opts.headers || {});
  const r = await fetch('/api/' + path, opts);
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}

function status(msg, kind = '', html = false) {
  const s = $('status');
  if (html) s.innerHTML = msg; else s.textContent = msg;
  s.className = kind;
}
let busyDepth = 0;
function busy(msg) { busyDepth++; $('busyMsg').textContent = msg; $('busy').classList.remove('hidden'); }
function busyMsg(msg) { $('busyMsg').textContent = msg; }
function idle() { busyDepth = Math.max(0, busyDepth - 1); if (!busyDepth) $('busy').classList.add('hidden'); }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
function ctx2d(c, opts) { const x = c.getContext('2d', opts); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; return x; }
const toBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Falha a codificar a imagem (demasiado grande?)'))), type, q));

// Bibliotecas grandes, carregadas só quando são precisas
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Não foi possível carregar ' + src));
    document.head.appendChild(s);
  });
}
// Fotos → página em vários núcleos: cada Web Worker (photo-worker.js) tem o seu OpenCV e trata uma foto de cada vez.
// Quantos ao mesmo tempo: núcleos e memória livre reais do PC (vêm do programa em Go, /api/info) e tamanho das fotos.
// Cada worker precisa de ~0,6 GB para uma foto de 12 MP (proporcional aos megapíxeis); fica 25% da memória livre
// de reserva. "Núcleos a usar" (separador Página) sobrepõe-se ao automático. Se um worker ficar sem memória,
// o limite (cap) desce e a foto é repetida.
const PER_WORKER_12MP = 0.6e9;
const sys = { cpus: navigator.hardwareConcurrency || 2, memAvail: (navigator.deviceMemory || 4) * 0.5e9, memTotal: 0 };
const pool = { workers: [], queue: [], seq: 0, size: 1, cap: 8 };
function autoWorkers(mpx = 12) {
  const byCpu = Math.max(1, Math.min(8, sys.cpus - 1));
  const byMem = Math.max(1, Math.floor((sys.memAvail * 0.75) / (PER_WORKER_12MP * Math.max(1, mpx / 12))));
  return Math.min(byCpu, byMem);
}
function workersFor(mpx = 12) {
  return Math.max(1, Math.min(+$('photoCores').value || autoWorkers(mpx), pool.cap));
}
async function refreshSys() { // a memória livre muda: lê-se de novo antes de cada lote
  try {
    const i = await api('info');
    if (i.cpus) sys.cpus = i.cpus;
    if (i.memAvail) { sys.memAvail = i.memAvail; sys.memTotal = i.memTotal; }
  } catch (e) { /* fica a estimativa do browser */ }
  updateCoresHint();
}
function updateCoresHint() {
  const el = $('coresHint');
  if (!el) return;
  const gb = (b) => (b / 1e9).toFixed(1).replace('.', ',');
  el.textContent = `Este PC: ${sys.cpus} núcleos` + (sys.memTotal ? `, ${gb(sys.memAvail)} GB livres de ${gb(sys.memTotal)} GB` : '') +
    ` → automático: até ${autoWorkers()} foto(s) de 12 MP em paralelo` + (pool.cap < 8 ? ` (limitado a ${pool.cap} por falta de memória)` : '') + '.';
}
// build() prepara a mensagem só quando há um worker livre (os pixels não ficam todos em memória ao mesmo tempo)
// e devolve { msg, transfer }; é chamado outra vez se a foto tiver de ser repetida.
function poolRun(build, retries = 2) {
  return new Promise((resolve, reject) => { pool.queue.push({ build, retries, resolve, reject }); poolNext(); });
}
function poolNext() {
  // se o número desceu, os workers a mais fecham quando ficarem livres
  while (pool.workers.length > pool.size) {
    const i = pool.workers.findIndex((x) => !x.busy);
    if (i < 0) break;
    pool.workers[i].wk.terminate(); pool.workers.splice(i, 1);
  }
  while (pool.queue.length) {
    let w = pool.workers.find((x) => !x.busy);
    if (!w && pool.workers.length < pool.size) { w = { busy: false, wk: new Worker('photo-worker.js') }; pool.workers.push(w); }
    if (!w) return;
    w.busy = true;
    poolDispatch(w, pool.queue.shift());
  }
}
async function poolDispatch(w, job) {
  const fail = (err) => {
    const oom = err.crash || /memory|enlarge|abort|alloc|out of|oom/i.test(err.message || '');
    if (oom) { // sem memória: fecha este worker, baixa o limite e repete a foto
      w.wk.terminate(); pool.workers.splice(pool.workers.indexOf(w), 1);
      pool.cap = Math.max(1, Math.min(pool.cap, pool.workers.length));
      pool.size = Math.min(pool.size, pool.cap);
      updateCoresHint();
    } else w.busy = false;
    if (oom && job.retries > 0) { job.retries--; pool.queue.unshift(job); } else job.reject(err);
    poolNext();
  };
  let m;
  try { m = await job.build(); } catch (e) { w.busy = false; job.reject(e); poolNext(); return; }
  w.wk.onmessage = (e) => {
    if (e.data.error) { fail(new Error(e.data.error)); return; }
    w.busy = false; job.resolve(e.data); poolNext();
  };
  w.wk.onerror = (e) => { e.preventDefault(); const er = new Error(e.message || 'falha no processamento da foto'); er.crash = true; fail(er); };
  w.wk.postMessage(Object.assign({ id: ++pool.seq }, m.msg), m.transfer);
}
// Pixels de um canvas, prontos a mandar para um worker (o buffer é transferido, não copiado)
function pixelsOf(c) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  return { img: { data: d.data, width: d.width, height: d.height }, transfer: [d.data.buffer] };
}
function canvasFrom(data, w, h, dpi) {
  const o = canvas(w, h);
  o.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  o.dpi = dpi;
  return o;
}
let heifReady = null;
function loadHeif() {
  if (!heifReady) {
    heifReady = loadScript('lib/libheif-bundle.js').then(() => ({ lh: window.libheif() }));
    heifReady.catch(() => { heifReady = null; });
  }
  return heifReady;
}

// ───────────────────────── estado ─────────────────────────
const S = {
  pages: [],          // páginas (objetos imutáveis: uma edição cria um objeto novo)
  cur: -1,
  sel: new Set(),     // ids selecionados
  src: new Map(),     // fontes PDF: key -> { name, bytes, doc (pdf.js), lib (pdf-lib) | null }
  undo: [], redo: [],
  tool: 'pan',
  dual: false,
  zoomF: 1, panX: 0, panY: 0,
  angle: 0,           // ângulo pendente (ferramenta Ângulo)
  crop: null,         // retângulo de recorte em coords do bitmap mostrado
  line: null,         // linha da ferramenta Endireitar
  vt: null,           // transformação do slot atual
  dirty: false,
  askedRaster: false,
};

function snapshot() { return { pages: S.pages.slice(), cur: S.cur }; }
function pushUndo() {
  S.undo.push(snapshot());
  if (S.undo.length > 40) S.undo.shift();
  S.redo = [];
  S.dirty = true;
}
function restore(snap) {
  S.pages = snap.pages; S.cur = clamp(snap.cur, -1, S.pages.length - 1);
  S.dirty = true;
  S.sel = new Set(S.cur >= 0 ? [S.pages[S.cur].id] : []);
  resetToolState(); refresh();
}
function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); status('Desfeito.'); }
function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); status('Refeito.'); }

const curPage = () => S.pages[S.cur];

// ───────────────────────── DPI em ficheiros PNG/JPEG ─────────────────────────
function readDpi(bytes) {
  const b = bytes, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) { // PNG
    let p = 8;
    while (p + 8 < b.length) {
      const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
      if (type === 'pHYs' && b[p + 16] === 1) return Math.round(dv.getUint32(p + 8) * 0.0254);
      if (type === 'IDAT') break;
      p += 12 + len;
    }
  } else if (b[0] === 0xFF && b[1] === 0xD8) { // JPEG
    let p = 2;
    while (p + 4 < b.length && b[p] === 0xFF) {
      const m = b[p + 1], len = dv.getUint16(p + 2);
      if (m === 0xE0 && b[p + 4] === 0x4A && b[p + 5] === 0x46) { // JFIF
        const unit = b[p + 11], x = dv.getUint16(p + 12);
        if (unit === 1 && x > 1) return x;
        if (unit === 2 && x > 1) return Math.round(x * 2.54);
      }
      if (m === 0xDA) break;
      p += 2 + len;
    }
  }
  return 0;
}
// JPEG: orientação EXIF e tamanho gravado no ficheiro (antes de rodar)
function jpegInfo(b) {
  const r = { orient: 1, w: 0, h: 0 };
  if (b[0] !== 0xFF || b[1] !== 0xD8) return r;
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let p = 2;
    while (p + 9 < b.length && b[p] === 0xFF) {
      const m = b[p + 1], len = dv.getUint16(p + 2);
      if (m === 0xE1 && dv.getUint32(p + 4) === 0x45786966) { // "Exif"
        const t = p + 10, le = dv.getUint16(t) === 0x4949, ifd = dv.getUint32(t + 4, le), n = dv.getUint16(t + ifd, le);
        for (let i = 0; i < n; i++) { const e = t + ifd + 2 + i * 12; if (dv.getUint16(e, le) === 0x0112) r.orient = dv.getUint16(e + 8, le); }
      }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { r.h = dv.getUint16(p + 5); r.w = dv.getUint16(p + 7); break; }
      if (m === 0xDA) break;
      p += 2 + len;
    }
  } catch (e) { /* EXIF estragado: fica como está */ }
  return r;
}
// Aplica a orientação EXIF à mão (só quando o motor do browser não a aplica)
function orientCanvas(src, o) {
  const w = src.width, h = src.height, c = canvas(o >= 5 ? h : w, o >= 5 ? w : h), x = ctx2d(c);
  const T = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, h, 0], 7: [0, -1, -1, 0, h, w], 8: [0, -1, 1, 0, 0, w] }[o];
  if (T) x.transform(...T);
  x.drawImage(src, 0, 0);
  return c;
}
let exifManual = false; // passa a true se o browser ignorar a orientação EXIF
async function fixOrientation(blob, info) {
  if (info.orient < 2 || info.orient > 8) return blob;
  if (!exifManual && info.orient >= 5 && info.w && info.w !== info.h) {
    const bmp = await createImageBitmap(blob);
    exifManual = bmp.width === info.w; bmp.close();
  }
  if (!exifManual) return blob;
  const bmp = await createImageBitmap(blob, { imageOrientation: 'none' });
  const c = orientCanvas(bmp, info.orient); bmp.close();
  const out = await toBlob(c, 'image/jpeg', 0.95); c.width = c.height = 0;
  return out;
}
// HEIC/HEIF (fotos do iPhone) → JPEG
async function heicToJpeg(bytes) {
  const { lh } = await loadHeif();
  const imgs = new lh.HeifDecoder().decode(bytes);
  if (!imgs || !imgs.length) throw new Error('o ficheiro HEIC não tem imagens');
  const im = imgs.find((i) => i.is_primary()) || imgs[0], w = im.get_width(), h = im.get_height();
  const c = canvas(w, h), x = ctx2d(c), id = x.createImageData(w, h);
  try {
    await new Promise((res, rej) => im.display(id, (d) => (d ? res() : rej(new Error('falha a descodificar o HEIC')))));
  } finally { imgs.forEach((i) => i.free()); }
  x.putImageData(id, 0, 0);
  const blob = await toBlob(c, 'image/jpeg', 0.95); c.width = c.height = 0;
  return blob;
}
const CRC =(() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b, s, e) { let c = 0xFFFFFFFF; for (let i = s; i < e; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function setPngDpi(bytes, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const ch = new Uint8Array(21), dv = new DataView(ch.buffer);
  dv.setUint32(0, 9); ch.set([0x70, 0x48, 0x59, 0x73], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); ch[16] = 1;
  dv.setUint32(17, crc32(ch, 4, 17));
  const out = new Uint8Array(bytes.length + 21);
  out.set(bytes.subarray(0, 33)); out.set(ch, 33); out.set(bytes.subarray(33), 54);
  return out;
}
function setJpegDpi(bytes, dpi) {
  if (bytes[2] === 0xFF && bytes[3] === 0xE0 && bytes[6] === 0x4A && bytes[7] === 0x46) {
    const d = Math.round(dpi);
    bytes[13] = 1; bytes[14] = d >> 8; bytes[15] = d & 255; bytes[16] = d >> 8; bytes[17] = d & 255;
  }
  return bytes;
}

// ───────────────────────── miniaturas e cache de visualização ─────────────────────────
const cache = new Map();   // id -> { bmp, w, h }
const pending = new Map(); // id -> Promise
function cachePut(id, v) {
  cache.delete(id); cache.set(id, v);
  while (cache.size > 8) {
    const k = cache.keys().next().value;
    const old = cache.get(k); cache.delete(k);
    if (old.bmp && old.bmp.close) old.bmp.close();
  }
}
function getDisplay(p) {
  if (!p) return null;
  const c = cache.get(p.id);
  if (c) { cache.delete(p.id); cache.set(p.id, c); return c; }
  if (!pending.has(p.id)) {
    const pr = loadDisplay(p).then((v) => { cachePut(p.id, v); pending.delete(p.id); draw(); return v; })
      .catch((e) => { pending.delete(p.id); status('Erro a mostrar a página: ' + e.message, 'err'); });
    pending.set(p.id, pr);
  }
  return null;
}
async function displayAsync(p) {
  const c = getDisplay(p);
  if (c) return c;
  await pending.get(p.id);
  return cache.get(p.id) || (await loadDisplay(p));
}
async function loadDisplay(p) {
  if (p.kind === 'img') {
    const bmp = await createImageBitmap(p.blob);
    return { bmp, w: bmp.width, h: bmp.height };
  }
  const d = pageDims(p);
  const scale = Math.min(3000 / Math.max(d.w, d.h), 6);
  const c = await renderPdf(p, scale);
  return { bmp: c, w: c.width, h: c.height };
}
async function makeThumb(src, w, h) {
  const k = 200 / Math.max(w, h);
  const c = canvas(w * k, h * k), x = ctx2d(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(src, 0, 0, c.width, c.height);
  return URL.createObjectURL(await toBlob(c, 'image/jpeg', 0.8));
}

// ───────────────────────── PDF: geometria ─────────────────────────
// Recorte guardado em coordenadas normalizadas da página NÃO rodada (u para a direita, v para baixo).
function fwd(u, v, T) { // não rodada -> mostrada (rotação T no sentido horário)
  switch (T) { case 90: return [1 - v, u]; case 180: return [1 - u, 1 - v]; case 270: return [v, 1 - u]; default: return [u, v]; }
}
function inv(x, y, T) { // mostrada -> não rodada
  switch (T) { case 90: return [y, 1 - x]; case 180: return [1 - x, 1 - y]; case 270: return [1 - y, x]; default: return [x, y]; }
}
function rectMap(r, f, T) {
  const a = f(r.x0, r.y0, T), b = f(r.x1, r.y1, T);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}
const totalRot = (p) => ((p.baseRot + p.rot) % 360 + 360) % 360;
// Dimensões mostradas, em pontos (PDF) ou píxeis (imagem)
function pageDims(p) {
  if (p.kind === 'img') return { w: p.w, h: p.h };
  const c = p.crop || { x0: 0, y0: 0, x1: 1, y1: 1 };
  let w = (c.x1 - c.x0) * p.wPt, h = (c.y1 - c.y0) * p.hPt;
  const T = totalRot(p);
  if (T === 90 || T === 270) [w, h] = [h, w];
  return { w, h };
}
function pageSizePts(p) {
  if (p.kind === 'img') return { w: p.w / p.dpi * 72, h: p.h / p.dpi * 72 };
  return pageDims(p);
}
async function renderPdf(p, scale) {
  const src = S.src.get(p.src);
  const page = await src.doc.getPage(p.index + 1);
  const T = totalRot(p);
  const full = page.getViewport({ scale: 1, rotation: T });
  // limite de tamanho do canvas
  const maxSide = 14000, maxArea = 120e6;
  scale = Math.min(scale, maxSide / Math.max(full.width, full.height), Math.sqrt(maxArea / (full.width * full.height)));
  const vp = page.getViewport({ scale, rotation: T });
  const c = canvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const x = ctx2d(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: vp }).promise;
  if (!p.crop) return c;
  const r = rectMap(p.crop, fwd, T);
  const sx = Math.round(r.x0 * c.width), sy = Math.round(r.y0 * c.height);
  const sw = Math.max(1, Math.round((r.x1 - r.x0) * c.width)), sh = Math.max(1, Math.round((r.y1 - r.y0) * c.height));
  const o = canvas(sw, sh);
  ctx2d(o).drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
  c.width = c.height = 0;
  return o;
}

// ───────────────────────── criar páginas ─────────────────────────
async function imgPageFromBlob(blob, dpi) {
  let bmp = await createImageBitmap(blob);
  if (!/png|jpeg/.test(blob.type)) { // BMP/GIF/WEBP -> PNG
    const c = canvas(bmp.width, bmp.height); ctx2d(c).drawImage(bmp, 0, 0);
    blob = await toBlob(c, 'image/png'); c.width = c.height = 0;
  }
  if (!dpi || dpi < 10) dpi = Math.max(72, Math.round(bmp.width / (210 / 25.4))); // sem DPI: assume largura A4
  const p = { kind: 'img', id: uid(), blob, w: bmp.width, h: bmp.height, dpi };
  p.thumb = await makeThumb(bmp, bmp.width, bmp.height);
  cachePut(p.id, { bmp, w: bmp.width, h: bmp.height });
  return p;
}
async function imgPageFromCanvas(c, dpi, from) {
  const blob = await toBlob(c, 'image/png');
  const p = { kind: 'img', id: uid(), blob, w: c.width, h: c.height, dpi, name: from && from.name };
  p.thumb = await makeThumb(c, c.width, c.height);
  const bmp = await createImageBitmap(c);
  cachePut(p.id, { bmp, w: bmp.width, h: bmp.height });
  return p;
}
async function pdfThumb(p) {
  const d = pageDims(p);
  const c = await renderPdf(p, 220 / Math.max(d.w, d.h));
  return makeThumb(c, c.width, c.height);
}
async function withPdf(p, changes) {
  const n = Object.assign({}, p, changes, { id: uid() });
  n.thumb = await pdfThumb(n);
  return n;
}

async function loadPdfFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = uid();
  let lib = null, why = '';
  try { lib = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { why = /encrypt/i.test(e.message) ? 'PDF protegido' : 'estrutura não suportada'; }
  const task = pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/' });
  task.onPassword = (update) => {
    const pw = prompt('O ficheiro "' + file.name + '" tem palavra-passe:');
    if (pw === null) task.destroy(); else update(pw);
  };
  const doc = await task.promise;
  S.src.set(key, { name: file.name, bytes, doc, lib });
  const out = [];
  for (let i = 0; i < doc.numPages; i++) {
    busyMsg(`${file.name}: página ${i + 1} de ${doc.numPages}…`);
    const page = await doc.getPage(i + 1);
    const vp = page.getViewport({ scale: 1, rotation: 0 });
    const p = { kind: 'pdf', id: uid(), src: key, index: i, baseRot: page.rotate || 0, rot: 0, crop: null, wPt: vp.width, hPt: vp.height, name: file.name };
    p.thumb = await pdfThumb(p);
    out.push(p);
  }
  if (!lib) status(`${file.name}: ${why} — as páginas vão ser exportadas como imagem.`, 'err');
  return out;
}

function insertPages(newPages, replaceIdx) {
  if (!newPages.length) return;
  pushUndo();
  let at;
  if (replaceIdx !== undefined && replaceIdx >= 0) {
    S.pages.splice(replaceIdx, 1, ...newPages); at = replaceIdx + newPages.length - 1;
  } else {
    const pos = S.cur >= 0 ? S.cur + 1 : S.pages.length;
    S.pages.splice(pos, 0, ...newPages); at = pos + newPages.length - 1;
  }
  S.cur = at; S.sel = new Set([S.pages[at].id]);
  resetToolState(); S.zoomF = 1; S.panX = S.panY = 0;
  refresh();
}

async function addFiles(files) {
  const isHeic = (f) => /\.(heic|heif)$/i.test(f.name) || /heic|heif/.test(f.type);
  files = [...files].filter((f) => /\.(pdf|png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(f.name) || /pdf|image/.test(f.type));
  if (!files.length) { status('Formato não suportado. Usa PDF, PNG, JPEG, HEIC, WEBP, GIF ou BMP.', 'err'); return; }
  busy('A abrir ficheiros…');
  const added = [], photoIdx = [];
  let photos = 0, straight = 0;
  try {
    for (const f of files) {
      busyMsg('A abrir ' + f.name + '…');
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { added.push(...(await loadPdfFile(f))); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      let blob, dpi = readDpi(bytes), photo = false;
      if (isHeic(f)) { busyMsg('A converter ' + f.name + ' (HEIC)…'); blob = await heicToJpeg(bytes); dpi = 0; photo = true; }
      else {
        blob = new Blob([bytes], { type: f.type || 'image/png' });
        const info = jpegInfo(bytes);
        if (info.w) { // JPEG
          blob = await fixOrientation(blob, info);
          if (dpi <= 72) { dpi = 0; photo = true; } // fotos de telefone: 72 ppp ou nada
        }
      }
      const p = await imgPageFromBlob(blob, dpi);
      p.name = f.name;
      if (photo) { photos++; photoIdx.push(added.length); }
      added.push(p);
    }
    if (photoIdx.length && $('photoAuto').checked) { // várias fotos ao mesmo tempo, uma por núcleo
      let done = 0;
      const cores = await setPoolFor(photoIdx.map((k) => added[k]));
      busyMsg(`A endireitar ${photoIdx.length} foto(s), ${cores} em paralelo…`);
      await Promise.all(photoIdx.map(async (k) => {
        try { const n = await autoPhoto(added[k]); if (n) { added[k] = n; straight++; } } catch (e) { /* fica como estava */ }
        busyMsg(`A endireitar fotos: ${++done} de ${photoIdx.length} (${pool.size} em paralelo)…`);
      }));
    }
    insertPages(added);
    let msg = `${added.length} página(s) adicionada(s).`;
    if (photos && $('photoAuto').checked) msg += ` Fotos endireitadas: ${straight} de ${photos}` + (straight < photos ? ' (as restantes ficaram como estavam, por falta de confiança na deteção: usa “Foto → página”, tecla P).' : '.');
    else if (photos) msg += ' Para endireitar uma foto e pô-la no tamanho real, usa “Foto → página” (tecla P).';
    status(msg, 'ok');
  } catch (e) {
    if (added.length) insertPages(added);
    status('Erro a abrir: ' + e.message, 'err');
  } finally { idle(); }
}

// ───────────────────────── digitalização ─────────────────────────
function scanOpts(ui) {
  return {
    device: $('dev').value, source: $('src').value, mode: +$('mode').value, dpi: +$('dpiIn').value,
    area: $('area').value, brightness: +$('bright').value, contrast: +$('contrast').value, ui: !!ui,
  };
}
async function loadDevices() {
  const sel = $('dev'), keep = sel.value || settings.dev;
  sel.innerHTML = '';
  try {
    const r = await api('devices');
    if (r.error) throw new Error(r.error);
    const devs = (r.devices || []).sort((a, b) => (a.type === 1 ? 0 : 1) - (b.type === 1 ? 0 : 1));
    if (!devs.length) {
      sel.add(new Option('(nenhum scanner encontrado)', ''));
      status('O Windows não vê nenhum scanner WIA. Experimenta “Digitalizar com janela do driver”.', 'err');
      return;
    }
    for (const d of devs) sel.add(new Option(d.name + (d.type !== 1 ? ' [não é scanner]' : ''), d.id));
    if (keep && devs.some((d) => d.id === keep)) sel.value = keep;
    status(devs.length + ' dispositivo(s) encontrado(s).', 'ok');
  } catch (e) {
    sel.add(new Option('(erro)', ''));
    status('Erro ao procurar scanners: ' + e.message, 'err');
  }
}
async function doScan({ ui = false, replace = false } = {}) {
  if (replace && S.cur < 0) return;
  if (!ui && !$('dev').value) { await loadDevices(); if (!$('dev').value) return; }
  saveSettings();
  busy(ui ? 'A abrir a janela do driver…' : 'A digitalizar…');
  try {
    const r = await api('scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scanOpts(ui)) });
    if (r.error) {
      status(r.error, r.code === '80210064' ? '' : 'err');
      return;
    }
    const pages = [];
    for (const pg of r.pages || []) {
      busyMsg(`A receber página ${pages.length + 1}…`);
      const res = await fetch('/api/img/' + pg.id + '?t=' + TOKEN);
      const blob = await res.blob();
      fetch('/api/img/' + pg.id + '?t=' + TOKEN, { method: 'DELETE' });
      const p = await imgPageFromBlob(new Blob([blob], { type: pg.mime }), pg.dpi);
      p.name = 'Digitalização';
      pages.push(p);
    }
    insertPages(pages, replace ? S.cur : undefined);
    const d = pages[0] ? Math.round(pages[0].dpi) : '';
    status(`${pages.length} página(s) digitalizada(s)${d ? ' a ' + d + ' ppp' : ''}. Total: ${S.pages.length}.` + (r.warning ? ' Aviso: ' + r.warning : ''), 'ok');
  } catch (e) {
    status('Erro na digitalização: ' + e.message, 'err');
  } finally { idle(); }
}

// ───────────────────────── operações de imagem ─────────────────────────
async function pageCanvas(p) { // canvas em resolução total (página imagem)
  const bmp = await createImageBitmap(p.blob);
  const c = canvas(bmp.width, bmp.height);
  // em memória normal, não na GPU: os pixels vão ser lidos (níveis, workers) e assim não há cópia de volta da placa
  ctx2d(c, { willReadFrequently: true }).drawImage(bmp, 0, 0); bmp.close();
  return c;
}
function rotateCanvas(src, deg) {
  const r = deg * Math.PI / 180, cs = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
  const w = src.width, h = src.height;
  const c = canvas(w * cs + h * sn, w * sn + h * cs), x = ctx2d(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2); x.rotate(r);
  x.drawImage(src, -w / 2, -h / 2);
  return c;
}
function rotate90Canvas(src, cw) {
  const c = canvas(src.height, src.width), x = ctx2d(c);
  x.translate(c.width / 2, c.height / 2); x.rotate(cw ? Math.PI / 2 : -Math.PI / 2);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}
function cropCanvas(src, r) {
  const c = canvas(r.w, r.h);
  ctx2d(c).drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}
function levelsCanvas(c, white, black) {
  const x = c.getContext('2d', { willReadFrequently: true });
  const id = x.getImageData(0, 0, c.width, c.height), d = id.data;
  const lut = [0, 1, 2].map((ch) => {
    const lo = black[ch], hi = Math.max(lo + 1, white[ch]), t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) t[v] = (v - lo) * 255 / (hi - lo);
    return t;
  });
  const L0 = lut[0], L1 = lut[1], L2 = lut[2];
  for (let i = 0; i < d.length; i += 4) { d[i] = L0[d[i]]; d[i + 1] = L1[d[i + 1]]; d[i + 2] = L2[d[i + 2]]; }
  x.putImageData(id, 0, 0);
  return c;
}
function sampleCanvas(c, cx, cy, rad) {
  const x0 = clamp(Math.round(cx - rad), 0, c.width - 1), y0 = clamp(Math.round(cy - rad), 0, c.height - 1);
  const w = clamp(Math.round(rad * 2 + 1), 1, c.width - x0), h = clamp(Math.round(rad * 2 + 1), 1, c.height - y0);
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return [r / n, g / n, b / n];
}
function autoLevelsFor(c) {
  const k = Math.min(1, 900 / Math.max(c.width, c.height));
  const s = canvas(c.width * k, c.height * k), x = ctx2d(s, { willReadFrequently: true });
  x.drawImage(c, 0, 0, s.width, s.height);
  const d = x.getImageData(0, 0, s.width, s.height).data, n = d.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
  let acc = 0, hiT = 255, loT = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hiT = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.005) { loT = v; break; } }
  const W = [0, 0, 0], B = [0, 0, 0]; let nw = 0, nb = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    if (l >= hiT) { W[0] += d[i]; W[1] += d[i + 1]; W[2] += d[i + 2]; nw++; }
    if (l <= loT) { B[0] += d[i]; B[1] += d[i + 1]; B[2] += d[i + 2]; nb++; }
  }
  const white = W.map((v) => (nw ? v / nw : 255));
  let black = B.map((v) => (nb ? v / nb : 0));
  if ((black[0] + black[1] + black[2]) / 3 > 110) black = [0, 0, 0];
  return { white, black };
}

// Converte uma página PDF em imagem (para ângulo livre / níveis)
async function rasterize(p, silent) {
  if (p.kind === 'img') return p;
  const dpi = +$('rasterDpi').value || 300;
  if (!silent && !S.askedRaster) {
    S.askedRaster = true;
    if (!confirm(`Esta operação converte a página PDF numa imagem a ${dpi} ppp (o texto deixa de ser selecionável nessa página).\n\nContinuar?`)) return null;
  }
  const c = await renderPdf(p, dpi / 72);
  const n = await imgPageFromCanvas(c, dpi, p);
  c.width = c.height = 0;
  return n;
}

// Aplica uma transformação de canvas à página atual (ou a uma lista)
async function editPages(idxs, label, fn, opts = {}) {
  if (!idxs.length) return;
  busy(label + '…');
  try {
    const results = [];
    for (let k = 0; k < idxs.length; k++) {
      if (idxs.length > 1) busyMsg(`${label}: página ${k + 1} de ${idxs.length}…`);
      let p = S.pages[idxs[k]];
      if (p.kind === 'pdf' && opts.pdfFn) { results.push(await opts.pdfFn(p)); continue; }
      p = await rasterize(p, k > 0);
      if (!p) { idle(); return; }
      const c = await pageCanvas(p);
      const out = await fn(c, p);
      if (!out) { results.push(null); continue; }
      results.push(await imgPageFromCanvas(out, out.dpi || p.dpi, p)); // out.dpi: a operação muda a resolução
      if (out !== c) out.width = out.height = 0;
      c.width = c.height = 0;
      await nextFrame();
    }
    pushUndo();
    idxs.forEach((i, k) => { if (results[k]) S.pages[i] = results[k]; });
    S.sel = new Set(idxs.map((i) => S.pages[i].id));
    resetToolState(); refresh();
    status(label + ' — feito.', 'ok');
  } catch (e) {
    status(label + ': erro — ' + e.message, 'err');
  } finally { idle(); }
}
const selIdx = () => { const a = []; S.pages.forEach((p, i) => { if (S.sel.has(p.id)) a.push(i); }); return a.length ? a : (S.cur >= 0 ? [S.cur] : []); };

function rotate90(cw) {
  editPages(selIdx(), cw ? 'Rodar 90° à direita' : 'Rodar 90° à esquerda', (c) => rotate90Canvas(c, cw),
    { pdfFn: (p) => withPdf(p, { rot: (p.rot + (cw ? 90 : 270)) % 360 }) });
}
function rotateAngle(deg) {
  if (Math.abs(deg) < 0.01) return;
  editPages([S.cur], `Rodar ${deg.toFixed(1)}°`, (c) => rotateCanvas(c, deg));
}
function applyCrop() {
  const p = curPage(), r = S.crop, disp = cache.get(p && p.id);
  if (!p || !r || !disp || r.w < 4 || r.h < 4) { status('Desenha primeiro a área a manter.', 'err'); return; }
  const nr = { x0: r.x / disp.w, y0: r.y / disp.h, x1: (r.x + r.w) / disp.w, y1: (r.y + r.h) / disp.h };
  editPages([S.cur], 'Recortar', (c) => cropCanvas(c, {
    x: Math.round(nr.x0 * c.width), y: Math.round(nr.y0 * c.height),
    w: Math.max(1, Math.round((nr.x1 - nr.x0) * c.width)), h: Math.max(1, Math.round((nr.y1 - nr.y0) * c.height)),
  }), {
    pdfFn: (pp) => {
      const T = totalRot(pp), rel = rectMap(nr, inv, T), c0 = pp.crop || { x0: 0, y0: 0, x1: 1, y1: 1 };
      const cw = c0.x1 - c0.x0, ch = c0.y1 - c0.y0;
      return withPdf(pp, { crop: { x0: c0.x0 + rel.x0 * cw, y0: c0.y0 + rel.y0 * ch, x1: c0.x0 + rel.x1 * cw, y1: c0.y0 + rel.y1 * ch } });
    },
  });
}
async function pickLevel(bx, by, kind) {
  const p = curPage(), disp = cache.get(p && p.id);
  if (!p || !disp) return;
  const nx = bx / disp.w, ny = by / disp.h;
  if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
  editPages([S.cur], kind === 'white' ? 'Ponto branco' : 'Ponto preto', (c) => {
    const rad = Math.max(2, Math.round(Math.max(c.width, c.height) / 600));
    const s = sampleCanvas(c, nx * c.width, ny * c.height, rad);
    const lum = (s[0] + s[1] + s[2]) / 3;
    if (kind === 'white') {
      if (lum < 60) { status('Essa zona é demasiado escura para ser o branco. Clica no papel.', 'err'); return null; }
      return levelsCanvas(c, s, [0, 0, 0]);
    }
    if (lum > 160) { status('Essa zona é demasiado clara para ser o preto. Clica no texto.', 'err'); return null; }
    return levelsCanvas(c, [255, 255, 255], s);
  });
}
function autoLevels() {
  editPages(selIdx(), 'Níveis automáticos', (c) => { const l = autoLevelsFor(c); return levelsCanvas(c, l.white, l.black); });
}

// ───────────────────────── foto → página ─────────────────────────
// S.photo = { id, busy } enquanto deteta; depois { id, det, mesh, W, H, edited }
const FMT_NAMES = { a3: 'A3', a4: 'A4', a5: 'A5', a6: 'A6', letter: 'Carta', legal: 'Ofício' };
const photoFmtArgs = () => [$('photoFmt').value, [+$('photoW').value || 210, +$('photoH').value || 297]];
// Formato, tamanho em mm, píxeis e ppp da página corrigida
function photoPlan(ph) { return Photo.planPage(ph.mesh, ph.W, ph.H, ...photoFmtArgs()); }
function photoInfoText(ph) {
  const pl = photoPlan(ph);
  const label = $('photoFmt').value === 'custom' ? 'medida própria'
    : pl.assumed ? 'proporção medida, largura assumida de 210 mm — escolhe o formato'
      : FMT_NAMES[pl.key] + (pl.auto ? ' (automático)' : '');
  return `${pl.mm[0].toFixed(0)} × ${pl.mm[1].toFixed(0)} mm (${label}) · ${pl.sz.w} × ${pl.sz.h} px · ${Math.round(pl.dpi)} ppp`;
}

async function startPhoto() {
  const p = curPage();
  if (!p || p.kind !== 'img') return;
  const id = p.id;
  S.photo = { id, busy: true };
  busy('A procurar a folha (resolução total)…');
  try {
    const W = p.w, H = p.h;
    pool.size = Math.max(pool.size, 1);
    const { det } = await poolRun(async () => {
      const c = await pageCanvas(p), px = pixelsOf(c); c.width = c.height = 0;
      return { msg: { op: 'detect', img: px.img }, transfer: px.transfer };
    });
    if (S.tool !== 'photo' || !curPage() || curPage().id !== id) return;
    S.photo = { id, det, mesh: Photo.buildMesh(det, +$('photoN').value), W, H, edited: false };
    const q = det.quality, why = q.why.length ? ': ' + q.why.join('; ') : '';
    status(q.level === 'alta' ? 'Folha encontrada (confiança alta). Enter para aplicar.'
      : q.level === 'média' ? `Confiança média${why}. Confirma os pontos e carrega em Enter.`
        : `Confiança baixa${why}. Ajusta os cantos à mão.`, q.level === 'baixa' ? 'err' : 'ok');
  } catch (e) {
    S.photo = null; setTool('pan');
    status('Foto → página: ' + e.message, 'err');
  } finally { idle(); updateToolPanel(); draw(); }
}
// Muda o número de pontos: sem edições, refaz a partir da deteção; com edições, reamostra a grelha atual
function regridPhoto(N) {
  const ph = S.photo;
  if (!ph || !ph.mesh || ph.mesh.N === N) return;
  if (!ph.edited) { ph.mesh = Photo.buildMesh(ph.det, N); return; }
  const map = Photo.meshMapper(ph.mesh), m = { N, corners: ph.mesh.corners.map((c) => c.slice()), res: new Float64Array(N * N * 2) };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = map(i / (N - 1), j / (N - 1)); Photo.moveNode(m, i, j, q[0], q[1]); }
  ph.mesh = m;
}
async function applyPhoto() {
  const ph = S.photo, p = curPage();
  if (!ph || !ph.mesh || !p || ph.id !== p.id) return;
  const { sz, dpi } = photoPlan(ph), mesh = ph.mesh;
  setTool('pan');
  await editPages([S.cur], 'Foto → página', async (c) => {
    const { data } = await poolRun(() => { const px = pixelsOf(c); return { msg: { op: 'warp', img: px.img, mesh, w: sz.w, h: sz.h }, transfer: px.transfer }; });
    return canvasFrom(data, sz.w, sz.h, dpi);
  });
}
// Ao adicionar fotos com "endireitar logo" (num worker): devolve a página corrigida, ou null se não encontrar a folha
// Lote: Foto → página num intervalo de páginas (imagens), várias ao mesmo tempo, uma por núcleo.
// As de confiança baixa ficam como estavam. Desfaz-se tudo de uma vez com Ctrl+Z.
function runBatch() {
  const n = S.pages.length, a = clamp(Math.round(+$('btFrom').value) || 1, 1, n), b = clamp(Math.round(+$('btTo').value) || n, 1, n);
  const idxs = [];
  for (let i = Math.min(a, b) - 1; i < Math.max(a, b); i++) idxs.push(i);
  batchPhoto(idxs);
}
async function batchPhoto(range) {
  const idxs = range.filter((i) => S.pages[i].kind === 'img');
  if (!idxs.length) { status('Nesse intervalo não há páginas de imagem (as páginas PDF já estão direitas).', 'err'); return; }
  setTool('pan');
  const results = new Map();
  let done = 0, failed = 0;
  busy('Foto → página: a preparar…');
  try {
    const cores = await setPoolFor(idxs.map((i) => S.pages[i]));
    busyMsg(`Foto → página: 0 de ${idxs.length} (${cores} em paralelo)…`);
    await Promise.all(idxs.map(async (i) => {
      try { const n = await autoPhoto(S.pages[i]); if (n) results.set(i, n); } catch (e) { failed++; }
      busyMsg(`Foto → página: ${++done} de ${idxs.length} (${pool.size} em paralelo)…`);
    }));
    if (results.size) {
      pushUndo();
      for (const [i, n] of results) S.pages[i] = n;
      S.sel = new Set(idxs.map((i) => S.pages[i].id));
      refresh();
    }
    const left = idxs.length - results.size;
    status(`Foto → página: ${results.size} de ${idxs.length} página(s) endireitada(s).` +
      (left ? ` ${left} ficaram como estavam (confiança baixa${failed ? ' ou erro' : ''}): usa P nessas.` : ''), results.size ? 'ok' : 'err');
  } finally { idle(); }
}
// Ajusta o número de workers à memória livre e à maior foto do lote; devolve esse número
async function setPoolFor(pages) {
  await refreshSys();
  const mpx = Math.max(12, ...pages.map((p) => (p.w * p.h) / 1e6));
  pool.size = Math.min(workersFor(mpx), pages.length);
  poolNext();
  return pool.size;
}
async function autoPhoto(p) {
  const [fmt, custom] = photoFmtArgs(), N = +$('photoN').value;
  const r = await poolRun(async () => {
    const c = await pageCanvas(p), px = pixelsOf(c); c.width = c.height = 0;
    return { msg: { op: 'auto', img: px.img, N, fmt, custom }, transfer: px.transfer };
  });
  if (!r.found) return null;
  const o = canvasFrom(r.data, r.plan.sz.w, r.plan.sz.h, r.plan.dpi);
  const n = await imgPageFromCanvas(o, r.plan.dpi, p);
  o.width = o.height = 0;
  return n;
}
function photoNodeAt(sx, sy) { // ponto da grelha perto do rato (coordenadas do ecrã)
  const ph = S.photo, v = S.vt;
  if (!ph || !ph.mesh || !v) return null;
  const N = ph.mesh.N;
  let best = null;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const q = Photo.meshNode(ph.mesh, i, j), d = Math.hypot(v.ox + q[0] * v.s - sx, v.oy + q[1] * v.s - sy);
    if (d < 12 && (!best || d < best.d)) best = { i, j, d };
  }
  return best;
}

// ───────────────────────── páginas: navegar / apagar / mover ─────────────────────────
function go(i) {
  if (!S.pages.length) return;
  S.cur = clamp(i, 0, S.pages.length - 1);
  S.sel = new Set([S.pages[S.cur].id]);
  resetToolState(); S.zoomF = 1; S.panX = S.panY = 0;
  refresh();
}
function deleteSel() {
  const idx = selIdx(); if (!idx.length) return;
  if (idx.length > 1 && !confirm(`Apagar ${idx.length} páginas?`)) return;
  pushUndo();
  const ids = new Set(idx.map((i) => S.pages[i].id));
  S.pages = S.pages.filter((p) => !ids.has(p.id));
  S.cur = clamp(idx[0], -1, S.pages.length - 1);
  if (S.pages.length && S.cur < 0) S.cur = 0;
  S.sel = new Set(S.cur >= 0 ? [S.pages[S.cur].id] : []);
  resetToolState(); refresh();
  status(`${idx.length} página(s) apagada(s). Ctrl+Z para desfazer.`);
}
function duplicate() {
  const p = curPage(); if (!p) return;
  const n = Object.assign({}, p, { id: uid() });
  insertPages([n]);
}
function moveSelTo(targetIdx) { // insere as selecionadas antes de targetIdx
  const idx = selIdx(); if (!idx.length) return;
  const ids = new Set(idx.map((i) => S.pages[i].id));
  const moving = S.pages.filter((p) => ids.has(p.id));
  const before = S.pages.slice(0, targetIdx).filter((p) => !ids.has(p.id)).length;
  const rest = S.pages.filter((p) => !ids.has(p.id));
  pushUndo();
  rest.splice(before, 0, ...moving);
  S.pages = rest;
  S.cur = S.pages.indexOf(moving[moving.length - 1]);
  refresh();
}
function newDoc() {
  if (!S.pages.length) return;
  if (S.dirty && !confirm('Começar um documento novo? As páginas atuais saem da lista (podes desfazer com Ctrl+Z).')) return;
  pushUndo();
  S.pages = []; S.cur = -1; S.sel.clear(); S.dirty = false;
  refresh();
}

// ───────────────────────── miniaturas (lista lateral) ─────────────────────────
let dragFrom = null;
function renderThumbs() {
  const L = $('thumbList');
  L.innerHTML = '';
  S.pages.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'th' + (i === S.cur ? ' cur' : '') + (S.sel.has(p.id) ? ' sel' : '');
    d.draggable = true; d.dataset.i = i;
    const img = document.createElement('img'); img.src = p.thumb || ''; d.appendChild(img);
    const n = document.createElement('div'); n.className = 'n'; n.textContent = (i + 1) + (p.name ? ' · ' + p.name : ''); d.appendChild(n);
    if (p.kind === 'pdf') { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'PDF'; b.title = 'Página PDF original (vetorial)'; d.appendChild(b); }
    d.onclick = (e) => {
      if (e.ctrlKey) { S.sel.has(p.id) ? S.sel.delete(p.id) : S.sel.add(p.id); S.cur = i; if (!S.sel.size) S.sel.add(p.id); }
      else if (e.shiftKey && S.cur >= 0) { const [a, b] = [Math.min(S.cur, i), Math.max(S.cur, i)]; S.sel = new Set(S.pages.slice(a, b + 1).map((x) => x.id)); S.cur = i; }
      else { S.sel = new Set([p.id]); S.cur = i; S.zoomF = 1; S.panX = S.panY = 0; }
      resetToolState(); refresh(false);
    };
    d.ondragstart = (e) => {
      if (!S.sel.has(p.id)) { S.sel = new Set([p.id]); S.cur = i; }
      dragFrom = i; d.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-page', String(i));
    };
    d.ondragend = () => { dragFrom = null; d.classList.remove('dragging'); clearDropMarks(); };
    d.ondragover = (e) => {
      if (dragFrom === null) return;
      e.preventDefault(); e.stopPropagation();
      const r = d.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      clearDropMarks(); d.classList.add(after ? 'drop-after' : 'drop-before');
    };
    d.ondrop = (e) => {
      if (dragFrom === null) return;
      e.preventDefault(); e.stopPropagation();
      const r = d.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      clearDropMarks(); moveSelTo(i + (after ? 1 : 0)); dragFrom = null;
    };
    L.appendChild(d);
  });
  const cur = L.querySelector('.th.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  $('pageCount').textContent = S.pages.length;
}
function clearDropMarks() { document.querySelectorAll('.drop-before,.drop-after').forEach((e) => e.classList.remove('drop-before', 'drop-after')); }

// ───────────────────────── visualizador ─────────────────────────
const view = $('view');
function slots() {
  const W = view.clientWidth, H = view.clientHeight, out = [];
  if (S.dual && S.cur > 0) {
    out.push({ p: S.pages[S.cur - 1], x: 0, y: 0, w: W / 2, h: H, label: 'Página ' + S.cur + ' (anterior)', prev: true });
    out.push({ p: S.pages[S.cur], x: W / 2, y: 0, w: W / 2, h: H, label: 'Página ' + (S.cur + 1) + ' (atual)' });
  } else if (S.cur >= 0) out.push({ p: S.pages[S.cur], x: 0, y: 0, w: W, h: H, label: S.dual ? 'Página ' + (S.cur + 1) : '' });
  return out;
}
function draw() {
  const dpr = window.devicePixelRatio || 1;
  const W = view.clientWidth, H = view.clientHeight;
  if (view.width !== Math.round(W * dpr) || view.height !== Math.round(H * dpr)) { view.width = Math.round(W * dpr); view.height = Math.round(H * dpr); }
  const x = view.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, W, H);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  $('empty').classList.toggle('hidden', S.pages.length > 0);
  S.vt = null;
  for (const s of slots()) {
    const d = getDisplay(s.p);
    const padT = s.label ? 28 : 14, padS = 14;
    if (s.label) { x.fillStyle = s.prev ? '#7f8896' : '#cfe0ff'; x.font = '12px Segoe UI, sans-serif'; x.textAlign = 'center'; x.fillText(s.label, s.x + s.w / 2, 18); }
    if (!d) { x.fillStyle = '#7f8896'; x.textAlign = 'center'; x.font = '14px Segoe UI'; x.fillText('A carregar…', s.x + s.w / 2, s.y + s.h / 2); continue; }
    const fit = Math.min((s.w - 2 * padS) / d.w, (s.h - padT - padS) / d.h);
    const sc = fit * (s.prev ? 1 : S.zoomF);
    const ox = s.x + s.w / 2 - (d.w * sc) / 2 + (s.prev ? 0 : S.panX);
    const oy = s.y + padT + (s.h - padT - padS) / 2 - (d.h * sc) / 2 + (s.prev ? 0 : S.panY);
    x.save();
    x.beginPath(); x.rect(s.x, s.y, s.w, s.h); x.clip();
    if (s.prev) x.globalAlpha = 0.8;
    if (!s.prev && S.tool === 'angle' && S.angle) {
      x.translate(ox + d.w * sc / 2, oy + d.h * sc / 2); x.rotate(S.angle * Math.PI / 180);
      x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 10;
      x.drawImage(d.bmp, -d.w * sc / 2, -d.h * sc / 2, d.w * sc, d.h * sc);
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 10;
      x.drawImage(d.bmp, ox, oy, d.w * sc, d.h * sc);
    }
    x.restore();
    if (!s.prev) {
      S.vt = { ox, oy, s: sc, w: d.w, h: d.h, slot: s, bmp: d.bmp };
      drawOverlay(x, s);
    }
  }
  $('zoomLbl').textContent = Math.round(S.zoomF * 100) + '%';
}
function drawOverlay(x, slot) {
  const v = S.vt;
  if (S.tool === 'angle') { // grelha para alinhar
    x.save(); x.beginPath(); x.rect(slot.x, slot.y, slot.w, slot.h); x.clip();
    x.strokeStyle = 'rgba(80,160,255,.45)'; x.lineWidth = 1;
    for (let gx = slot.x + 20; gx < slot.x + slot.w; gx += 40) { x.beginPath(); x.moveTo(gx + .5, slot.y); x.lineTo(gx + .5, slot.y + slot.h); x.stroke(); }
    for (let gy = slot.y + 20; gy < slot.y + slot.h; gy += 40) { x.beginPath(); x.moveTo(slot.x, gy + .5); x.lineTo(slot.x + slot.w, gy + .5); x.stroke(); }
    x.restore();
  }
  if (S.tool === 'crop' && S.crop) {
    const r = S.crop, rx = v.ox + r.x * v.s, ry = v.oy + r.y * v.s, rw = r.w * v.s, rh = r.h * v.s;
    x.save();
    x.fillStyle = 'rgba(0,0,0,.55)';
    x.beginPath(); x.rect(v.ox, v.oy, v.w * v.s, v.h * v.s); x.rect(rx, ry, rw, rh); x.fill('evenodd');
    x.strokeStyle = '#5b93f5'; x.lineWidth = 2; x.strokeRect(rx, ry, rw, rh);
    x.fillStyle = '#fff';
    for (const [hx, hy] of handlePts(rx, ry, rw, rh)) { x.fillRect(hx - 4, hy - 4, 8, 8); x.strokeRect(hx - 4, hy - 4, 8, 8); }
    x.fillStyle = '#cfe0ff'; x.font = '12px Segoe UI'; x.textAlign = 'left';
    const p = curPage();
    if (p) {
      const k = p.kind === 'img' ? 25.4 / p.dpi : (pageSizePts(p).w / v.w) * 25.4 / 72;
      x.fillText(`${(r.w * k).toFixed(0)} × ${(r.h * k).toFixed(0)} mm`, rx + 4, ry - 6);
    }
    x.restore();
  }
  if (S.tool === 'photo' && S.photo && S.photo.mesh) drawPhotoGrid(x, slot);
  if (S.tool === 'line' && S.line) {
    const l = S.line;
    x.save(); x.strokeStyle = '#ffcc33'; x.lineWidth = 2; x.setLineDash([6, 4]);
    x.beginPath(); x.moveTo(v.ox + l.x0 * v.s, v.oy + l.y0 * v.s); x.lineTo(v.ox + l.x1 * v.s, v.oy + l.y1 * v.s); x.stroke();
    x.restore();
  }
}
function drawPhotoGrid(x, slot) {
  const v = S.vt, m = S.photo.mesh, N = m.N, map = Photo.meshMapper(m);
  const sc = (q) => [v.ox + q[0] * v.s, v.oy + q[1] * v.s];
  const K = 48, line = (f) => { const q0 = sc(f(0)); x.moveTo(q0[0], q0[1]); for (let k = 1; k <= K; k++) { const q = sc(f(k / K)); x.lineTo(q[0], q[1]); } };
  x.save(); x.beginPath(); x.rect(slot.x, slot.y, slot.w, slot.h); x.clip();
  // escurece o que fica fora da folha
  x.beginPath(); x.rect(slot.x, slot.y, slot.w, slot.h);
  const outline = [];
  for (let k = 0; k < K; k++) outline.push(map(k / K, 0));
  for (let k = 0; k < K; k++) outline.push(map(1, k / K));
  for (let k = K; k > 0; k--) outline.push(map(k / K, 1));
  for (let k = K; k > 0; k--) outline.push(map(0, k / K));
  outline.forEach((q, k) => { const s = sc(q); if (k) x.lineTo(s[0], s[1]); else x.moveTo(s[0], s[1]); });
  x.closePath(); x.fillStyle = 'rgba(0,0,0,.5)'; x.fill('evenodd');
  // linhas da grelha
  x.beginPath();
  for (let i = 1; i < N - 1; i++) { line((t) => map(i / (N - 1), t)); line((t) => map(t, i / (N - 1))); }
  x.strokeStyle = 'rgba(91,147,245,.75)'; x.lineWidth = 1; x.stroke();
  x.beginPath(); line((t) => map(t, 0)); line((t) => map(1, t)); line((t) => map(t, 1)); line((t) => map(0, t));
  x.strokeStyle = '#5b93f5'; x.lineWidth = 2; x.stroke();
  // análise: onde as linhas de texto foram medidas (verde)
  const ct = S.photo.det && S.photo.det.content;
  if (S.photoShow && ct && ct.samples) {
    const h = Photo.homography(S.photo.det.corners);
    x.fillStyle = ct.apply ? 'rgba(60,220,90,.9)' : 'rgba(255,200,60,.9)';
    for (const [u, vv] of ct.samples) { const s = sc(Photo.applyH(h, u, vv)); x.fillRect(s[0] - 2, s[1] - 2, 4, 4); }
  }
  // pontos
  const act = drag && drag.kind === 'node' ? drag : null;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const s = sc(Photo.meshNode(m, i, j)), corner = (i === 0 || i === N - 1) && (j === 0 || j === N - 1);
    x.beginPath(); x.arc(s[0], s[1], corner ? 7 : 5, 0, Math.PI * 2);
    x.fillStyle = act && act.i === i && act.j === j ? '#ffcc33' : '#fff'; x.fill();
    x.strokeStyle = '#2f6fe0'; x.lineWidth = 2; x.stroke();
  }
  // lupa enquanto se arrasta um ponto
  if (act && v.bmp) {
    const q = Photo.meshNode(m, act.i, act.j), R = 70, Z = 4, cx = slot.x + 16 + R, cy = slot.y + 16 + R;
    x.save(); x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.clip();
    x.fillStyle = '#000'; x.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    const src = R / (v.s * Z); // meia largura da zona da foto mostrada (px da foto)
    x.drawImage(v.bmp, q[0] - src, q[1] - src, 2 * src, 2 * src, cx - R, cy - R, 2 * R, 2 * R);
    x.strokeStyle = '#ffcc33'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
    x.restore();
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.strokeStyle = '#5b93f5'; x.lineWidth = 2; x.stroke();
  }
  x.restore();
}
function handlePts(x, y, w, h) {
  return [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
}
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function toBmp(e) {
  const r = view.getBoundingClientRect(), v = S.vt;
  if (!v) return null;
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  return { x: (sx - v.ox) / v.s, y: (sy - v.oy) / v.s, sx, sy, inSlot: sx >= v.slot.x && sx <= v.slot.x + v.slot.w };
}

let drag = null;
view.addEventListener('mousedown', (e) => {
  const b = toBmp(e); if (!b || !b.inSlot) {
    if (b && S.dual && S.cur > 0 && e.button === 0) go(S.cur - 1); // clicar na anterior abre-a
    return;
  }
  const v = S.vt;
  if (e.button === 0 && S.tool === 'photo') {
    const n = photoNodeAt(b.sx, b.sy);
    if (n) { drag = { kind: 'node', i: n.i, j: n.j }; draw(); return; }
  }
  if (e.button === 1 || S.tool === 'pan' || S.tool === 'photo') { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: S.panX, py: S.panY }; view.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (S.tool === 'crop') {
    const r = S.crop;
    if (r) {
      const pts = handlePts(v.ox + r.x * v.s, v.oy + r.y * v.s, r.w * v.s, r.h * v.s);
      const hi = pts.findIndex(([hx, hy]) => Math.abs(hx - b.sx) < 8 && Math.abs(hy - b.sy) < 8);
      if (hi >= 0) { drag = { kind: 'resize', h: HANDLES[hi], r0: Object.assign({}, r) }; return; }
      if (b.x > r.x && b.x < r.x + r.w && b.y > r.y && b.y < r.y + r.h) { drag = { kind: 'move', bx: b.x, by: b.y, r0: Object.assign({}, r) }; return; }
    }
    drag = { kind: 'new', bx: clamp(b.x, 0, v.w), by: clamp(b.y, 0, v.h) };
    S.crop = { x: drag.bx, y: drag.by, w: 0, h: 0 };
    return;
  }
  if (S.tool === 'line') { drag = { kind: 'line' }; S.line = { x0: b.x, y0: b.y, x1: b.x, y1: b.y }; return; }
  if (S.tool === 'white' || S.tool === 'black') { pickLevel(b.x, b.y, S.tool); return; }
  if (S.tool === 'angle') { drag = { kind: 'angle', sx: e.clientX, a0: S.angle }; }
});
window.addEventListener('mousemove', (e) => {
  if (!drag) { updateCursor(e); return; }
  const b = toBmp(e), v = S.vt; if (!b || !v) return;
  if (drag.kind === 'pan') { S.panX = drag.px + e.clientX - drag.sx; S.panY = drag.py + e.clientY - drag.sy; draw(); return; }
  if (drag.kind === 'new') {
    const x = clamp(b.x, 0, v.w), y = clamp(b.y, 0, v.h);
    S.crop = { x: Math.min(x, drag.bx), y: Math.min(y, drag.by), w: Math.abs(x - drag.bx), h: Math.abs(y - drag.by) };
  } else if (drag.kind === 'move') {
    const r = drag.r0;
    S.crop = { x: clamp(r.x + b.x - drag.bx, 0, v.w - r.w), y: clamp(r.y + b.y - drag.by, 0, v.h - r.h), w: r.w, h: r.h };
  } else if (drag.kind === 'resize') {
    let { x, y, w, h } = drag.r0, x1 = x + w, y1 = y + h;
    const bx = clamp(b.x, 0, v.w), by = clamp(b.y, 0, v.h);
    if (drag.h.includes('w')) x = Math.min(bx, x1 - 2);
    if (drag.h.includes('e')) x1 = Math.max(bx, x + 2);
    if (drag.h.includes('n')) y = Math.min(by, y1 - 2);
    if (drag.h.includes('s')) y1 = Math.max(by, y + 2);
    S.crop = { x, y, w: x1 - x, h: y1 - y };
  } else if (drag.kind === 'node') {
    if (!S.photo || !S.photo.mesh) return;
    Photo.moveNode(S.photo.mesh, drag.i, drag.j, clamp(b.x, 0, v.w), clamp(b.y, 0, v.h));
    S.photo.edited = true;
  } else if (drag.kind === 'line') {
    S.line.x1 = b.x; S.line.y1 = b.y;
  } else if (drag.kind === 'angle') {
    setAngle(drag.a0 + (e.clientX - drag.sx) / 20);
  }
  draw();
});
window.addEventListener('mouseup', () => {
  if (!drag) return;
  const k = drag.kind; drag = null; view.style.cursor = '';
  if (k === 'node') { draw(); if ($('phInfo') && S.photo && S.photo.mesh) $('phInfo').textContent = photoInfoText(S.photo); return; }
  if (k === 'line' && S.line) {
    const l = S.line, dx = l.x1 - l.x0, dy = l.y1 - l.y0;
    if (Math.hypot(dx, dy) * (S.vt ? S.vt.s : 1) < 20) { S.line = null; draw(); return; }
    let a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a > 90) a -= 180; if (a <= -90) a += 180;
    const rot = Math.abs(a) <= 45 ? -a : (a > 0 ? 90 : -90) - a;
    S.line = null;
    if (Math.abs(rot) < 0.05) { status('A linha já está direita.'); draw(); return; }
    rotateAngle(rot);
  }
});
function updateCursor(e) {
  const b = toBmp(e);
  let c = '';
  if (b && b.inSlot) {
    if (S.tool === 'pan') c = 'grab';
    else if (S.tool === 'crop' || S.tool === 'line' || S.tool === 'white' || S.tool === 'black') c = 'crosshair';
    else if (S.tool === 'angle') c = 'ew-resize';
    else if (S.tool === 'photo') c = photoNodeAt(b.sx, b.sy) ? 'move' : 'grab';
    if (S.tool === 'crop' && S.crop && S.vt) {
      const v = S.vt, r = S.crop;
      const pts = handlePts(v.ox + r.x * v.s, v.oy + r.y * v.s, r.w * v.s, r.h * v.s);
      const hi = pts.findIndex(([hx, hy]) => Math.abs(hx - b.sx) < 8 && Math.abs(hy - b.sy) < 8);
      if (hi >= 0) c = HANDLES[hi] + '-resize';
      else if (b.x > r.x && b.x < r.x + r.w && b.y > r.y && b.y < r.y + r.h) c = 'move';
    }
  } else if (b && S.dual && S.cur > 0) c = 'pointer';
  view.style.cursor = c;
}
let wheelLock = 0;
view.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    const r = view.getBoundingClientRect(), v = S.vt; if (!v) return;
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15, nz = clamp(S.zoomF * f, 0.2, 20);
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    // mantém o ponto sob o rato
    const k = nz / S.zoomF;
    const cx = v.slot.x + v.slot.w / 2 + S.panX, cy = v.slot.y + v.slot.h / 2 + S.panY;
    S.panX += (sx - cx) * (1 - k); S.panY += (sy - cy) * (1 - k);
    S.zoomF = nz; draw(); return;
  }
  if (S.zoomF > 1.01) { S.panY -= e.deltaY; S.panX -= e.deltaX; draw(); return; }
  const now = Date.now(); if (now - wheelLock < 250) return; wheelLock = now;
  go(S.cur + (e.deltaY > 0 ? 1 : -1));
}, { passive: false });
new ResizeObserver(() => draw()).observe($('viewWrap'));

function zoomBy(f) { S.zoomF = clamp(S.zoomF * f, 0.2, 20); draw(); }
function fit() { S.zoomF = 1; S.panX = S.panY = 0; draw(); }

// ───────────────────────── ferramentas ─────────────────────────
function resetToolState() { S.crop = null; S.line = null; S.angle = 0; S.photo = null; updateToolPanel(); }
function setTool(t) {
  S.tool = t; resetToolState();
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  if (t === 'crop' && S.vt) S.crop = null;
  updateToolPanel(); draw();
}
function setAngle(a) {
  S.angle = Math.round(clamp(a, -45, 45) * 10) / 10;
  const r = $('angR'), n = $('angN');
  if (r) r.value = S.angle; if (n) n.value = S.angle;
  draw();
}
function updateToolPanel() {
  const tp = $('toolPanel'), t = S.tool;
  const p = curPage();
  if (t === 'pan' || !p) { tp.classList.add('hidden'); tp.innerHTML = ''; return; }
  tp.classList.remove('hidden');
  if (t === 'crop') {
    tp.innerHTML = '<span class="msg">Arrasta para marcar a área a manter. Ajusta pelos cantos.</span>' +
      '<button id="cpAll">Selecionar tudo</button><button id="cpOk" class="primary">Aplicar recorte (Enter)</button><button id="cpNo">Cancelar (Esc)</button>' +
      (p.kind === 'pdf' ? '<span class="msg">· página PDF continua vetorial</span>' : '');
    $('cpOk').onclick = applyCrop;
    $('cpNo').onclick = () => setTool('pan');
    $('cpAll').onclick = () => { if (S.vt) { S.crop = { x: 0, y: 0, w: S.vt.w, h: S.vt.h }; draw(); } };
  } else if (t === 'angle') {
    tp.innerHTML = '<span class="msg">Ângulo</span><button id="angM">−0,1°</button>' +
      '<input type="range" id="angR" min="-45" max="45" step="0.1" value="0"><button id="angP">+0,1°</button>' +
      '<input type="number" id="angN" min="-45" max="45" step="0.1" value="0"><span class="msg">°</span>' +
      '<button id="angOk" class="primary">Aplicar (Enter)</button><button id="ang0">Repor</button><button id="tNo">Cancelar (Esc)</button>' +
      '<span class="msg">Podes também arrastar na página para os lados.</span>';
    $('angR').oninput = (e) => setAngle(+e.target.value);
    $('angN').oninput = (e) => setAngle(+e.target.value);
    $('angM').onclick = () => setAngle(S.angle - 0.1);
    $('angP').onclick = () => setAngle(S.angle + 0.1);
    $('ang0').onclick = () => setAngle(0);
    $('angOk').onclick = () => rotateAngle(S.angle);
  } else if (t === 'line') {
    tp.innerHTML = '<span class="msg">Desenha uma linha ao longo de uma linha de texto, de uma margem ou de uma aresta da folha. Ao largar, a página fica direita.</span><button id="tNo">Fechar (Esc)</button>';
  } else if (t === 'white') {
    tp.innerHTML = '<span class="msg">Clica numa zona do papel que devia ser branca. As cores são corrigidas a partir desse ponto.</span><button id="lvAuto">Auto níveis</button><button id="tNo">Fechar (Esc)</button>';
    $('lvAuto').onclick = autoLevels;
  } else if (t === 'black') {
    tp.innerHTML = '<span class="msg">Clica numa zona que devia ser preta (texto ou tinta mais escura).</span><button id="tNo">Fechar (Esc)</button>';
  } else if (t === 'batch') {
    const n = S.pages.length, sel = selIdx();
    const a = sel.length > 1 ? Math.min(...sel) + 1 : 1, b = sel.length > 1 ? Math.max(...sel) + 1 : n;
    tp.innerHTML = '<span class="msg">Foto → página em lote: da página</span>' +
      `<input type="number" id="btFrom" min="1" max="${n}" value="${a}"><span class="msg">à página</span>` +
      `<input type="number" id="btTo" min="1" max="${n}" value="${b}"><span class="msg">de ${n}</span>` +
      '<button id="btGo" class="primary">Processar (Enter)</button><button id="tNo">Cancelar (Esc)</button>' +
      '<span class="msg">Várias ao mesmo tempo; as de confiança baixa ficam como estão.</span>';
    $('btGo').onclick = runBatch;
  } else if (t === 'photo') {
    if (p.kind !== 'img') { tp.innerHTML = '<span class="msg">Foto → página serve para fotos e imagens. As páginas PDF já estão direitas.</span>'; return; }
    const ph = S.photo;
    if (!ph || ph.id !== p.id) { if (!ph || !ph.busy) startPhoto(); tp.innerHTML = '<span class="msg">A procurar a folha…</span>'; return; }
    if (ph.busy) { tp.innerHTML = '<span class="msg">A procurar a folha…</span>'; return; }
    const custom = $('photoFmt').value === 'custom';
    tp.innerHTML = '<span class="msg">Arrasta os pontos para as bordas da folha (Ctrl+roda para aproximar).</span>' +
      `<span class="msg">Grelha</span><select id="phN">${$('photoN').innerHTML}</select>` +
      `<span class="msg">Formato</span><select id="phF">${$('photoFmt').innerHTML}</select>` +
      (custom ? `<input type="number" id="phW" min="10" max="2000" step="0.5" value="${$('photoW').value}"><span class="msg">×</span><input type="number" id="phH" min="10" max="2000" step="0.5" value="${$('photoH').value}"><span class="msg">mm</span>` : '') +
      `<span class="msg" id="phInfo">${photoInfoText(ph)}</span>` +
      `<span class="msg">· confiança ${ph.det.quality.level}${photoContentText(ph.det.content)}</span>` +
      `<label class="msg"><input type="checkbox" id="phShow"${S.photoShow ? ' checked' : ''}> mostrar análise</label>` +
      '<button id="phOk" class="primary">Aplicar (Enter)</button><button id="phRe">Detetar de novo</button><button id="phNo">Cancelar (Esc)</button>';
    $('phN').value = String(ph.mesh.N); $('phF').value = $('photoFmt').value;
    $('phN').onchange = (e) => { $('photoN').value = e.target.value; saveSettings(); regridPhoto(+e.target.value); updateToolPanel(); draw(); };
    $('phF').onchange = (e) => { $('photoFmt').value = e.target.value; updatePhotoCustom(); saveSettings(); updateToolPanel(); };
    if (custom) for (const [a, b] of [['phW', 'photoW'], ['phH', 'photoH']]) $(a).oninput = (e) => { $(b).value = e.target.value; saveSettings(); $('phInfo').textContent = photoInfoText(ph); };
    $('phShow').onchange = (e) => { S.photoShow = e.target.checked; draw(); };
    $('phOk').onclick = applyPhoto;
    $('phRe').onclick = () => { S.photo = null; updateToolPanel(); };
    $('phNo').onclick = () => setTool('pan');
  }
}
document.addEventListener('click', (e) => { if (e.target.id === 'tNo') setTool('pan'); }); // botões Cancelar / Fechar das ferramentas
function photoContentText(ct) {
  if (!ct || ct.coverage < 0.4) return ' · pouco texto: só perspetiva';
  const what = ['', 'inclinação', 'curvatura', 'curvatura'];
  const parts = [];
  if (ct.v.apply) parts.push(`linhas: ${what[ct.v.model]}, ${ct.v.rms0.toFixed(1)} → ${ct.v.rms.toFixed(1)} mm`);
  if (ct.u.apply) parts.push(`verticais: ${what[ct.u.model]}, ${ct.u.rms0.toFixed(1)} → ${ct.u.rms.toFixed(1)} mm`);
  return parts.length ? ` · corrigido pelo conteúdo (${parts.join('; ')})` : ` · conteúdo já direito com a perspetiva (${ct.rms0.toFixed(1)} mm)`;
}
function updatePhotoCustom() { $('photoCustom').classList.toggle('hidden', $('photoFmt').value !== 'custom'); }

// ───────────────────────── exportação ─────────────────────────
function parseRange(s, n) {
  const out = [];
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error('Intervalo inválido: ' + part);
    let a = +m[1], b = m[2] ? +m[2] : a;
    if (a > b) [a, b] = [b, a];
    for (let i = a; i <= b; i++) if (i >= 1 && i <= n) out.push(i - 1);
  }
  return out;
}
function exportList() {
  const sc = $('scope').value;
  if (sc === 'cur') return S.cur >= 0 ? [S.pages[S.cur]] : [];
  if (sc === 'sel') return S.pages.filter((p) => S.sel.has(p.id));
  if (sc === 'range') return parseRange($('range').value, S.pages.length).map((i) => S.pages[i]);
  return S.pages.slice();
}
async function exportCanvas(p, dpiOut) {
  if (p.kind === 'pdf') {
    const dpi = dpiOut || +$('rasterDpi').value || 300;
    return { c: await renderPdf(p, dpi / 72), dpi };
  }
  let dpi = p.dpi;
  if (dpiOut && dpiOut < p.dpi - 0.5) {
    dpi = dpiOut;
    const w = Math.max(1, Math.round(p.w * dpi / p.dpi)), h = Math.max(1, Math.round(p.h * dpi / p.dpi));
    const bmp = await createImageBitmap(p.blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const c = canvas(w, h); ctx2d(c).drawImage(bmp, 0, 0); bmp.close();
    return { c, dpi };
  }
  return { c: await pageCanvas(p), dpi };
}
async function buildPdf(list, dpiOut, q, keepVector, lossless) {
  const out = await PDFDocument.create();
  out.setProducer('Pagloom'); out.setCreator('Pagloom');
  const used = new Set();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    busyMsg(`PDF: página ${i + 1} de ${list.length}…`);
    const src = p.kind === 'pdf' ? S.src.get(p.src) : null;
    if (src && src.lib && keepVector) {
      const [cp] = await out.copyPages(src.lib, [p.index]);
      if (p.crop) {
        const b = cp.getCropBox(), c = p.crop;
        cp.setCropBox(b.x + c.x0 * b.width, b.y + (1 - c.y1) * b.height, (c.x1 - c.x0) * b.width, (c.y1 - c.y0) * b.height);
      }
      cp.setRotation(degrees(totalRot(p)));
      out.addPage(cp);
      used.add(p.src);
    } else {
      const { c } = await exportCanvas(p, dpiOut);
      const sz = pageSizePts(p);
      let img;
      if (lossless) img = await out.embedPng(new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer()));
      else img = await out.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', q)).arrayBuffer()));
      c.width = c.height = 0;
      const pg = out.addPage([sz.w, sz.h]);
      pg.drawImage(img, { x: 0, y: 0, width: sz.w, height: sz.h });
    }
    await nextFrame();
  }
  busyMsg('A gravar o PDF…');
  return out.save({ useObjectStreams: true });
}

// TIFF RGB com compressão PackBits, várias páginas
function packbitsRow(src, out, o) {
  const n = src.length; let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && j - i < 128 && src[j] === src[i]) j++;
    if (j - i >= 3) { out[o++] = 257 - (j - i); out[o++] = src[i]; i = j; continue; }
    let k = i;
    while (k < n && k - i < 128) { if (k + 2 < n && src[k] === src[k + 1] && src[k] === src[k + 2]) break; k++; }
    out[o++] = k - i - 1;
    for (let m = i; m < k; m++) out[o++] = src[m];
    i = k;
  }
  return o;
}
class Bytes {
  constructor() { this.parts = []; this.len = 0; }
  push(u8) { this.parts.push(u8); this.len += u8.length; }
  blob() { return new Blob(this.parts); }
}
function u32le(...v) { const b = new Uint8Array(v.length * 4), d = new DataView(b.buffer); v.forEach((x, i) => d.setUint32(i * 4, x, true)); return b; }
async function buildTiff(list, dpiOut) {
  const B = new Bytes();
  B.push(new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0]));
  let prevNextPtr = 4; // posição do ponteiro "próximo IFD" a corrigir
  const patches = [];
  for (let i = 0; i < list.length; i++) {
    busyMsg(`TIFF: página ${i + 1} de ${list.length}…`);
    const { c, dpi } = await exportCanvas(list[i], dpiOut);
    const w = c.width, h = c.height;
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    c.width = c.height = 0;
    const rps = Math.max(1, Math.floor(65536 / (w * 3)));
    const row = new Uint8Array(w * 3), offs = [], counts = [];
    for (let y0 = 0; y0 < h; y0 += rps) {
      const rows = Math.min(rps, h - y0);
      const buf = new Uint8Array(rows * (w * 3 + Math.ceil(w * 3 / 128) + 2));
      let o = 0;
      for (let y = y0; y < y0 + rows; y++) {
        for (let x = 0, s = y * w * 4, t = 0; x < w; x++, s += 4) { row[t++] = d[s]; row[t++] = d[s + 1]; row[t++] = d[s + 2]; }
        o = packbitsRow(row, buf, o);
      }
      offs.push(B.len); counts.push(o);
      B.push(buf.subarray(0, o));
    }
    if (B.len & 1) B.push(new Uint8Array(1));
    const bpsOff = B.len; B.push(new Uint8Array([8, 0, 8, 0, 8, 0, 0, 0]));
    const resOff = B.len; B.push(u32le(Math.round(dpi * 100), 100, Math.round(dpi * 100), 100));
    let soOff = 0, sbOff = 0;
    if (offs.length > 1) { soOff = B.len; B.push(u32le(...offs)); sbOff = B.len; B.push(u32le(...counts)); }
    const tags = [
      [256, 4, 1, w], [257, 4, 1, h], [258, 3, 3, bpsOff], [259, 3, 1, 32773], [262, 3, 1, 2],
      [273, 4, offs.length, offs.length > 1 ? soOff : offs[0]], [277, 3, 1, 3], [278, 4, 1, rps],
      [279, 4, counts.length, counts.length > 1 ? sbOff : counts[0]], [282, 5, 1, resOff], [283, 5, 1, resOff + 8], [296, 3, 1, 2],
    ];
    const ifdOff = B.len;
    const ifd = new Uint8Array(2 + tags.length * 12 + 4), dv = new DataView(ifd.buffer);
    dv.setUint16(0, tags.length, true);
    tags.forEach(([tag, type, count, val], k) => {
      const o = 2 + k * 12;
      dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, count, true);
      if (type === 3 && count === 1) dv.setUint16(o + 8, val, true); else dv.setUint32(o + 8, val, true);
    });
    patches.push([prevNextPtr, ifdOff]);
    prevNextPtr = ifdOff + 2 + tags.length * 12;
    B.push(ifd);
    await nextFrame();
  }
  // corrigir ponteiros de IFD
  const all = new Uint8Array(await B.blob().arrayBuffer()), dv = new DataView(all.buffer);
  for (const [at, val] of patches) dv.setUint32(at, val, true);
  return all;
}

async function svgFor(p, dpiOut, q, lossless) {
  const { c } = await exportCanvas(p, dpiOut);
  const sz = pageSizePts(p);
  const url = lossless ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', q);
  const w = c.width, h = c.height; c.width = c.height = 0;
  const mmW = (sz.w / 72 * 25.4).toFixed(2), mmH = (sz.h / 72 * 25.4).toFixed(2);
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${mmW}mm" height="${mmH}mm" viewBox="0 0 ${w} ${h}">\n<image x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" xlink:href="${url}" href="${url}"/>\n</svg>\n`);
}
async function rasterFile(p, fmt, dpiOut, q) {
  const { c, dpi } = await exportCanvas(p, dpiOut);
  let b = new Uint8Array(await (await toBlob(c, fmt === 'jpg' ? 'image/jpeg' : 'image/png', q)).arrayBuffer());
  c.width = c.height = 0;
  b = fmt === 'jpg' ? setJpegDpi(b, dpi) : setPngDpi(b, dpi);
  return b;
}
async function writeFile(path, bytes) {
  const r = await api('write?path=' + encodeURIComponent(path), { method: 'POST', body: bytes });
  if (r.error) throw new Error(r.error);
}
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}_${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`;
}
function defaultName() {
  const p = S.pages[0];
  if (p && p.name && p.name !== 'Digitalização') return p.name.replace(/\.[^.]+$/, '') + '_editado';
  return 'Digitalizacao_' + stamp();
}
async function doExport() {
  if (!S.pages.length) { status('Não há páginas para exportar.', 'err'); return; }
  let list;
  try { list = exportList(); } catch (e) { status(e.message, 'err'); return; }
  if (!list.length) { status('Nenhuma página corresponde à escolha em “Páginas”.', 'err'); return; }
  saveSettings();
  const fmt = $('fmt').value, dpiOut = +$('dpiOut').value, q = +$('quality').value / 100;
  const keepVector = $('keepVector').checked, lossless = $('lossless').checked;
  const desc = { pdf: 'Documento PDF', png: 'Imagem PNG', jpg: 'Imagem JPEG', tif: 'Imagem TIFF', svg: 'Imagem SVG' }[fmt];
  status('A abrir a janela “Guardar como”…');
  let ch;
  try {
    ch = await api(`choose?name=${encodeURIComponent(defaultName() + '.' + fmt)}&ext=${fmt}&desc=${encodeURIComponent(desc)}`);
  } catch (e) { status('Não foi possível abrir a janela “Guardar como”: ' + e.message, 'err'); return; }
  if (ch.error) { status('Não foi possível abrir a janela “Guardar como”: ' + ch.error, 'err'); return; }
  if (ch.cancelled) { status('Exportação cancelada.'); return; }
  busy('A exportar…');
  const written = [];
  try {
    if (fmt === 'pdf') { await writeFile(ch.path, await buildPdf(list, dpiOut, q, keepVector, lossless)); written.push(ch.path); }
    else if (fmt === 'tif') { await writeFile(ch.path, await buildTiff(list, dpiOut)); written.push(ch.path); }
    else {
      for (let i = 0; i < list.length; i++) {
        busyMsg(`A exportar página ${i + 1} de ${list.length}…`);
        const path = list.length === 1 ? ch.path : ch.path.replace(/(\.[^.\\/]+)?$/, (m) => `_${pad(i + 1)}${m || '.' + fmt}`);
        const bytes = fmt === 'svg' ? await svgFor(list[i], dpiOut, q, lossless) : await rasterFile(list[i], fmt, dpiOut, q);
        await writeFile(path, bytes); written.push(path);
        await nextFrame();
      }
    }
    S.dirty = false; syncUnsaved();
    const first = written[0];
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    status(`${ch.note ? esc(ch.note) + ' ' : ''}Exportado: ${esc(written.length === 1 ? first : written.length + ' ficheiros em ' + ch.dir)} — <a id="lnkReveal">mostrar na pasta</a>`, 'ok', true);
    $('lnkReveal').onclick = () => api('reveal?path=' + encodeURIComponent(first));
    $('lastOut').textContent = 'Último: ' + first;
  } catch (e) {
    status('Erro ao exportar: ' + e.message, 'err');
  } finally { idle(); }
}
// Exportar (botão de cima / Ctrl+E): pergunta formato, páginas e resolução; depois vem o "Guardar como" (pasta e nome).
// Os campos são os mesmos do separador Exportar (ficam sincronizados e guardados nas definições).
const EXP_PAIRS = [['dFmt', 'fmt'], ['dScope', 'scope'], ['dRange', 'range'], ['dDpi', 'dpiOut']];
function openExportDialog() {
  if (!S.pages.length) { status('Não há páginas para exportar.', 'err'); return; }
  const d = $('expDlg');
  if (d.open) return;
  for (const [a, b] of EXP_PAIRS) { if ($(b).tagName === 'SELECT') $(a).innerHTML = $(b).innerHTML; $(a).value = $(b).value; }
  $('dRange').classList.toggle('hidden', $('dScope').value !== 'range');
  d.showModal();
}
on('dScope', 'change', () => $('dRange').classList.toggle('hidden', $('dScope').value !== 'range'));
on('expDlg', 'close', () => {
  if ($('expDlg').returnValue !== 'ok') return;
  for (const [a, b] of EXP_PAIRS) $(b).value = $(a).value;
  $('range').classList.toggle('hidden', $('scope').value !== 'range');
  saveSettings(); updateExportInfo();
  doExport();
});
function updateExportInfo() {
  const fmt = $('fmt').value;
  $('pdfOpts').classList.toggle('hidden', fmt !== 'pdf');
  $('range').classList.toggle('hidden', $('scope').value !== 'range');
  const usesQ = fmt === 'jpg' || ((fmt === 'pdf' || fmt === 'svg') && !$('lossless').checked);
  $('quality').disabled = !usesQ; $('qLbl').style.opacity = usesQ ? 1 : 0.4;
  let n = 0, info = '';
  try { n = exportList().length; } catch (e) { info = e.message; }
  const p = curPage();
  if (p) {
    const sz = pageSizePts(p), mm = (v) => (v / 72 * 25.4).toFixed(0);
    info = `Páginas a exportar: ${n}\nPágina atual: ${mm(sz.w)} × ${mm(sz.h)} mm`;
    if (p.kind === 'img') {
      const d = +$('dpiOut').value, t = d && d < p.dpi ? d : p.dpi;
      info += `\n${p.w} × ${p.h} px a ${Math.round(p.dpi)} ppp → ${Math.round(p.w * t / p.dpi)} × ${Math.round(p.h * t / p.dpi)} px a ${Math.round(t)} ppp`;
    } else info += '\nPágina PDF original' + (S.src.get(p.src).lib ? ' (vetorial)' : ' (protegida: sai como imagem)');
  }
  $('exportInfo').textContent = info || '—';
}
function updatePageInfo() {
  const p = curPage();
  if (!p) { $('pageInfo').textContent = 'Sem página.'; return; }
  const sz = pageSizePts(p), mm = (v) => (v / 72 * 25.4).toFixed(1);
  $('pageInfo').textContent = p.kind === 'img'
    ? `Imagem${p.name ? ' — ' + p.name : ''}\n${p.w} × ${p.h} px\n${Math.round(p.dpi)} ppp\n${mm(sz.w)} × ${mm(sz.h)} mm`
    : `Página ${p.index + 1} de “${p.name}”\nPDF original (vetorial)\nRotação: ${totalRot(p)}°${p.crop ? '\nRecortada' : ''}\n${mm(sz.w)} × ${mm(sz.h)} mm`;
}

// ───────────────────────── refrescar interface ─────────────────────────
function refresh(scroll = true) {
  const n = S.pages.length;
  $('counter').textContent = n ? `${S.cur + 1} / ${n}` : '— / —';
  $('bPrev').disabled = S.cur <= 0; $('bNext').disabled = S.cur >= n - 1;
  for (const id of ['bExport', 'bExport2', 'bDel', 'bDup', 'bRotL', 'bRotR', 'bAuto', 'bRescan', 'bSelAll', 'bNew', 'bPhotoBatch']) $(id).disabled = !n;
  $('bUndo').disabled = !S.undo.length; $('bRedo').disabled = !S.redo.length;
  $('bDual').classList.toggle('toggled', S.dual);
  renderThumbs(scroll);
  updateToolPanel(); updateExportInfo(); updatePageInfo();
  draw();
  syncUnsaved();
}

// ───────────────────────── aviso ao fechar ─────────────────────────
// Páginas por exportar: o browser (Linux) pergunta pelo beforeunload; no Windows quem pergunta
// é o programa, ao fechar a janela, por isso o estado também é enviado ao servidor.
const unsaved = () => S.dirty && S.pages.length > 0;
let sentUnsaved = false;
function syncUnsaved() {
  const u = unsaved();
  if (u === sentUnsaved) return;
  sentUnsaved = u;
  api('unsaved?v=' + (u ? 1 : 0), { method: 'POST' }).catch(() => { sentUnsaved = !u; });
}
window.addEventListener('beforeunload', (e) => {
  if (!unsaved()) return;
  e.preventDefault(); e.returnValue = '';
});

// ───────────────────────── definições ─────────────────────────
let settings = {};
const SET_FIELDS = ['src', 'mode', 'dpiIn', 'area', 'bright', 'contrast', 'fmt', 'scope', 'dpiOut', 'quality', 'rasterDpi', 'photoN', 'photoFmt', 'photoW', 'photoH', 'photoCores'];
const SET_CHECKS = ['keepVector', 'lossless', 'photoAuto'];
let saveT = 0;
function saveSettings() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const s = { dev: $('dev').value, dual: S.dual };
    SET_FIELDS.forEach((k) => (s[k] = $(k).value));
    SET_CHECKS.forEach((k) => (s[k] = $(k).checked));
    api('settings', { method: 'POST', body: JSON.stringify(s) }).catch(() => {});
  }, 300);
}
async function loadSettings() {
  try { settings = await api('settings'); } catch (e) { settings = {}; }
  SET_FIELDS.forEach((k) => { if (settings[k] != null) $(k).value = settings[k]; });
  SET_CHECKS.forEach((k) => { if (settings[k] != null) $(k).checked = !!settings[k]; });
  S.dual = !!settings.dual;
  updatePhotoCustom();
  $('brV').textContent = $('bright').value; $('ctV').textContent = $('contrast').value; $('qV').textContent = $('quality').value;
}

// ───────────────────────── ligações da interface ─────────────────────────
function on(id, ev, fn) { $(id).addEventListener(ev, fn); }
on('bScan', 'click', () => doScan());
on('bScan2', 'click', () => doScan());
on('bRescan', 'click', () => doScan({ replace: true }));
on('bDriver', 'click', () => doScan({ ui: true }));
on('bRefresh', 'click', async () => { await checkDeps(); loadDevices(); });
on('bOpen', 'click', () => $('fileIn').click());
on('fileIn', 'change', (e) => { addFiles(e.target.files); e.target.value = ''; });
on('bUndo', 'click', undo);
on('bRedo', 'click', redo);
on('bNew', 'click', newDoc);
on('bExport', 'click', openExportDialog);
on('bExport2', 'click', doExport);
on('bPrev', 'click', () => go(S.cur - 1));
on('bNext', 'click', () => go(S.cur + 1));
on('bRotL', 'click', () => rotate90(false));
on('bRotR', 'click', () => rotate90(true));
on('bAuto', 'click', autoLevels);
on('bPhotoBatch', 'click', () => setTool('batch'));
on('bDel', 'click', deleteSel);
on('bDup', 'click', duplicate);
on('bSelAll', 'click', () => { S.sel = new Set(S.pages.map((p) => p.id)); refresh(false); });
on('bDual', 'click', () => { S.dual = !S.dual; saveSettings(); refresh(false); });
on('bFit', 'click', fit);
on('bZoomIn', 'click', () => zoomBy(1.25));
on('bZoomOut', 'click', () => zoomBy(0.8));
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === b));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'pane-' + b.dataset.tab));
}));
for (const id of ['bright', 'contrast', 'quality']) on(id, 'input', (e) => { $({ bright: 'brV', contrast: 'ctV', quality: 'qV' }[id]).textContent = e.target.value; });
for (const id of [...SET_FIELDS, ...SET_CHECKS, 'dev']) on(id, 'change', () => { saveSettings(); updateExportInfo(); });
on('photoFmt', 'change', () => { updatePhotoCustom(); if (S.tool === 'photo') updateToolPanel(); });
on('photoN', 'change', () => { if (S.tool === 'photo') { regridPhoto(+$('photoN').value); updateToolPanel(); draw(); } });
for (const id of ['photoW', 'photoH']) on(id, 'input', () => { if ($('phInfo') && S.photo && S.photo.mesh) $('phInfo').textContent = photoInfoText(S.photo); });
on('range', 'input', updateExportInfo);
// os botões não ficam com o foco (para o teclado funcionar sempre)
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });

// arrastar ficheiros do Explorador
let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => { if (isFileDrag(e)) { dragDepth++; $('dropHint').classList.remove('hidden'); } });
window.addEventListener('dragleave', (e) => { if (isFileDrag(e) && --dragDepth <= 0) { dragDepth = 0; $('dropHint').classList.add('hidden'); } });
window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault(); dragDepth = 0; $('dropHint').classList.add('hidden');
  addFiles(e.dataTransfer.files);
});

// teclado
document.addEventListener('keydown', (e) => {
  if (!$('busy').classList.contains('hidden') || $('expDlg').open) return;
  const tag = (e.target.tagName || '').toUpperCase();
  const typing = (tag === 'INPUT' && /text|number/.test(e.target.type)) || tag === 'TEXTAREA';
  const k = e.key;
  if (e.ctrlKey && !e.shiftKey && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && (k.toLowerCase() === 'y' || (e.shiftKey && k.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
  if (e.ctrlKey && k.toLowerCase() === 'e') { e.preventDefault(); openExportDialog(); return; }
  if (e.ctrlKey && k.toLowerCase() === 'o') { e.preventDefault(); $('fileIn').click(); return; }
  if (e.ctrlKey && k.toLowerCase() === 'a' && !typing) { e.preventDefault(); S.sel = new Set(S.pages.map((p) => p.id)); refresh(false); return; }
  if (typing || tag === 'SELECT') {
    if (k === 'Enter' && S.tool === 'angle') rotateAngle(S.angle);
    if (k === 'Enter' && S.tool === 'batch') runBatch();
    if (k === 'Escape') { e.target.blur(); setTool('pan'); }
    return;
  }
  if (e.ctrlKey || e.altKey) return;
  switch (k) {
    case ' ': e.preventDefault(); doScan(); break;
    case 'ArrowLeft': case 'PageUp': e.preventDefault(); go(S.cur - 1); break;
    case 'ArrowRight': case 'PageDown': e.preventDefault(); go(S.cur + 1); break;
    case 'Home': go(0); break;
    case 'End': go(S.pages.length - 1); break;
    case 'Delete': deleteSel(); break;
    case 'Enter': if (S.tool === 'crop') applyCrop(); else if (S.tool === 'angle') rotateAngle(S.angle); else if (S.tool === 'photo') applyPhoto(); else if (S.tool === 'batch') runBatch(); break;
    case 'p': case 'P': setTool(e.shiftKey ? 'batch' : 'photo'); break;
    case 'Escape': setTool('pan'); break;
    case 'r': case 'R': rotate90(true); break;
    case 'l': case 'L': rotate90(false); break;
    case 'c': case 'C': setTool('crop'); break;
    case 'a': case 'A': setTool('angle'); break;
    case 't': case 'T': setTool('line'); break;
    case 'w': case 'W': setTool('white'); break;
    case 'k': case 'K': setTool('black'); break;
    case 'h': case 'H': setTool('pan'); break;
    case 'd': case 'D': S.dual = !S.dual; saveSettings(); refresh(false); break;
    case '0': fit(); break;
    case '+': case '=': zoomBy(1.25); break;
    case '-': zoomBy(0.8); break;
  }
});

// ───────────────────────── dependências (Linux) ─────────────────────────
async function checkDeps() {
  try {
    const d = await api('deps');
    $('depsBox').classList.toggle('hidden', !!d.ok);
    if (d.ok) return true;
    $('depsList').innerHTML = (d.missing || []).map((m) => '• ' + m).join('<br>');
    $('depsCmd').textContent = d.command || '';
    $('bDeps').classList.toggle('hidden', !d.pm);
    return false;
  } catch (e) { return true; }
}
async function installDeps() {
  busy('A instalar o SANE… (confirma a palavra-passe na janela do sistema)');
  try {
    const r = await api('deps/install', { method: 'POST' });
    if (r.error) status('Instalação: ' + r.error, 'err');
    else status(r.message, 'ok');
  } catch (e) { status('Instalação: ' + e.message, 'err'); }
  finally { idle(); }
  if (await checkDeps()) loadDevices();
}
on('bDeps', 'click', installDeps);

// ───────────────────────── arranque ─────────────────────────
setInterval(() => api('ping').catch(() => {}), 20000);
(async () => {
  try {
    const info = await api('info');
    if (!info.driverUI) $('bDriver').classList.add('hidden');
    if (info.os === 'linux') $('scanHint').textContent = 'As páginas novas entram a seguir à página atual. Em Linux usa o SANE (sane-utils; sane-airscan para scanners de rede).';
  } catch (e) {}
  await loadSettings();
  refreshSys();
  refresh();
  await checkDeps();
  await loadDevices();
})();

// para testes
window.__S = S;
window.__addFiles = addFiles;
