// Pagloom — interface (corre no WebView2 do Windows)
import * as pdfjsLib from './lib/pdf.min.mjs';
import * as Photo from './photo.js';
import { tr, setLang, startTranslation } from './i18n.js';
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
    const pw = prompt(tr('O ficheiro "' + file.name + '" tem palavra-passe:'));
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
  let photos = 0;
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
    insertPages(added);
    let msg = `${added.length} página(s) adicionada(s).`;
    if (photos && !$('photoAuto').checked) msg += ' Para endireitar uma foto e pô-la no tamanho real, usa “Foto → página” (tecla P).';
    status(msg, 'ok');
  } catch (e) {
    if (added.length) insertPages(added);
    status('Erro a abrir: ' + e.message, 'err');
  } finally { idle(); }
  // "endireitar ao adicionar": propõe as malhas das fotos para rever; o texto lê-se depois de aplicar
  const photoIds = photoIdx.map((k) => added[k].id);
  if (photoIds.length && $('photoAuto').checked) {
    await previewPages(photoIds.map((id) => S.pages.findIndex((x) => x.id === id)).filter((i) => i >= 0), $('ocrOnAdd').checked);
    return;
  }
  // ler o texto das páginas novas (fotos, imagens, PDFs digitalizados; os PDFs digitais são ignorados)
  if ($('ocrOnAdd').checked && added.length) {
    const idxs = added.map((p) => S.pages.findIndex((x) => x.id === p.id)).filter((i) => i >= 0);
    let any = false;
    for (const i of idxs) if (S.pages[i].kind === 'img' || (await isScannedPdf(S.pages[i]))) { any = true; break; }
    if (any) await ocrPages(idxs);
  }
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
async function rasterize(p, silent, dpiOverride) {
  if (p.kind === 'img') return p;
  const dpi = dpiOverride || +$('rasterDpi').value || 300;
  if (!silent && !S.askedRaster) {
    S.askedRaster = true;
    if (!confirm(tr(`Esta operação converte a página PDF numa imagem a ${dpi} ppp (o texto deixa de ser selecionável nessa página).\n\nContinuar?`))) return null;
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
// S.photo = { id, busy } enquanto deteta; depois { id, det, dets, meshes, mesh, W, H, edited }:
// uma grelha por página (duas num livro aberto: esquerda e direita); mesh = meshes[0]
const FMT_NAMES = { a3: 'A3', a4: 'A4', a5: 'A5', a6: 'A6', letter: 'Carta', legal: 'Ofício' };
const photoFmtArgs = () => [$('photoFmt').value, [+$('photoW').value || 210, +$('photoH').value || 297]];
// Formato, tamanho em mm, píxeis e ppp da página corrigida k
function photoPlan(ph, k = 0) { return Photo.planPage(ph.meshes[k], ph.W, ph.H, ...photoFmtArgs()); }
function photoInfoText(ph) {
  const one = (k) => {
    const pl = photoPlan(ph, k);
    const label = $('photoFmt').value === 'custom' ? 'medida própria'
      : pl.assumed ? 'proporção medida, largura assumida de 210 mm — escolhe o formato'
        : FMT_NAMES[pl.key] + (pl.auto ? ' (automático)' : '');
    return `${pl.mm[0].toFixed(0)} × ${pl.mm[1].toFixed(0)} mm (${label}) · ${pl.sz.w} × ${pl.sz.h} px · ${Math.round(pl.dpi)} ppp`;
  };
  const n = ph.meshes.length, a = clamp(ph.active ?? 0, 0, n - 1);
  return n > 1 ? `${n} páginas nesta foto (malha ativa: ${one(a)})` : one(0);
}
function setPhotoMeshes(ph, meshes) { ph.meshes = meshes; ph.mesh = meshes[0]; ph.active = clamp(ph.active ?? 0, 0, meshes.length - 1); }
// Dados para treino: a malha proposta (ph.auto, guardada quando se deteta) e a final de cada foto corrigida.
// Ficam na página que sai da correção (p.grid) e vão num <nome>.treino.zip ao lado do que se exporta,
// com as fotos originais (as coordenadas são em píxeis dessas fotos).
const recPhoto = new WeakMap(); // registo → blob da foto original
function meshData(m) {
  const N = m.N, nodes = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) nodes.push(Photo.meshNode(m, i, j).map((v) => Math.round(v * 10) / 10));
  return { N, nodes, fixed: m.fix ? Array.from(m.fix) : null };
}
function snapAuto(ph) { ph.auto = { spread: !!ph.det.spread, how: ph.det.how || '', meshes: ph.meshes.map(meshData) }; }
function gridRecord(ph, src, skipped = false) {
  const rec = { source: (src && src.name) || '', W: ph.W, H: ph.H, proposed: ph.auto || null, edited: !!ph.edited, skipped,
    final: skipped ? [] : meshOrder(ph).map((k) => meshData(ph.meshes[k])) };
  if (src && src.blob) recPhoto.set(rec, src.blob);
  return rec;
}
function setGrid(pages, rec) { pages.forEach((p, k) => { p.grid = rec; p.gridPart = k; }); }
async function writeTrainingZip(path, list) {
  const recs = [], pages = [];
  list.forEach((p, n) => {
    if (!p.grid) return;
    let r = recs.indexOf(p.grid);
    if (r < 0) { r = recs.length; recs.push(p.grid); }
    pages.push({ page: n + 1, photo: r, mesh: p.gridPart || 0 });
  });
  if (!recs.length) return null;
  const files = [], photos = [];
  for (let r = 0; r < recs.length; r++) {
    const rec = recs[r], blob = recPhoto.get(rec);
    let file = null;
    if (blob) {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[blob.type] || '.bin';
      file = `fotos/${pad(r + 1, 3)}_${rec.source.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'foto'}${ext}`;
      files.push({ name: file, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    photos.push({ ...rec, file });
  }
  const doc = { app: 'Pagloom', kind: 'treino', version: 1, saved: new Date().toISOString(),
    note: 'file: foto original dentro do zip; nodes: pontos da malha N×N por linhas (x, y em píxeis dessa foto); fixed: 1 = ponto posto à mão; proposed = proposta automática, final[k] = página k corrigida (esquerda→direita); skipped = foto ignorada',
    photos, pages };
  files.unshift({ name: 'malhas.json', bytes: new TextEncoder().encode(JSON.stringify(doc, null, 1)) });
  const out = path.replace(/(\.[^.\\/]+)?$/, '') + '.treino.zip';
  await writeFile(out, makeZip(files));
  return out;
}
// ZIP sem compressão (as fotos já vêm comprimidas): cabeçalhos locais + diretório central
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.bytes, 0, f.bytes.length), n = f.bytes.length;
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, n, 4], [22, n, 4], [26, name.length, 2], [28, 0, 2]]
      .forEach(([o, v, s]) => (s === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true)));
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, n, 4], [24, n, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]]
      .forEach(([o, v, s]) => (s === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true)));
    parts.push(new Uint8Array(h.buffer), name, f.bytes); central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + n;
  }
  const csize = central.reduce((s, a) => s + a.length, 0), e = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, csize, 4], [16, off, 4], [20, 0, 2]]
    .forEach(([o, v, s]) => (s === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true)));
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
// Malhas à mão: cada malha é uma página. "＋ Malha" insere uma malha de tamanho fixo (35% da largura da foto,
// proporção A) na metade da foto que ainda não tem malhas, para depois acertar pelos cantos; "− Malha" apaga a ativa.
const MESH_COLORS = ['#5b93f5', '#3ccf6a', '#f5a623', '#e45bbd', '#5bd0e4', '#c0c45b'];
function addMesh() {
  const ph = S.photo;
  if (!ph || !ph.mesh) return;
  const W = ph.W, H = ph.H, w = 0.35 * W, h = Math.min(w * 1.414, 0.9 * H);
  const cx = ph.meshes.reduce((s, m) => s + m.corners.reduce((t, p) => t + p[0], 0) / 4, 0) / ph.meshes.length; // centro das malhas que já há
  const x0 = clamp((cx < W / 2 ? 0.75 : 0.25) * W - w / 2, 0, W - w), y0 = (H - h) / 2, x1 = x0 + w, y1 = y0 + h;
  const det = { found: true, corners: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], content: null, quality: ph.det.quality };
  ph.dets = [...ph.dets, det];
  setPhotoMeshes(ph, [...ph.meshes, Photo.buildMesh(det, ph.mesh.N)]);
  ph.active = ph.meshes.length - 1; ph.edited = true; ph.det.spread = ph.meshes.length > 1;
  renderThumbs(false); updateToolPanel(); draw();
}
function removeMesh() {
  const ph = S.photo;
  if (!ph || !ph.mesh) return;
  if (ph.meshes.length <= 1) { status('Fica pelo menos uma malha. Para não corrigir esta foto, usa “Ignorar esta página” ou “Cancelar”.', 'err'); return; }
  const a = clamp(ph.active ?? ph.meshes.length - 1, 0, ph.meshes.length - 1);
  ph.dets = ph.dets.filter((_, k) => k !== a);
  setPhotoMeshes(ph, ph.meshes.filter((_, k) => k !== a));
  ph.active = Math.max(0, a - 1); ph.edited = true; ph.det.spread = ph.meshes.length > 1;
  updateToolPanel(); draw();
}
// Ordem das páginas ao aplicar: da esquerda para a direita; quando estão empilhadas, de cima para baixo
function meshOrder(ph) {
  const c = ph.meshes.map((m, k) => ({ k, x: m.corners.reduce((s, p) => s + p[0], 0) / 4, y: m.corners.reduce((s, p) => s + p[1], 0) / 4 }));
  return c.sort((a, b) => (Math.abs(a.x - b.x) > 0.1 * ph.W ? a.x - b.x : a.y - b.y)).map((o) => o.k);
}

