// Pagloom — fotos → página num núcleo à parte (Web Worker). Cada worker tem o seu OpenCV.
// Mensagens: { id, op: 'detect', img, spread } → { det }   (det.spread: livro aberto, det.pages = [esquerda, direita])
//            { id, op: 'warp', img, mesh, w, h } → { data }
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
      const det = P.detectPage(cv, e.data.img, undefined, { spread: e.data.spread !== false });
      delete det.cands;
      self.postMessage({ id, det });
    } else if (op === 'warp') {
      const { img, mesh, w, h } = e.data;
      const data = P.warpPage(cv, img, mesh, w, h);
      self.postMessage({ id, data }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  }
};
