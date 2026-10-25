// Pagloom — fotos → página num núcleo à parte (Web Worker). Cada worker tem o seu OpenCV.
// Mensagens: { id, op: 'detect', img } → { det }
//            { id, op: 'warp', img, mesh, w, h } → { data }
//            { id, op: 'auto', img, N, fmt, custom } → { found, data, plan }
// img = { data: Uint8ClampedArray RGBA, width, height }. Em caso de erro: { id, error }.
importScripts('lib/opencv.js');
// O OpenCV.js é "thenable": nunca resolver uma promessa com ele (fica em ciclo).
const ready = new Promise((res) => { if (self.cv.Mat) res(); else self.cv.onRuntimeInitialized = () => res(); });
let P = null;

self.onmessage = async (e) => {
  const { id, op } = e.data;
  try {
    await ready;
    if (!P) P = await import('./photo.js');
    const cv = self.cv;
    if (op === 'detect') {
      const det = P.detectPage(cv, e.data.img);
      delete det.cands;
      self.postMessage({ id, det });
    } else if (op === 'warp') {
      const { img, mesh, w, h } = e.data;
      const data = P.warpPage(cv, img, mesh, w, h);
      self.postMessage({ id, data }, [data.buffer]);
    } else if (op === 'auto') { // não aplica nada se a confiança for baixa
      const { img, N, fmt, custom } = e.data;
      const det = P.detectPage(cv, img);
      if (!det.found || det.quality.level === 'baixa') { self.postMessage({ id, found: false, quality: det.quality }); return; }
      const mesh = P.buildMesh(det, N), plan = P.planPage(mesh, img.width, img.height, fmt, custom);
      const data = P.warpPage(cv, img, mesh, plan.sz.w, plan.sz.h);
      self.postMessage({ id, found: true, data, plan, quality: det.quality }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  }
};