// Página PDF que é uma digitalização (imagem, sem texto visível nem desenho vetorial; o texto invisível do OCR
// não conta): pode ir ao Foto → página. Os PDFs digitais (texto e vetores) já estão direitos e ficam de fora.
async function isScannedPdf(p) {
  if (p.kind !== 'pdf') return false;
  if (p.scan !== undefined) return p.scan;
  const OPS = pdfjsLib.OPS, page = await S.src.get(p.src).doc.getPage(p.index + 1), ops = await page.getOperatorList();
  const SHOW = [OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText];
  let images = 0, text = 0, paths = 0, mode = 0, maxW = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i];
    if (f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintImageXObjectRepeat) {
      images++;
      const a = ops.argsArray[i];
      if (f === OPS.paintImageXObject && a && a[1] > maxW) maxW = a[1]; // [id, largura, altura] em píxeis
    }
    else if (f === OPS.setTextRenderingMode) mode = ops.argsArray[i][0];
    else if (SHOW.includes(f) && mode !== 3) text++; // 3 = invisível (camada de OCR)
    else if (f === OPS.constructPath) paths++;
  }
  // resolução da digitalização (largura da imagem ÷ largura da página), para converter sem perder detalhe
  const pw = totalRot(p) % 180 ? p.hPt : p.wPt;
  p.scanDpi = maxW ? Math.round(clamp(maxW / (pw / 72), 72, 1200)) : 0;
  return (p.scan = images > 0 && text === 0 && paths < 20);
}
// Converte uma página PDF digitalizada à resolução da própria digitalização (nunca abaixo da do separador Página)
const rasterizeScan = (p) => rasterize(p, true, Math.max(p.scanDpi || 0, +$('rasterDpi').value || 300));

async function startPhoto() {
  let p = curPage();
  if (!p) return;
  S.photo = { id: p.id, busy: true };
  if (p.kind === 'pdf') { // só PDFs digitalizados; converte-se a página em imagem e segue como uma foto
    if (!(await isScannedPdf(p))) { S.photo = { id: p.id, vector: true }; updateToolPanel(); return; }
    let n;
    busy('Em processamento…');
    try { n = await rasterizeScan(p); } finally { idle(); }
    if (S.tool !== 'photo' || curPage() !== p) return;
    pushUndo(); S.pages[S.cur] = n; S.photo = { id: n.id, busy: true }; refresh(false);
    p = n;
  }
  const id = p.id;
  busy('Em processamento…');
  try {
    const W = p.w, H = p.h;
    pool.size = Math.max(pool.size, 1);
    const spread = $('photoSpread').value !== 'never';
    const { det } = await poolRun(async () => {
      const c = await pageCanvas(p), px = pixelsOf(c); c.width = c.height = 0;
      return { msg: { op: 'detect', img: px.img, spread }, transfer: px.transfer };
    });
    if (S.tool !== 'photo' || !curPage() || curPage().id !== id) return;
    const dets = det.spread ? det.pages : [det], N = +$('photoN').value;
    S.photo = { id, det, dets, W, H, edited: false };
    setPhotoMeshes(S.photo, dets.map((d) => Photo.buildMesh(d, N))); snapAuto(S.photo);
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
  if (!ph.edited) { setPhotoMeshes(ph, ph.dets.map((d) => Photo.buildMesh(d, N))); return; }
  setPhotoMeshes(ph, ph.meshes.map((old) => {
    const map = Photo.meshMapper(old), m = { N, corners: old.corners.map((c) => c.slice()), res: new Float64Array(N * N * 2) };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = map(i / (N - 1), j / (N - 1)); Photo.moveNode(m, i, j, q[0], q[1]); }
    return m;
  }));
}
// Aplica: uma página corrigida por grelha (num livro aberto, a foto dá lugar à página esquerda e à direita)
async function applyPhoto() {
  const ph = S.photo, p = curPage();
  if (!ph || !ph.mesh || !p || ph.id !== p.id) return;
  const order = meshOrder(ph), plans = order.map((k) => photoPlan(ph, k)), meshes = order.map((k) => ph.meshes[k]), at = S.cur;
  setTool('pan');
  busy('Em processamento…');
  try {
    const c = await pageCanvas(p), out = [];
    for (let k = 0; k < meshes.length; k++) {
      const { sz, dpi } = plans[k];
      const { data } = await poolRun(() => { const px = pixelsOf(c); return { msg: { op: 'warp', img: px.img, mesh: meshes[k], w: sz.w, h: sz.h }, transfer: px.transfer }; });
      const o = canvasFrom(data, sz.w, sz.h, dpi);
      out.push(await imgPageFromCanvas(o, dpi, p));
      o.width = o.height = 0;
    }
    c.width = c.height = 0;
    setGrid(out, gridRecord(ph, p));
    pushUndo();
    S.pages.splice(at, 1, ...out);
    S.cur = at; S.sel = new Set(out.map((x) => x.id));
    refresh();
    status('Foto → página — feito.', 'ok');
  } catch (e) { status('Foto → página: ' + e.message, 'err'); } finally { idle(); }
}
// ───────────────────────── lote: prever → rever → aplicar ─────────────────────────
// O lote não aplica nada logo: calcula as malhas de todas as páginas (propostas), mostra-as para confirmar ou
// corrigir à mão, e só no fim "Aplicar todas" corrige tudo de uma vez (um só Ctrl+Z).
// S.review = { props: Map(id da página → proposta), readAfter } ; proposta = { id, det, dets, meshes, mesh, W, H, edited, skip }
function runBatch() {
  const n = S.pages.length, a = clamp(Math.round(+$('btFrom').value) || 1, 1, n), b = clamp(Math.round(+$('btTo').value) || n, 1, n);
  const idxs = [];
  for (let i = Math.min(a, b) - 1; i < Math.max(a, b); i++) idxs.push(i);
  previewPages(idxs);
}
// readAfter: ler o texto depois de aplicar (fotos acabadas de adicionar com "ler o texto sempre")
async function previewPages(range, readAfter = false) {
  // fotos e PDFs digitalizados; os PDFs digitais (vetoriais) ficam de fora
  const idxs = [];
  for (const i of range) if (S.pages[i].kind === 'img' || (await isScannedPdf(S.pages[i]))) idxs.push(i);
  if (!idxs.length) { status('Nesse intervalo só há páginas PDF digitais (vetoriais): já estão direitas.', 'err'); return; }
  setTool('pan');
  busy('Em processamento…');
  try {
    // PDFs digitalizados: passam a imagem já aqui (as malhas são em píxeis da imagem)
    const scans = [];
    for (const i of idxs) if (S.pages[i].kind === 'pdf') scans.push(i);
    if (scans.length) { pushUndo(); for (const i of scans) S.pages[i] = await rasterizeScan(S.pages[i]); }
    const cores = await setPoolFor(idxs.map((i) => S.pages[i])), N = +$('photoN').value, spread = $('photoSpread').value !== 'never';
    const props = new Map();
    let done = 0;
    busyMsg(`Em processamento: 0 de ${idxs.length} (${cores} em paralelo)…`);
    await Promise.all(idxs.map(async (i) => {
      const p = S.pages[i];
      const { det } = await poolRun(async () => {
        const c = await pageCanvas(p), px = pixelsOf(c); c.width = c.height = 0;
        return { msg: { op: 'detect', img: px.img, spread }, transfer: px.transfer };
      });
      const prop = { id: p.id, det, dets: det.spread ? det.pages : [det], W: p.w, H: p.h, edited: false, skip: false };
      setPhotoMeshes(prop, prop.dets.map((d) => Photo.buildMesh(d, N))); snapAuto(prop);
      props.set(p.id, prop);
      busyMsg(`Em processamento: ${++done} de ${idxs.length} (${pool.size} em paralelo)…`);
    }));
    S.review = { props, readAfter };
    S.cur = idxs[0]; S.sel = new Set([S.pages[S.cur].id]);
    setTool('review'); refresh(); // marcas ▱ nas miniaturas
    status(`Malhas propostas para ${props.size} página(s). Confirma ou corrige cada uma (setas para mudar de página) e carrega em “Aplicar todas”.`, 'ok');
  } catch (e) {
    status('Foto → página: ' + e.message, 'err');
  } finally { idle(); }
}
// Proposta da página atual (a malha que aparece e se edita no modo de revisão)
function reviewProp() { const p = curPage(); return S.review && p ? S.review.props.get(p.id) || null : null; }
function reviewIds() { return S.pages.filter((p) => S.review && S.review.props.has(p.id)).map((p) => p.id); }
// Trocar entre dividir (livro aberto) e não dividir só nesta página: deteta outra vez com a opção contrária
async function toggleSpread() {
  const prop = reviewProp(), p = curPage();
  if (!prop) return;
  busy('Em processamento…');
  try {
    const spread = !prop.det.spread;
    const { det } = await poolRun(async () => {
      const c = await pageCanvas(p), px = pixelsOf(c); c.width = c.height = 0;
      return { msg: { op: 'detect', img: px.img, spread }, transfer: px.transfer };
    });
    const N = +$('photoN').value;
    if (spread && !det.spread) {
      // não encontrou a lombada: divide a malha atual ao meio e deixa acertar os pontos da lombada à mão
      const [a, b, c, d] = prop.mesh.corners, mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], mt = mid(a, b), mb = mid(d, c);
      const halves = [[a, mt, mb, d], [mt, b, c, mb]].map((corners) => ({ found: true, corners, content: null, quality: prop.det.quality }));
      prop.det = { found: true, spread: true, pages: halves, corners: [a, b, c, d], quality: prop.det.quality }; prop.dets = halves; prop.edited = true;
      setPhotoMeshes(prop, halves.map((h) => Photo.buildMesh(h, N)));
      status('Não encontrei a lombada: dividi ao meio. Acerta os pontos do meio sobre a lombada.', 'ok');
    } else {
      prop.det = det; prop.dets = det.spread ? det.pages : [det]; prop.edited = false;
      setPhotoMeshes(prop, prop.dets.map((d) => Photo.buildMesh(d, N)));
    }
    S.photo = prop;
  } catch (e) { status('Foto → página: ' + e.message, 'err'); } finally { idle(); updateToolPanel(); draw(); }
}
// Aplica todas as propostas que não foram ignoradas; os PDFs digitais e as ignoradas ficam como estão
async function applyReview() {
  if (!S.review) return;
  const { props, readAfter } = S.review, todo = [];
  S.pages.forEach((p, i) => { const pr = props.get(p.id); if (pr && !pr.skip) todo.push({ i, p, pr }); });
  if (!todo.length) { status('Não há malhas para aplicar (todas ignoradas).', 'err'); return; }
  busy('Em processamento…');
  try {
    let done = 0;
    const results = new Map();
    await Promise.all(todo.map(async ({ i, p, pr }) => {
      const pages = [];
      for (const k of meshOrder(pr)) { // uma página por malha, da esquerda para a direita
        const { sz, dpi } = photoPlan(pr, k), mesh = pr.meshes[k];
        const { data } = await poolRun(async () => {
          const c = await pageCanvas(p), px = pixelsOf(c); c.width = c.height = 0;
          return { msg: { op: 'warp', img: px.img, mesh, w: sz.w, h: sz.h }, transfer: px.transfer };
        });
        const o = canvasFrom(data, sz.w, sz.h, dpi);
        pages.push(await imgPageFromCanvas(o, dpi, p));
        o.width = o.height = 0;
      }
      setGrid(pages, gridRecord(pr, p));
      results.set(i, pages);
      busyMsg(`Em processamento: ${++done} de ${todo.length} (${pool.size} em paralelo)…`);
    }));
    // as ignoradas também contam para o treino (ex.: capas que não eram para endireitar)
    S.pages.forEach((p) => { const pr = props.get(p.id); if (pr && pr.skip) setGrid([p], gridRecord(pr, p, true)); });
    pushUndo();
    // de trás para a frente: um livro aberto troca uma página por duas e muda os índices seguintes
    const ids = [];
    for (const i of [...results.keys()].sort((a, b) => b - a)) { const n = results.get(i); S.pages.splice(i, 1, ...n); ids.unshift(...n.map((x) => x.id)); }
    S.review = null;
    S.sel = new Set(ids); S.cur = S.pages.findIndex((x) => x.id === ids[0]);
    setTool('pan'); refresh();
    status(`Foto → página aplicado: ${todo.length} foto(s) → ${ids.length} página(s).`, 'ok');
    // ler o texto das páginas do lote (as corrigidas e as ignoradas, que também foram adicionadas)
    const skipped = [...props.values()].filter((pr) => pr.skip).map((pr) => pr.id);
    if (readAfter) await ocrPages([...ids, ...skipped].map((id) => S.pages.findIndex((x) => x.id === id)).filter((i) => i >= 0).sort((a, b) => a - b));
  } catch (e) { status('Foto → página: ' + e.message, 'err'); } finally { idle(); }
}
function cancelReview() {
  if (!S.review) return;
  if ([...S.review.props.values()].some((p) => p.edited) && !confirm(tr('Desistir da revisão? Os ajustes feitos às malhas perdem-se.'))) return;
  S.review = null; setTool('pan'); refresh(false);
  status('Revisão cancelada: nada foi alterado.');
}
// Ajusta o número de workers à memória livre e à maior foto do lote; devolve esse número
async function setPoolFor(pages) {
  await refreshSys();
  const k = (+$('rasterDpi').value || 300) / 72; // páginas PDF: tamanho depois de convertidas
  const kk = (p) => Math.max(k, (p.scanDpi || 0) / 72);
  const mpx = Math.max(12, ...pages.map((p) => (p.kind === 'pdf' ? p.wPt * p.hPt * kk(p) ** 2 : p.w * p.h) / 1e6));
  pool.size = Math.min(workersFor(mpx), pages.length);
  poolNext();
  return pool.size;
}
// ───────────────────────── texto (OCR com Tesseract, no próprio PC) ─────────────────────────
// Cada página lida fica com p.ocr = { text, words: [[texto, x0, y0, x1, y1] em píxeis da imagem], langs, conf }.
// Lê fotos, imagens e PDFs digitalizados (convertidos em imagem); os PDFs digitais já têm texto.
const OCR_LANGS = [['ocrPor', 'por'], ['ocrEng', 'eng'], ['ocrIta', 'ita'], ['ocrSpa', 'spa'], ['ocrFra', 'fra']];
const OCR_NAMES = { por: 'PT', eng: 'EN', ita: 'IT', spa: 'ES', fra: 'FR' };
const ocrLangs = () => OCR_LANGS.filter(([id]) => $(id).checked).map(([, l]) => l).join('+') || 'por';
function ocrWorkers(count) { // ~0,4 GB por worker; respeita "Fotos em paralelo"
  const byMem = Math.max(1, Math.floor((sys.memAvail * 0.75) / 0.4e9));
  return Math.max(1, Math.min(count, sys.cpus - 1, 8, byMem, +$('photoCores').value || 99, pool.cap));
}
// Deteção da língua: lê uma faixa do meio de até 2 páginas com as cinco línguas e conta palavras e terminações típicas.
// Fica a mais provável, e a segunda se tiver pelo menos 60% dos pontos (documentos mistos).
const LANG_CUES = {
  por: { w: 'não são uma para com os do da dos das ao pelo pela mais também está é então como seu sua'.split(' '), re: /(ção|ções|ão|ões)$/ },
  eng: { w: 'the and of to is in that for with are on this be by it from was which or'.split(' '), re: /(ing|tion|ly)$/ },
  // só palavras que não existem em português (as comuns, como "para", "como", "se", davam PT + ES)
  spa: { w: 'el los las es del muy también más pero sus hay esta ese eso'.split(' '), re: /(ción|ciones|ñ)/ },
  fra: { w: 'le les et des du est une pour dans pas sur au qui avec ce sont nous vous'.split(' '), re: /(eau|eaux|ment)$/ },
  ita: { w: 'il che di gli per una non sono del della con nel è anche questo più come'.split(' '), re: /(zione|zioni|mente)$/ },
};
function scoreLangs(text) {
  // palavras de uma letra ficam de fora: o OCR de manuscrito e riscos gera muitos "y", "e", "a" soltos
  const words = (text.toLowerCase().match(/[a-zà-ÿ]+/g) || []).filter((w) => w.length > 1), sc = {};
  for (const [l, c] of Object.entries(LANG_CUES)) {
    const set = new Set(c.w);
    sc[l] = words.reduce((s, w) => s + (set.has(w) ? 1 : 0) + (w.length > 4 && c.re.test(w) ? 0.5 : 0), 0);
  }
  return sc;
}
// Língua(s) de um texto pelas pontuações: a mais provável, e a segunda se tiver ≥ 60% dos pontos; null se houver pouco texto
function pickLangs(total) {
  const order = Object.entries(total).sort((a, b) => b[1] - a[1]);
  if (!order.length || order[0][1] < 3) return null;
  return order.filter(([, s], i) => i === 0 || (i === 1 && s >= order[0][1] * 0.6)).map(([l]) => l).join('+');
}
// Língua de cada página (um manual pode ter uma língua por página): a faixa do meio de cada página é lida com
// as cinco línguas, várias páginas ao mesmo tempo. Devolve Map(índice → línguas); sem texto suficiente fica `fallback`.
async function detectLangsPerPage(items, opts, n, fallback) {
  const sched = Tesseract.createScheduler(), out = new Map();
  try {
    await Promise.all(Array.from({ length: n }, async () => sched.addWorker(await Tesseract.createWorker('por+eng+spa+fra+ita', 1, opts))));
    await Promise.all(items.map(async ({ i, p }) => {
      const bmp = await createImageBitmap(p.blob), y0 = Math.round(bmp.height * 0.3), h = Math.round(bmp.height * 0.35);
      const c = canvas(bmp.width, h); ctx2d(c).drawImage(bmp, 0, -y0); bmp.close(); // faixa do meio da página
      const { data } = await sched.addJob('recognize', c);
      c.width = c.height = 0;
      out.set(i, pickLangs(scoreLangs(data.text)) || fallback);
    }));
  } finally { await sched.terminate(); }
  return out;
}
function runOcrRange() {
  const n = S.pages.length, a = clamp(Math.round(+$('ocFrom').value) || 1, 1, n), b = clamp(Math.round(+$('ocTo').value) || n, 1, n);
  const idxs = [];
  for (let i = Math.min(a, b) - 1; i < Math.max(a, b); i++) idxs.push(i);
  ocrPages(idxs);
}
async function ocrPages(range) {
  const idxs = [];
  for (const i of range) if (S.pages[i].kind === 'img' || (await isScannedPdf(S.pages[i]))) idxs.push(i);
  const vector = range.length - idxs.length;
  if (!idxs.length) { status('Nesse intervalo só há páginas PDF digitais: já têm texto.', 'err'); return; }
  setTool('pan');
  busy('Em processamento…');
  let sched = null;
  try {
    await refreshSys();
    if (!window.Tesseract) await loadScript('lib/tesseract/tesseract.min.js');
    // errorHandler: sem ele, uma falha (ex.: falta o ficheiro de uma língua) rebenta fora do try e a leitura fica parada
    const opts = { workerPath: 'lib/tesseract/worker.min.js', corePath: 'lib/tesseract/', langPath: 'lib/tesseract/', gzip: true, errorHandler: () => {} };
    const items = [];
    for (const i of idxs) { const p = S.pages[i]; items.push({ i, p: p.kind === 'pdf' ? await rasterizeScan(p) : p }); } // digitalização: lê-se a imagem
    const n = ocrWorkers(idxs.length), manual = ocrLangs();
    // língua de cada página, ou a escolhida à mão para todas
    const langsOf = $('ocrDetect').checked ? await detectLangsPerPage(items, opts, n, manual) : new Map(items.map(({ i }) => [i, manual]));
    const groups = new Map(); // páginas agrupadas pela língua: cada grupo é lido com os seus workers
    for (const it of items) { const l = langsOf.get(it.i); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(it); }
    const results = new Map();
    let done = 0, words = 0;
    const msg = () => busyMsg(`Em processamento: ${done} de ${idxs.length} (${n} em paralelo)…`);
    msg();
    for (const [langs, list] of groups) {
      sched = Tesseract.createScheduler();
      await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => sched.addWorker(await Tesseract.createWorker(langs, 1, opts))));
      await Promise.all(list.map(async ({ i, p }) => {
        const { data } = await sched.addJob('recognize', p.blob, {}, { text: true, blocks: true });
        const ws = [];
        for (const b of data.blocks || []) for (const pa of b.paragraphs) for (const l of pa.lines) for (const w of l.words) {
          if (w.text.trim() && w.confidence >= 30) ws.push([w.text, w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1]);
        }
        results.set(i, Object.assign({}, p, { ocr: { text: data.text, words: ws, langs, conf: Math.round(data.confidence) } }));
        words += ws.length; done++; msg();
      }));
      await sched.terminate(); sched = null;
    }
    pushUndo();
    for (const [i, np] of results) S.pages[i] = np;
    refresh(false);
    showTab('text');
    // resumo das línguas: "PT (3), EN + ES (1)"
    const nameOf = (l) => l.split('+').map((x) => OCR_NAMES[x]).join(' + ');
    const summary = [...groups].map(([l, list]) => `${nameOf(l)} (${list.length})`).join(', ');
    const detected = $('ocrDetect').checked ? ` Línguas: ${summary}.` : '';
    status(`Texto lido em ${results.size} página(s), ${words} palavras.` + detected + (vector ? ` ${vector} página(s) PDF digital(is) já tinham texto.` : '') + ' Vê no separador Texto.', 'ok');
    $('ocrLangHint').textContent = $('ocrDetect').checked ? '(última: ' + summary + ')' : '';
  } catch (e) {
    status('Ler texto: ' + e.message, 'err');
  } finally {
    if (sched) sched.terminate(); // liberta a memória dos workers
    idle();
  }
}
function updateTextPane() {
  const p = curPage(), t = $('ocrText');
  if (!t) return;
  t.value = !p ? '' : p.ocr ? p.ocr.text
    : p.kind === 'pdf' && p.scan === false ? '(PDF digital: o texto já está no PDF.)'
      : '(Esta página ainda não foi lida. Usa “Ler texto”.)';
}
function ocrAllText() {
  return S.pages.map((p, i) => (p.ocr ? `--- Página ${i + 1} ---\n${p.ocr.text.trim()}\n` : '')).filter(Boolean).join('\n');
}
async function saveOcrText() {
  const txt = ocrAllText();
  if (!txt) { status('Ainda não há páginas lidas. Usa “Ler texto”.', 'err'); return; }
  try {
    const ch = await api(`choose?name=${encodeURIComponent(defaultName() + '.txt')}&ext=txt&desc=${encodeURIComponent(tr('Texto'))}`);
    if (ch.cancelled) return;
    if (ch.error) throw new Error(ch.error);
    await writeFile(ch.path, new TextEncoder().encode(txt.replace(/\n/g, '\r\n')));
    status('Texto gravado: ' + ch.path, 'ok');
  } catch (e) { status('Gravar texto: ' + e.message, 'err'); }
}
// PDF pesquisável: as palavras lidas ficam por cima da imagem, em texto invisível (modo 3, como no OCRmyPDF)
const safeChars = new Map();
function safeText(font, s) { // só caracteres que a fonte padrão consegue codificar (WinAnsi: inclui os acentos de PT/ES/FR/IT)
  let o = '';
  for (const ch of s) {
    if (!safeChars.has(ch)) { let ok = true; try { font.encodeText(ch); } catch (e) { ok = false; } safeChars.set(ch, ok); }
    o += safeChars.get(ch) ? ch : '?';
  }
  return o;
}
function addTextLayer(pg, p, font) {
  const L = window.PDFLib, key = pg.node.newFontDictionary(font.name, font.ref), k = 72 / p.dpi, H = p.h * k;
  const ops = [L.pushGraphicsState(), L.beginText(), L.setTextRenderingMode(L.TextRenderingMode.Invisible)];
  for (const [t, x0, y0, x1, y1] of p.ocr.words) {
    const s = safeText(font, t);
    if (!s.trim()) continue;
    // largura certa por escala horizontal (Tz); com espaçamento entre letras, quem extrai o texto lê "P r o c e s s o s"
    const size = Math.max(1, (y1 - y0) * k * 0.85), w = font.widthOfTextAtSize(s, size), target = (x1 - x0) * k;
    ops.push(L.setFontAndSize(key, size), L.PDFOperator.of('Tz', [L.PDFNumber.of(clamp((target / (w || 1)) * 100, 10, 1000))]),
      L.setTextMatrix(1, 0, 0, 1, x0 * k, H - y1 * k + (y1 - y0) * k * 0.2), L.showText(font.encodeText(s + ' ')));
  }
  ops.push(L.endText(), L.popGraphicsState());
  pg.pushOperators(...ops);
}

function photoNodeAt(sx, sy) { // ponto da grelha perto do rato (coordenadas do ecrã)
  const ph = S.photo, v = S.vt;
  if (!ph || !ph.mesh || !v) return null;
  let best = null;
  ph.meshes.forEach((m, k) => {
    for (let j = 0; j < m.N; j++) for (let i = 0; i < m.N; i++) {
      const q = Photo.meshNode(m, i, j), d = Math.hypot(v.ox + q[0] * v.s - sx, v.oy + q[1] * v.s - sy);
      if (d < 12 && (!best || d < best.d)) best = { k, i, j, d };
    }
  });
  return best;
}
function photoMeshAt(x, y) { // malha que contém o ponto (coordenadas da imagem); a mais pequena se se sobrepõem
  const ph = S.photo;
  if (!ph || !ph.mesh) return -1;
  let best = -1, bestA = Infinity;
  ph.meshes.forEach((m, k) => {
    const N = m.N, poly = [];
    for (let i = 0; i < N; i++) poly.push(Photo.meshNode(m, i, 0));
    for (let j = 1; j < N; j++) poly.push(Photo.meshNode(m, N - 1, j));
    for (let i = N - 2; i >= 0; i--) poly.push(Photo.meshNode(m, i, N - 1));
    for (let j = N - 2; j > 0; j--) poly.push(Photo.meshNode(m, 0, j));
    let inside = false, area = 0;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const [xa, ya] = poly[a], [xb, yb] = poly[b];
      if ((ya > y) !== (yb > y) && x < xb + (y - yb) * (xa - xb) / (ya - yb)) inside = !inside;
      area += xb * ya - xa * yb;
    }
    area = Math.abs(area / 2);
    if (inside && area < bestA) { best = k; bestA = area; }
  });
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
  if (idx.length > 1 && !confirm(tr(`Apagar ${idx.length} páginas?`))) return;
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
  if (S.dirty && !confirm(tr('Começar um documento novo? As páginas atuais saem da lista (podes desfazer com Ctrl+Z).'))) return;
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
    const rp = S.review && S.review.props.get(p.id); // revisão do lote: esta página tem malha proposta
    if (rp) { const b = document.createElement('span'); b.className = 'badge rv' + (rp.skip ? ' skip' : ''); b.textContent = rp.skip ? '⊘' : '▱'; b.title = rp.skip ? 'Ignorada: fica como está' : 'Malha proposta (por aplicar)'; d.appendChild(b); }
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
    if (s.label) { x.fillStyle = s.prev ? '#7f8896' : '#cfe0ff'; x.font = '12px Segoe UI, sans-serif'; x.textAlign = 'center'; x.fillText(tr(s.label), s.x + s.w / 2, 18); }
    if (!d) { x.fillStyle = '#7f8896'; x.textAlign = 'center'; x.font = '14px Segoe UI'; x.fillText(tr('A carregar…'), s.x + s.w / 2, s.y + s.h / 2); continue; }
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
  if ((S.tool === 'photo' || S.tool === 'review') && S.photo && S.photo.mesh) drawPhotoGrid(x, slot);
  if (S.tool === 'line' && S.line) {
    const l = S.line;
    x.save(); x.strokeStyle = '#ffcc33'; x.lineWidth = 2; x.setLineDash([6, 4]);
    x.beginPath(); x.moveTo(v.ox + l.x0 * v.s, v.oy + l.y0 * v.s); x.lineTo(v.ox + l.x1 * v.s, v.oy + l.y1 * v.s); x.stroke();
    x.restore();
  }
}
function drawPhotoGrid(x, slot) {
  const v = S.vt, ph = S.photo, maps = ph.meshes.map((m) => Photo.meshMapper(m));
  const sc = (q) => [v.ox + q[0] * v.s, v.oy + q[1] * v.s];
  const K = 48, line = (f) => { const q0 = sc(f(0)); x.moveTo(q0[0], q0[1]); for (let k = 1; k <= K; k++) { const q = sc(f(k / K)); x.lineTo(q[0], q[1]); } };
  x.save(); x.beginPath(); x.rect(slot.x, slot.y, slot.w, slot.h); x.clip();
  if (ph.skip) x.globalAlpha = 0.35; // revisão: página ignorada (fica como está)
  // escurece o que fica fora das folhas
  x.beginPath(); x.rect(slot.x, slot.y, slot.w, slot.h);
  for (const map of maps) {
    const outline = [];
    for (let k = 0; k < K; k++) outline.push(map(k / K, 0));
    for (let k = 0; k < K; k++) outline.push(map(1, k / K));
    for (let k = K; k > 0; k--) outline.push(map(k / K, 1));
    for (let k = K; k > 0; k--) outline.push(map(0, k / K));
    outline.forEach((q, k) => { const s = sc(q); if (k) x.lineTo(s[0], s[1]); else x.moveTo(s[0], s[1]); });
    x.closePath();
  }
  x.fillStyle = 'rgba(0,0,0,.5)'; x.fill('evenodd');
  const act = drag && drag.kind === 'node' ? drag : null;
  ph.meshes.forEach((m, mk) => {
    const map = maps[mk], N = m.N, pd = ph.dets[mk];
    // linhas da grelha
    x.beginPath();
    for (let i = 1; i < N - 1; i++) { line((t) => map(i / (N - 1), t)); line((t) => map(t, i / (N - 1))); }
    x.strokeStyle = 'rgba(91,147,245,.75)'; x.lineWidth = 1; x.stroke();
    x.beginPath(); line((t) => map(t, 0)); line((t) => map(1, t)); line((t) => map(t, 1)); line((t) => map(0, t));
    const col = MESH_COLORS[mk % MESH_COLORS.length], on = ph.meshes.length > 1 && mk === ph.active;
    x.strokeStyle = col; x.lineWidth = on ? 4 : 2; x.stroke(); // uma cor por malha (página); a ativa mais grossa
    // análise: onde as linhas de texto foram medidas (verde)
    const ct = pd && pd.content;
    if (S.photoShow && ct && ct.samples) {
      const h = Photo.homography(pd.corners);
      x.fillStyle = ct.apply ? 'rgba(60,220,90,.9)' : 'rgba(255,200,60,.9)';
      for (const [u, vv] of ct.samples) { const s = sc(Photo.applyH(h, u, vv)); x.fillRect(s[0] - 2, s[1] - 2, 4, 4); }
    }
    // pontos (quadrado cheio = posto à mão, fica fixo; duplo clique solta-o)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const s = sc(Photo.meshNode(m, i, j)), corner = (i === 0 || i === N - 1) && (j === 0 || j === N - 1), fixed = Photo.isFixed(m, i, j);
      x.beginPath();
      if (fixed) x.rect(s[0] - 5, s[1] - 5, 10, 10); else x.arc(s[0], s[1], corner ? 7 : 5, 0, Math.PI * 2);
      x.fillStyle = act && act.k === mk && act.i === i && act.j === j ? '#ffcc33' : fixed ? col : '#fff'; x.fill();
      x.strokeStyle = col; x.lineWidth = 2; x.stroke();
    }
  });
  // lupa enquanto se arrasta um ponto
  if (act && v.bmp) {
    const q = Photo.meshNode(ph.meshes[act.k], act.i, act.j), R = 70, Z = 4, cx = slot.x + 16 + R, cy = slot.y + 16 + R;
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
  if (e.button === 0 && (S.tool === 'photo' || S.tool === 'review')) {
    const n = photoNodeAt(b.sx, b.sy);
    if (n) { drag = { kind: 'node', k: n.k, i: n.i, j: n.j }; S.photo.active = n.k; draw(); return; }
  }
  if (e.button === 2 && (S.tool === 'photo' || S.tool === 'review')) return; // clique direito: ver 'contextmenu'
  if (e.button === 1 || S.tool === 'pan' || S.tool === 'photo' || S.tool === 'review') { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: S.panX, py: S.panY }; view.style.cursor = 'grabbing'; return; }
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
// Duplo clique num ponto posto à mão: solta-o (volta a seguir as arestas)
view.addEventListener('dblclick', (e) => {
  if (S.tool !== 'photo' && S.tool !== 'review') return;
  const b = toBmp(e), n = b && photoNodeAt(b.sx, b.sy);
  if (n && Photo.freeNode(S.photo.meshes[n.k], n.i, n.j)) draw();
});
// Clique direito em cima de uma malha: realça-a e pergunta se a remove
view.addEventListener('contextmenu', (e) => {
  if (S.tool !== 'photo' && S.tool !== 'review') return;
  e.preventDefault();
  const b = toBmp(e), ph = S.photo; if (!b || !ph || !ph.mesh) return;
  const k = photoMeshAt(b.x, b.y); if (k < 0) return;
  if (ph.meshes.length <= 1) { removeMesh(); return; } // só mostra o aviso
  ph.active = k; draw();
  setTimeout(() => { if (S.photo === ph && confirm(tr('Remover esta malha (a realçada)?'))) removeMesh(); }, 30);
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
    Photo.dragNode(S.photo.meshes[drag.k], drag.i, drag.j, clamp(b.x, 0, v.w), clamp(b.y, 0, v.h));
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
    else if (S.tool === 'photo' || S.tool === 'review') c = photoNodeAt(b.sx, b.sy) ? 'move' : 'grab';
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
  if (S.review && t !== 'review') { // sair da revisão por outra ferramenta = desistir dela
    if ([...S.review.props.values()].some((p) => p.edited) && !confirm(tr('Desistir da revisão? Os ajustes feitos às malhas perdem-se.'))) return;
    S.review = null; renderThumbs(false);
  }
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
  } else if (t === 'review') {
    const prop = reviewProp(), ids = reviewIds(), k = ids.indexOf(p.id) + 1;
    S.photo = prop;
    const goRel = (d) => { const j = ids.indexOf(p.id), id = ids[j < 0 ? 0 : clamp(j + d, 0, ids.length - 1)]; go(S.pages.findIndex((x) => x.id === id)); };
    tp.innerHTML = (prop ? `<span class="msg">Rever as malhas: página ${k} de ${ids.length}</span>` : '<span class="msg">Esta página não faz parte do lote.</span>') +
      '<button id="rvPrev" title="Página anterior do lote (←)">◀</button><button id="rvNext" title="Página seguinte do lote (→)">▶</button>' +
      (prop ? `<button id="rvSplit">${prop.det.spread ? 'Não dividir esta' : 'Dividir esta (livro aberto)'}</button>` +
        `<button id="rvSkip">${prop.skip ? 'Incluir esta página' : 'Ignorar esta página'}</button>` +
        `<span class="msg" id="phInfo">${prop.skip ? '(ignorada: fica como está)' : photoInfoText(prop)}</span>` : '') +
      (prop ? '<button id="mAdd" title="Acrescentar uma malha (uma página); depois arrasta os cantos para o sítio">＋ Malha</button><button id="mDel" title="Apagar a malha ativa (ou clique direito em cima da malha)">− Malha</button>' : '') +
      '<button id="rvOk" class="primary">Aplicar todas (Enter)</button><button id="rvNo">Cancelar (Esc)</button>';
    $('rvPrev').onclick = () => goRel(-1);
    $('rvNext').onclick = () => goRel(1);
    if (prop) {
      $('rvSplit').onclick = toggleSpread;
      $('rvSkip').onclick = () => { prop.skip = !prop.skip; renderThumbs(false); updateToolPanel(); draw(); };
    }
    if (prop) { $('mAdd').onclick = addMesh; $('mDel').onclick = removeMesh; }
    $('rvOk').onclick = applyReview;
    $('rvNo').onclick = cancelReview;
  } else if (t === 'batch') {
    const n = S.pages.length, sel = selIdx();
    const a = sel.length > 1 ? Math.min(...sel) + 1 : 1, b = sel.length > 1 ? Math.max(...sel) + 1 : n;
    tp.innerHTML = '<span class="msg">Foto → página em lote: da página</span>' +
      `<input type="number" id="btFrom" min="1" max="${n}" value="${a}"><span class="msg">à página</span>` +
      `<input type="number" id="btTo" min="1" max="${n}" value="${b}"><span class="msg">de ${n}</span>` +
      '<button id="btGo" class="primary">Prever malhas (Enter)</button><button id="tNo">Cancelar (Esc)</button>' +
      '<span class="msg">Mostra as malhas de todas para confirmares ou corrigires; só aplica no fim.</span>';
    $('btGo').onclick = runBatch;
  } else if (t === 'ocr') {
    const n = S.pages.length, sel = selIdx();
    const a = sel.length > 1 ? Math.min(...sel) + 1 : 1, b = sel.length > 1 ? Math.max(...sel) + 1 : n;
    tp.innerHTML = '<span class="msg">Ler texto: da página</span>' +
      `<input type="number" id="ocFrom" min="1" max="${n}" value="${a}"><span class="msg">à página</span>` +
      `<input type="number" id="ocTo" min="1" max="${n}" value="${b}"><span class="msg">de ${n} · línguas: ${ocrLangs().split('+').map((l) => OCR_NAMES[l]).join(' + ')}</span>` +
      '<button id="ocGo" class="primary">Ler (Enter)</button><button id="ocLang">Línguas…</button><button id="tNo">Cancelar (Esc)</button>';
    $('ocGo').onclick = runOcrRange;
    $('ocLang').onclick = () => showTab('text');
  } else if (t === 'photo') {
    const ph = S.photo;
    if (ph && ph.id === p.id && ph.vector) { tp.innerHTML = '<span class="msg">PDF digital (texto e vetores): já está direito, não precisa de Foto → página. Serve para fotos e PDFs digitalizados.</span><button id="tNo">Fechar (Esc)</button>'; return; }
    if (!ph || ph.id !== p.id) { if (!ph || !ph.busy) startPhoto(); tp.innerHTML = '<span class="msg">Em processamento…</span>'; return; }
    if (ph.busy) { tp.innerHTML = '<span class="msg">Em processamento…</span>'; return; }
    const custom = $('photoFmt').value === 'custom';
    tp.innerHTML = '<span class="msg">Arrasta os pontos para as bordas da folha (Ctrl+roda para aproximar).</span>' +
      `<span class="msg">Grelha</span><select id="phN">${$('photoN').innerHTML}</select>` +
      `<span class="msg">Formato</span><select id="phF">${$('photoFmt').innerHTML}</select>` +
      (custom ? `<input type="number" id="phW" min="10" max="2000" step="0.5" value="${$('photoW').value}"><span class="msg">×</span><input type="number" id="phH" min="10" max="2000" step="0.5" value="${$('photoH').value}"><span class="msg">mm</span>` : '') +
      `<span class="msg" id="phInfo">${photoInfoText(ph)}</span>` +
      `<span class="msg">· confiança ${ph.det.quality.level}${photoContentText(ph.det.content)}</span>` +
      `<label class="msg"><input type="checkbox" id="phShow"${S.photoShow ? ' checked' : ''}> mostrar análise</label>` +
      '<button id="mAdd" title="Acrescentar uma malha (uma página); depois arrasta os cantos para o sítio">＋ Malha</button><button id="mDel" title="Apagar a malha ativa (ou clique direito em cima da malha)">− Malha</button>' +
      '<button id="phOk" class="primary">Aplicar (Enter)</button><button id="phRe">Detetar de novo</button><button id="phNo">Cancelar (Esc)</button>';
    $('phN').value = String(ph.mesh.N); $('phF').value = $('photoFmt').value;
    $('phN').onchange = (e) => { $('photoN').value = e.target.value; saveSettings(); regridPhoto(+e.target.value); updateToolPanel(); draw(); };
    $('phF').onchange = (e) => { $('photoFmt').value = e.target.value; updatePhotoCustom(); saveSettings(); updateToolPanel(); };
    if (custom) for (const [a, b] of [['phW', 'photoW'], ['phH', 'photoH']]) $(a).oninput = (e) => { $(b).value = e.target.value; saveSettings(); $('phInfo').textContent = photoInfoText(ph); };
    $('phShow').onchange = (e) => { S.photoShow = e.target.checked; draw(); };
    $('mAdd').onclick = addMesh; $('mDel').onclick = removeMesh;
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
// dpiOut: 0 = igual à original, −1 = nativa (sem alteração), > 0 = reduzir até esse valor
const NATIVE = -1;
// Imagem original da página, sem reamostrar nem recomprimir (para a resolução nativa), se o formato servir
async function nativeBytes(p, types) {
  if (p.kind !== 'img' || !types.some((t) => p.blob.type === t)) return null;
  return new Uint8Array(await p.blob.arrayBuffer());
}
async function exportCanvas(p, dpiOut) {
  if (p.kind === 'pdf') {
    const dpi = dpiOut > 0 ? dpiOut : +$('rasterDpi').value || 300;
    return { c: await renderPdf(p, dpi / 72), dpi };
  }
  let dpi = p.dpi;
  if (dpiOut > 0 && dpiOut < p.dpi - 0.5) {
    dpi = dpiOut;
    const w = Math.max(1, Math.round(p.w * dpi / p.dpi)), h = Math.max(1, Math.round(p.h * dpi / p.dpi));
    const bmp = await createImageBitmap(p.blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    const c = canvas(w, h); ctx2d(c).drawImage(bmp, 0, 0); bmp.close();
    return { c, dpi };
  }
  return { c: await pageCanvas(p), dpi };
}
async function buildPdf(list, dpiOut, q, keepVector, lossless, searchable = $('searchable').checked) {
  let font = null; // fonte da camada de texto (só se houver páginas lidas)
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
      const sz = pageSizePts(p);
      let img;
      const orig = dpiOut === NATIVE ? await nativeBytes(p, ['image/jpeg', 'image/png']) : null;
      if (orig) img = p.blob.type === 'image/jpeg' ? await out.embedJpg(orig) : await out.embedPng(orig); // tal como está
      else {
        const { c } = await exportCanvas(p, dpiOut);
        if (lossless) img = await out.embedPng(new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer()));
        else img = await out.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', q)).arrayBuffer()));
        c.width = c.height = 0;
      }
      const pg = out.addPage([sz.w, sz.h]);
      pg.drawImage(img, { x: 0, y: 0, width: sz.w, height: sz.h });
      if (searchable && p.kind === 'img' && p.ocr && p.ocr.words.length) {
        if (!font) font = await out.embedFont(window.PDFLib.StandardFonts.Helvetica);
        addTextLayer(pg, p, font);
      }
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
  const orig = dpiOut === NATIVE ? await nativeBytes(p, [fmt === 'jpg' ? 'image/jpeg' : 'image/png']) : null;
  if (orig) return fmt === 'jpg' ? setJpegDpi(orig, p.dpi) : orig; // ficheiro original, só com os ppp
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
    ch = await api(`choose?name=${encodeURIComponent(defaultName() + '.' + fmt)}&ext=${fmt}&desc=${encodeURIComponent(tr(desc))}`);
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
    // malhas proposta e editada das páginas corrigidas + fotos originais (dados para treinar a deteção), sempre ao lado
    let grid = '';
    try { const g = await writeTrainingZip(ch.path, list); if (g) grid = ' + ' + g.split(/[\\/]/).pop(); } catch (e) { console.warn('treino.zip', e); }
    S.dirty = false; syncUnsaved();
    const first = written[0];
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    status(`${ch.note ? esc(ch.note) + ' ' : ''}Exportado: ${esc(written.length === 1 ? first : written.length + ' ficheiros em ' + ch.dir)}${esc(grid)} — <a id="lnkReveal">mostrar na pasta</a>`, 'ok', true);
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
      const d = +$('dpiOut').value, t = d > 0 && d < p.dpi ? d : p.dpi;
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
  for (const id of ['bExport', 'bExport2', 'bDel', 'bDup', 'bRotL', 'bRotR', 'bAuto', 'bRescan', 'bSelAll', 'bNew', 'bPhotoBatch', 'bOcr', 'bOcr2']) $(id).disabled = !n;
  updateTextPane();
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
const SET_FIELDS = ['src', 'mode', 'dpiIn', 'area', 'bright', 'contrast', 'fmt', 'scope', 'dpiOut', 'quality', 'rasterDpi', 'photoN', 'photoFmt', 'photoW', 'photoH', 'photoCores', 'uiLang', 'photoSpread'];
const SET_CHECKS = ['keepVector', 'lossless', 'photoAuto', 'searchable', 'ocrPor', 'ocrEng', 'ocrIta', 'ocrSpa', 'ocrFra', 'ocrOnAdd', 'ocrDetect'];
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
// Língua da interface (PT / EN): traduz a página e diz ao programa em Go (aviso ao fechar, "Guardar como")
function applyUiLang(l) {
  setLang(l);
  api('lang?l=' + l, { method: 'POST' }).catch(() => {});
  draw();
}
on('uiLang', 'change', (e) => { applyUiLang(e.target.value); saveSettings(); refresh(false); });
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'pane-' + name));
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
on('bOcr', 'click', () => setTool('ocr'));
on('bOcr2', 'click', () => setTool('ocr'));
on('bOcrSave', 'click', saveOcrText);
on('bOcrCopy', 'click', async () => {
  try { await navigator.clipboard.writeText($('ocrText').value); status('Texto copiado.', 'ok'); }
  catch (e) { $('ocrText').select(); document.execCommand('copy'); status('Texto copiado.', 'ok'); }
});
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
    if (k === 'Enter' && S.tool === 'ocr') runOcrRange();
    if (k === 'Escape') { e.target.blur(); if (S.tool === 'review') cancelReview(); else setTool('pan'); }
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
    case 'Enter': if (S.tool === 'crop') applyCrop(); else if (S.tool === 'angle') rotateAngle(S.angle); else if (S.tool === 'photo') applyPhoto(); else if (S.tool === 'batch') runBatch(); else if (S.tool === 'ocr') runOcrRange(); else if (S.tool === 'review') applyReview(); break;
    case 'p': case 'P': setTool(e.shiftKey ? 'batch' : 'photo'); break;
    case 'o': case 'O': setTool('ocr'); break;
    case 'Escape': if (S.tool === 'review') cancelReview(); else setTool('pan'); break;
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
  // língua da interface: a guardada, ou a do sistema (português → PT, outras → EN)
  const ui = settings.uiLang || ((navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en');
  $('uiLang').value = ui;
  applyUiLang(ui);
  startTranslation();
  refreshSys();
  refresh();
  await checkDeps();
  await loadDevices();
})();

// para testes
window.__S = S;
window.__addFiles = addFiles;
window.__buildPdf = buildPdf; window.__writeTrainingZip = writeTrainingZip;
window.__pdfjs = pdfjsLib;
