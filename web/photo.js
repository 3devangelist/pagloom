// Pagloom — fotos do telefone → página
// Deteção da folha e das bordas (em resolução total), grelha N×N de pontos e correção da perspetiva e da curvatura.
// Funções sem DOM: recebem o OpenCV.js (cv) e imagens { data: RGBA, width, height }.
//
// Modelo: a página é o quadrado (u, v) ∈ [0,1]². Um ponto da página vai para a foto por
//   P(u, v) = H(u, v) + D(u, v)
// H é a homografia dos 4 cantos (perspetiva). D é o desvio residual (curvatura da folha, lente),
// interpolado de forma suave (Catmull-Rom bicúbico) a partir dos desvios dos N×N pontos da grelha.

const odd = (v) => { v = Math.max(3, Math.round(v)); return v % 2 ? v : v + 1; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ───────────────────────── álgebra ─────────────────────────
function solve(A, b) { // eliminação de Gauss com pivô parcial
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

// Homografia do quadrado unitário (0,0) (1,0) (1,1) (0,1) para os cantos tl, tr, br, bl
export function homography(c) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]], A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = c[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const h = solve(A, b); h.push(1);
  return h;
}
export function applyH(h, u, v) {
  const w = h[6] * u + h[7] * v + h[8];
  return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
}
function polyArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i], n = q[(i + 1) % q.length]; a += p[0] * n[1] - n[0] * p[1]; }
  return Math.abs(a) / 2;
}
// Ordena 4 pontos como tl, tr, br, bl
function orderQuad(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const q = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let k = 0;
  for (let i = 1; i < 4; i++) if (q[i][0] + q[i][1] < q[k][0] + q[k][1]) k = i;
  return [0, 1, 2, 3].map((i) => q[(k + i) % 4]);
}
function convexOk(q) {
  let sgn = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (!sgn) sgn = Math.sign(z); else if (Math.sign(z) !== sgn) return false;
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const ang = Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1), -1, 1)) * 180 / Math.PI;
    if (ang < 35 || ang > 145) return false;
  }
  return true;
}

// ───────────────────────── amostragem ─────────────────────────
function sampler(G, W, H) {
  return (x, y) => {
    x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001);
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return (G[i] * (1 - fx) + G[i + 1] * fx) * (1 - fy) + (G[i + W] * (1 - fx) + G[i + W + 1] * fx) * fy;
  };
}
function sideGeom(A, B) {
  const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
  return { A, B, L, d: [dx / L, dy / L], n: [-dy / L, dx / L] }; // n aponta para dentro (cantos no sentido horário)
}

// Procura a aresta da folha ao longo da normal, em M pontos do lado A→B.
// sign = +1 se a folha é mais clara que o fundo. Fica com a resposta forte mais exterior
// (para não confundir a aresta da folha com o texto perto da margem).
// pred(t) = desvio previsto (da passagem anterior); a procura é feita à volta dele.
// ok(x, y, n) = o lado de dentro de (x, y) parece papel (liso e claro). Serve para fundos com textura
// (renda, madeira com veios): fica a aresta mais exterior que tem papel por dentro.
function searchSide(at, g, R, sign, M = 56, pred = () => 0, ok = null) {
  const out = [];
  for (let m = 0; m < M; m++) {
    const t = 0.03 + 0.94 * m / (M - 1), s0 = pred(t);
    const bx = g.A[0] + (g.B[0] - g.A[0]) * t + s0 * g.n[0], by = g.A[1] + (g.B[1] - g.A[1]) * t + s0 * g.n[1];
    const n = g.n, steps = Math.ceil(R), d = new Float32Array(2 * steps + 1);
    let dmax = 0;
    for (let s = -steps; s <= steps; s++) {
      const v = sign * (at(bx + (s + 1) * n[0], by + (s + 1) * n[1]) - at(bx + (s - 1) * n[0], by + (s - 1) * n[1]));
      d[s + steps] = v; if (v > dmax) dmax = v;
    }
    if (dmax < 8) continue; // sem contraste
    let k = -1;
    if (ok) {
      for (let i = 1; i < d.length - 1; i++) {
        if (d[i] < 0.25 * dmax || d[i] < 8 || d[i] < d[i - 1] || d[i] < d[i + 1]) continue;
        const s = i - steps;
        if (ok(bx + s * n[0], by + s * n[1], n)) { k = i; break; }
      }
    } else {
      for (let i = 1; i < d.length - 1; i++) if (d[i] >= 0.6 * dmax && d[i] >= d[i - 1] && d[i] >= d[i + 1]) { k = i; break; }
    }
    if (k < 0) continue;
    const a = d[k - 1], b = d[k], c = d[k + 1], den = a - 2 * b + c;
    const off = den < 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
    out.push({ t, s: s0 + k - steps + off, w: d[k] });
  }
  return out;
}

// Ajuste robusto (mínimos quadrados repesados, peso de Tukey) de s(t) = Σ c_k · f_k(t)
// floor = ruído mínimo esperado, nas unidades de s (píxeis nas arestas)
function robustFit(samples, basis, floor = 0.3) {
  const K = basis.length;
  if (samples.length < K + 2) return null;
  const med = samples.map((p) => p.w).sort((a, b) => a - b)[samples.length >> 1];
  const pts = samples.filter((p) => p.w >= 0.3 * med);
  if (pts.length < K + 2) return null;
  let w = pts.map(() => 1), coef = new Array(K).fill(0);
  for (let it = 0; it < 8; it++) {
    const A = Array.from({ length: K }, () => new Array(K).fill(0)), b = new Array(K).fill(0);
    pts.forEach((p, i) => {
      const f = basis.map((fn) => fn(p.t));
      for (let r = 0; r < K; r++) { b[r] += w[i] * f[r] * p.s; for (let c = 0; c < K; c++) A[r][c] += w[i] * f[r] * f[c]; }
    });
    for (let r = 0; r < K; r++) A[r][r] += 1e-6;
    coef = solve(A, b);
    const res = pts.map((p) => p.s - basis.reduce((s, fn, k) => s + coef[k] * fn(p.t), 0));
    const mad = res.map(Math.abs).sort((a, b) => a - b)[res.length >> 1] * 1.4826 + floor;
    const c = 4.685 * mad;
    w = res.map((r) => (Math.abs(r) < c ? (1 - (r / c) ** 2) ** 2 : 0));
  }
  return coef;
}
// Graus baixos de propósito: mais termos dobram a curva onde há riscos perto da borda
const BASIS_FREE = [() => 1, (t) => t, (t) => t * t, (t) => t ** 3];
const BASIS_LINE = [() => 1, (t) => t];
const evalFit = (coef, basis, t) => (coef ? basis.reduce((s, fn, k) => s + coef[k] * fn(t), 0) : 0);

function intersect(p1, d1, p2, d2) {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

// A partir de um quadrilátero aproximado, encontra as arestas reais (curvas) e os cantos.
function refineEdges(at, quad, ok = null) {
  let C = quad.map((p) => p.slice());
  // claro/escuro: compara dentro e fora da folha
  let inside = 0, outside = 0;
  for (let k = 0; k < 4; k++) {
    const g = sideGeom(C[k], C[(k + 1) % 4]), r = Math.max(6, 0.02 * g.L);
    for (let m = 1; m < 10; m++) {
      const bx = g.A[0] + (g.B[0] - g.A[0]) * m / 10, by = g.A[1] + (g.B[1] - g.A[1]) * m / 10;
      inside += at(bx + r * g.n[0], by + r * g.n[1]); outside += at(bx - r * g.n[0], by - r * g.n[1]);
    }
  }
  const sign = inside >= outside ? 1 : -1;
  // Cada lado: procura larga à volta do segmento, depois estreita à volta do que encontrou; a reta final
  // usa só o troço central (15–85%), para as dobras e os cantos em falta não a puxarem.
  const fitLine = (g) => {
    const c0 = robustFit(searchSide(at, g, Math.max(12, 0.05 * g.L), sign, 56, undefined, ok), BASIS_FREE);
    const all = searchSide(at, g, Math.max(5, 0.006 * g.L), sign, 72, (t) => evalFit(c0, BASIS_FREE, t), ok);
    const smp = all.filter((p) => p.t > 0.15 && p.t < 0.85);
    const c = robustFit(smp, BASIS_LINE) || [0, 0];
    return { g, p: [g.A[0] + c[0] * g.n[0], g.A[1] + c[0] * g.n[1]], d: [g.B[0] - g.A[0] + c[1] * g.n[0], g.B[1] - g.A[1] + c[1] * g.n[1]], n: smp.length, curve: robustFit(all, BASIS_FREE) || c0 };
  };
  const meet = (Cs, a, b, k, pa, pb) => {
    const x = intersect(pa.p, pa.d, pb.p, pb.d);
    return x && Math.hypot(x[0] - Cs[k][0], x[1] - Cs[k][1]) < 0.15 * a.g.L ? x : Cs[k];
  };
  let lines = [];
  for (let it = 0; it < 3; it++) {
    lines = [0, 1, 2, 3].map((k) => fitLine(sideGeom(C[k], C[(k + 1) % 4])));
    // canto = cruzamento das duas retas (num canto dobrado, fica onde a folha teria o canto)
    C = C.map((c, k) => meet(C, lines[(k + 3) % 4], lines[k], k, lines[(k + 3) % 4], lines[k]));
  }
  // alternativa para folhas curvadas: canto no fim das bordas curvas (cruzamento das tangentes nas pontas)
  const end = (l, t) => {
    const g = l.g, s = evalFit(l.curve, BASIS_FREE, t), ds = (evalFit(l.curve, BASIS_FREE, t + 1e-4) - evalFit(l.curve, BASIS_FREE, t - 1e-4)) / 2e-4;
    return { p: [g.A[0] + (g.B[0] - g.A[0]) * t + s * g.n[0], g.A[1] + (g.B[1] - g.A[1]) * t + s * g.n[1]], d: [g.B[0] - g.A[0] + ds * g.n[0], g.B[1] - g.A[1] + ds * g.n[1]] };
  };
  const curved = C.map((c, k) => meet(C, lines[(k + 3) % 4], lines[k], k, end(lines[(k + 3) % 4], 1), end(lines[k], 0)));
  return { corners: C, curved, sign, edgeSamples: lines.map((l) => l.n) };
}

// Força média das arestas ao longo de um quadrilátero (para escolher o melhor candidato)
// Os lados encostados à margem da foto não contam (aí não há aresta da folha, só o fim da imagem).
// reach = distância extra a procurar para fora (o mapa de papel fica recolhido meia janela de textura)
function edgeSupport(at, q, W, H, reach = 0) {
  let tot = 0, n = 0;
  const e = 0.005 * Math.max(W, H);
  for (let k = 0; k < 4; k++) {
    const g = sideGeom(q[k], q[(k + 1) % 4]), r = Math.max(4, 0.006 * g.L) + reach;
    for (let m = 1; m < 24; m++) {
      const t = m / 24, bx = g.A[0] + (g.B[0] - g.A[0]) * t, by = g.A[1] + (g.B[1] - g.A[1]) * t;
      n++;
      if (bx < e || by < e || bx > W - e || by > H - e) continue;
      let best = 0;
      for (let s = -r; s <= r; s += 1) best = Math.max(best, Math.abs(at(bx + (s + 2) * g.n[0], by + (s + 2) * g.n[1]) - at(bx + (s - 2) * g.n[0], by + (s - 2) * g.n[1])));
      tot += best;
    }
  }
  return tot / n;
}
// Margens: fração da faixa logo dentro das bordas que é lisa (papel). Num quadrilátero que apanhou fundo
// com textura, essa faixa cai no fundo. thr = limite de textura do papel, medido no interior.
function marginStats(tex, W, H, q, inset) {
  const h = homography(q), vals = [];
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const p = applyH(h, 0.06 + 0.88 * i / 15, 0.06 + 0.88 * j / 15);
    vals.push(tex[clamp(Math.round(p[1]), 0, H - 1) * W + clamp(Math.round(p[0]), 0, W - 1)]);
  }
  vals.sort((a, b) => a - b);
  const thr = clamp(2.5 * vals[Math.floor(vals.length * 0.2)], 12, 30); // papel liso (margens, entre linhas)
  let good = 0, n = 0;
  for (let k = 0; k < 4; k++) {
    const g = sideGeom(q[k], q[(k + 1) % 4]);
    for (let m = 1; m < 32; m++) {
      const t = m / 32, x = g.A[0] + (g.B[0] - g.A[0]) * t + inset * g.n[0], y = g.A[1] + (g.B[1] - g.A[1]) * t + inset * g.n[1];
      n++;
      if (tex[clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)] < thr) good++;
    }
  }
  return { margin: good / n, thr };
}
function otsu(arr, step = 7) { // limiar de Otsu de um Uint8Array (amostrado)
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < arr.length; i += step) { hist[arr[i]]++; n++; }
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v];
  let w0 = 0, s0 = 0, best = 0, t = 128;
  for (let v = 0; v < 256; v++) {
    w0 += hist[v]; if (!w0 || w0 === n) continue;
    s0 += v * hist[v];
    const m0 = s0 / w0, m1 = (sum - s0) / (n - w0), b = w0 * (n - w0) * (m0 - m1) ** 2;
    if (b > best) { best = b; t = v; }
  }
  return t;
}

// ───────────────────────── deteção ─────────────────────────
function quadOfContour(cv, cnt) {
  const hull = new cv.Mat(), ap = new cv.Mat();
  try {
    cv.convexHull(cnt, hull, false, true);
    const peri = cv.arcLength(hull, true);
    for (let e = 0.01; e <= 0.1; e += 0.005) {
      cv.approxPolyDP(hull, ap, e * peri, true);
      if (ap.rows === 4) { const d = ap.data32S; return orderQuad([[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]]); }
      if (ap.rows < 4) break;
    }
    // cantos arredondados: pontos extremos do invólucro
    const d = hull.data32S, P = [];
    for (let i = 0; i < d.length; i += 2) P.push([d[i], d[i + 1]]);
    const ext = (f) => P.reduce((a, b) => (f(b) > f(a) ? b : a));
    return orderQuad([ext((p) => -p[0] - p[1]), ext((p) => p[0] - p[1]), ext((p) => p[0] + p[1]), ext((p) => p[1] - p[0])]);
  } finally { hull.delete(); ap.delete(); }
}
function quadsFrom(cv, bin, minArea, out, tag) {
  const cs = new cv.MatVector(), hi = new cv.Mat();
  cv.findContours(bin, cs, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  for (let i = 0; i < cs.size(); i++) {
    const c = cs.get(i), a = cv.contourArea(c);
    if (a >= minArea) {
      const q = quadOfContour(cv, c), qa = polyArea(q);
      if (qa > 0 && convexOk(q)) out.push({ quad: q, area: qa, fit: Math.min(a / qa, qa / a), tag });
    }
    c.delete();
  }
  cs.delete(); hi.delete();
}

// Deteta a folha numa foto. Trabalha na resolução total da foto.
// Devolve { found, corners (tl, tr, br, bl), sides (desvios das arestas), score }.
export function detectPage(cv, img, progress = () => {}) {
  const W = img.width, H = img.height, D = Math.max(W, H), px = img.data;
  // dois mapas: cinzento e "brancura" (mínimo de R, G, B — o papel é claro e sem cor)
  const gray = new Uint8Array(W * H), white = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    gray[j] = (r * 77 + g * 150 + b * 29) >> 8;
    white[j] = Math.min(r, g, b);
  }
  const cands = [], maps = {};
  const kB = odd(D / 300), kM = odd(D / 150), kE = odd(D / 400), kR = odd(D / 1000), kT = odd(D / 50), kP = odd(D / 60);
  // textura local (desvio-padrão numa janela kT): o papel é liso; renda, tecido e veios da madeira não
  progress('A medir a textura…');
  const tex = new Uint8Array(W * H), mean = new Uint8Array(W * H), paper = new Uint8Array(W * H);
  {
    const g8 = new cv.Mat(H, W, cv.CV_8UC1); g8.data.set(gray);
    const gf = new cv.Mat(), g2 = new cv.Mat(), mu = new cv.Mat(), sq = new cv.Mat(), sz = new cv.Size(kT, kT);
    g8.convertTo(gf, cv.CV_32F); g8.delete();
    cv.multiply(gf, gf, g2);
    cv.blur(gf, mu, sz); cv.blur(g2, sq, sz); gf.delete(); g2.delete();
    const M = mu.data32F, Q = sq.data32F;
    for (let i = 0; i < tex.length; i++) {
      const sd = Math.sqrt(Math.max(0, Q[i] - M[i] * M[i]));
      tex[i] = sd > 255 ? 255 : sd; mean[i] = M[i];
    }
    mu.delete(); sq.delete();
    // papel = liso e claro (limites tirados da própria foto)
    const tT = clamp(otsu(tex), 10, 30), gT = 0.75 * otsu(mean);
    for (let i = 0; i < paper.length; i++) paper[i] = tex[i] < tT && mean[i] > gT ? 255 : 0;
  }
  const maxs = [['gray', gray], ['white', white], ['paper', paper]];
  maxs.forEach(([name, arr], n) => {
    progress(`A procurar a folha (${n + 1}/${maxs.length})…`);
    const m = new cv.Mat(H, W, cv.CV_8UC1); m.data.set(arr);
    if (name !== 'paper') { const fine = new cv.Mat(); cv.GaussianBlur(m, fine, new cv.Size(kR, kR), 0); maps[name] = fine.data.slice(); fine.delete(); }
    const blur = new cv.Mat(), bin = new cv.Mat();
    cv.GaussianBlur(m, blur, new cv.Size(kB, kB), 0); m.delete();
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    const kerM = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(name === 'paper' ? kP : kM, name === 'paper' ? kP : kM));
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kerM); cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kerM);
    quadsFrom(cv, bin, 0.08 * W * H, cands, name);
    if (name !== 'paper') {
      const edges = new cv.Mat(), kerE = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kE, kE));
      cv.Canny(blur, edges, 20, 60);
      cv.dilate(edges, edges, kerE);
      quadsFrom(cv, edges, 0.08 * W * H, cands, name);
      edges.delete(); kerE.delete();
    }
    blur.delete(); bin.delete(); kerM.delete();
  });
  progress('A ajustar as bordas…');
  let best = null;
  for (const c of cands) {
    const at = sampler(maps[c.tag === 'paper' ? 'gray' : c.tag], W, H);
    c.support = edgeSupport(at, c.quad, W, H, c.tag === 'paper' ? kT / 2 + 8 : 0);
    c.inside = marginStats(tex, W, H, c.quad, kT / 2 + 3);
    c.score = Math.sqrt(c.area / (W * H)) * c.fit * c.fit * c.support * c.inside.margin ** 2;
    if (!best || c.score > best.score) best = c;
  }
  const summary = () => cands.map((c) => ({ tag: c.tag, score: +c.score.toFixed(1), support: +c.support.toFixed(1), margin: +c.inside.margin.toFixed(2), fit: +c.fit.toFixed(2), area: +(c.area / (W * H)).toFixed(2), quad: c.quad.map((p) => p.map(Math.round)) }));
  if (!best || best.support < 10 || best.inside.margin < 0.4) {
    const m = 0.05;
    return {
      found: false, corners: [[W * m, H * m], [W * (1 - m), H * m], [W * (1 - m), H * (1 - m)], [W * m, H * (1 - m)]], score: 0, content: null,
      quality: { level: 'baixa', why: ['folha não encontrada: arrasta os cantos'] }, cands: summary(),
    };
  }
  // a aresta certa tem papel liso logo do lado de dentro
  const q = kT / 2 + 3, thr = best.inside.thr;
  const ok = (x, y, n) => tex[clamp(Math.round(y + q * n[1]), 0, H - 1) * W + clamp(Math.round(x + q * n[0]), 0, W - 1)] < thr;
  const tag = best.tag === 'paper' ? 'gray' : best.tag;
  const r = refineEdges(sampler(maps[tag], W, H), best.quad, ok);
  progress('A analisar o conteúdo…');
  const det = { found: true, corners: r.corners, score: best.score, map: best.tag, margin: best.inside.margin, support: best.support, edgeSamples: r.edgeSamples };
  det.content = analyzeContent(cv, img, r.corners);
  // As linhas confirmam que a folha está curvada? Então os cantos certos são os fins das bordas curvas
  // (com as retas centrais, a "barriga" da curva deslocava a página). Sem curvatura ficam as retas (dobras não puxam).
  if (det.content.apply && det.content.model >= 2) {
    const moved = Math.max(...r.curved.map((c, k) => Math.hypot(c[0] - r.corners[k][0], c[1] - r.corners[k][1])));
    if (moved > 0.002 * D) {
      const ct2 = analyzeContent(cv, img, r.curved);
      if (ct2.coverage >= 0.4 && ct2.rms <= det.content.rms * 1.2 + 0.05) { det.corners = r.curved; det.content = ct2; det.curved = true; }
    }
  }
  det.quality = assessQuality(det, W, H);
  det.cands = summary();
  return det;
}

// ───────────────────────── conteúdo ─────────────────────────
// As linhas de texto e as linhas impressas eram retas e horizontais no papel; margens, colunas e linhas de
// tabelas eram retas e verticais. Depois de endireitar só pela perspetiva (4 cantos), mede-se o que ainda falta:
//   δv(u, v): quanto as linhas sobem ou descem ao longo da largura (fração da altura)
//   δu(u, v): quanto as estruturas verticais fogem para os lados ao longo da altura (fração da largura)
// Para cada eixo, modelos do mais simples ao mais complexo (a = posição ao longo da linha − centro, b = a outra):
//   0: nada · 1: inclinação / perspetiva residual (a, a·b) · 2: + curvatura (a², a²·b) · 3: + assimetria (a³, a³·b)
// Fica o modelo mais simples que explica as medidas; só se aplica se melhorar de forma clara.
// A correção conta em relação às bordas (média das duas pontas), não ao centro: as linhas ficam direitas e a
// página não se desloca pela "barriga" de uma curva.
const CONTENT_BASIS = [(t) => t[0], (t) => t[0] * t[1], (t) => t[0] ** 2, (t) => t[0] ** 2 * t[1], (t) => t[0] ** 3, (t) => t[0] ** 3 * t[1]];
function axisRaw(coef, c, a, b) {
  const t = [a - c, b];
  let s = 0;
  for (let k = 0; k < coef.length; k++) s += coef[k] * CONTENT_BASIS[k](t);
  return s;
}
const axisRel = (coef, c, a, b) => axisRaw(coef, c, a, b) - 0.5 * (axisRaw(coef, c, 0, b) + axisRaw(coef, c, 1, b));
export function contentDv(ct, u, v) { return ct && ct.v && ct.v.apply ? axisRel(ct.v.coef, ct.v.c, u, v) : 0; }
export function contentDu(ct, u, v) { return ct && ct.u && ct.u.apply ? axisRel(ct.u.coef, ct.u.c, v, u) : 0; }

// Desvios entre faixas vizinhas, por janelas, com correlação normalizada dos perfis de tinta.
// along = 'x': faixas verticais, perfil ao longo de y (linhas horizontais); 'y': faixas horizontais, perfil ao longo de x.
function measureAxis(ink, RW, RH, along) {
  const LA = along === 'x' ? RW : RH, LP = along === 'x' ? RH : RW;
  const px = along === 'x' ? (a, p) => ink[p * RW + a] : (a, p) => ink[a * RW + p];
  const K = 12, a0 = 0.06 * LA, sw = (0.88 * LA) / K, prof = [];
  for (let k = 0; k < K; k++) {
    const lo = Math.round(a0 + k * sw), hi = Math.round(a0 + (k + 1) * sw), P = new Float32Array(LP), Q = new Float32Array(LP);
    for (let p = 0; p < LP; p++) { let s = 0; for (let a = lo; a < hi; a++) s += px(a, p); P[p] = s / (hi - lo); }
    for (let p = 2; p < LP - 2; p++) Q[p] = (P[p - 2] + 2 * P[p - 1] + 3 * P[p] + 2 * P[p + 1] + P[p + 2]) / 9;
    prof.push(Q);
  }
  const win = Math.round(LP * 0.07), step = Math.round(win / 3), S = Math.max(4, Math.round(LP * 0.008));
  const nw = Math.floor((LP - win - 2 * S) / step), shift = [];
  for (let k = 0; k < K - 1; k++) {
    const A = prof[k], B = prof[k + 1], row = new Float32Array(nw).fill(NaN), qual = new Float32Array(nw);
    for (let w = 0; w < nw; w++) {
      const y0 = S + w * step;
      let ma = 0, va = 0;
      for (let y = y0; y < y0 + win; y++) ma += A[y];
      ma /= win;
      for (let y = y0; y < y0 + win; y++) va += (A[y] - ma) ** 2;
      if (va / win < 4) continue; // sem estrutura nesta janela
      const cc = new Float32Array(2 * S + 1);
      for (let s = -S; s <= S; s++) {
        let mb = 0, vb = 0, c = 0;
        for (let y = y0; y < y0 + win; y++) mb += B[y + s];
        mb /= win;
        for (let y = y0; y < y0 + win; y++) { const db = B[y + s] - mb; vb += db * db; c += (A[y] - ma) * db; }
        cc[s + S] = vb > 0 ? c / Math.sqrt(va * vb) : 0;
      }
      let bi = 0;
      for (let i = 1; i < cc.length; i++) if (cc[i] > cc[bi]) bi = i;
      if (cc[bi] < 0.6 || bi === 0 || bi === cc.length - 1) continue;
      const den = cc[bi - 1] - 2 * cc[bi] + cc[bi + 1];
      row[w] = bi - S + (den < 0 ? clamp(0.5 * (cc[bi - 1] - cc[bi + 1]) / den, -0.5, 0.5) : 0);
      qual[w] = cc[bi];
    }
    shift.push({ row, qual });
  }
  // acumula a partir da faixa central
  const kc = Math.floor(K / 2), c = (a0 + (kc + 0.5) * sw) / LA, samples = [];
  for (let w = 0; w < nw; w++) {
    const b = (S + w * step + win / 2) / LP;
    for (const dir of [1, -1]) {
      let d = 0, q = 1;
      for (let k = kc; dir > 0 ? k < K - 1 : k > 0; k += dir) {
        const sh = shift[dir > 0 ? k : k - 1], s = sh.row[w];
        if (Number.isNaN(s)) break;
        d += dir * s; q = Math.min(q, sh.qual[w]);
        samples.push({ t: [(a0 + (k + dir + 0.5) * sw) / LA - c, b], s: d / LP, w: q });
      }
    }
  }
  const strips = new Set(samples.map((p) => Math.round(p.t[0] * 100))).size;
  return { samples, c, coverage: strips / (K - 1), LP };
}
// Escolhe e testa o modelo de um eixo. mm = tamanho da página nesse eixo (para os limites).
function fitAxis(m, mm) {
  const { samples, c, coverage, LP } = m;
  const res = { apply: false, model: 0, coef: [], c, n: samples.length, coverage, rms0: 0, rms: 0, maxMm: 0 };
  if (samples.length < 20 || coverage < 0.4) return res; // pouca estrutura: fica só a perspetiva
  const rmsOf = (coef) => {
    const r = samples.map((p) => { let v = 0; for (let k = 0; k < coef.length; k++) v += coef[k] * CONTENT_BASIS[k](p.t); return p.s - v; });
    const mad = r.map(Math.abs).sort((a, b) => a - b)[r.length >> 1] * 1.4826 + 1e-6;
    const inl = r.filter((x) => Math.abs(x) < 3 * mad + 0.5 / LP);
    return Math.sqrt(inl.reduce((a, x) => a + x * x, 0) / Math.max(1, inl.length)) * mm;
  };
  res.rms0 = rmsOf([]);
  const fits = [{ nb: 0, coef: [], rms: res.rms0 }];
  // com poucas medidas, modelos simples (os complexos extrapolam para o resto da página)
  const maxNb = samples.length >= 200 ? 6 : samples.length >= 80 ? 4 : 2;
  for (const nb of [2, 4, 6].filter((n) => n <= maxNb)) {
    const coef = robustFit(samples, CONTENT_BASIS.slice(0, nb), 0.3 / LP);
    if (coef) fits.push({ nb, coef, rms: rmsOf(coef) });
  }
  const best = Math.min(...fits.map((f) => f.rms)), pick = fits.find((f) => f.rms <= best * 1.15 + 0.05);
  res.rms = pick.rms; res.model = pick.nb / 2; res.coef = pick.coef;
  for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) res.maxMm = Math.max(res.maxMm, Math.abs(axisRel(pick.coef, c, i / 10, j / 10)) * mm);
  // aplica só se ajudar de forma clara e não for exagerado (uma correção enorme é sinal de leitura errada)
  res.apply = pick.nb > 0 && res.rms0 - res.rms > 0.15 && res.maxMm > 0.4 && res.maxMm < 0.04 * mm;
  return res;
}
export function analyzeContent(cv, img, corners) {
  const est = estimateRatio(corners, img.width, img.height);
  const L = 1754; // página endireitada só para medir (≈150 ppp num A4); o resultado final não é reduzido
  const RW = Math.round(est.ratio >= 1 ? L / est.ratio : L), RH = Math.round(est.ratio >= 1 ? L : L * est.ratio);
  const pageHmm = est.ratio >= 1 ? 297 : 210, pageWmm = est.ratio >= 1 ? 210 : 297; // aproximado, só para os limites
  const rgba = warpPage(cv, img, { N: 2, corners, res: new Float64Array(8) }, RW, RH);
  // tinta = fundo do papel − cinzento (o fundo vem de um desfoque largo, para tirar sombras)
  const g = new cv.Mat(RH, RW, cv.CV_8UC1);
  for (let i = 0, j = 0; j < RW * RH; i += 4, j++) g.data[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  const bg = new cv.Mat(), kb = odd(RW / 25);
  cv.medianBlur(g, bg, 5); cv.blur(bg, bg, new cv.Size(kb, kb));
  const ink = new Uint8Array(RW * RH);
  for (let i = 0; i < ink.length; i++) { const d = bg.data[i] - g.data[i]; ink[i] = d > 0 ? d : 0; }
  g.delete(); bg.delete();
  const mv = measureAxis(ink, RW, RH, 'x'), mu = measureAxis(ink, RW, RH, 'y');
  const v = fitAxis(mv, pageHmm), u = fitAxis(mu, pageWmm);
  const pts = (m, swap) => m.samples.filter((_, i) => i % 3 === 0).map((p) => (swap ? [p.t[1], p.t[0] + m.c] : [p.t[0] + m.c, p.t[1]]));
  return {
    v, u, pageHmm,
    // resumo (eixo das linhas de texto, o principal)
    apply: v.apply || u.apply, model: v.model, coverage: v.coverage, rms0: v.rms0, rms: v.rms, maxMm: Math.max(v.maxMm, u.maxMm),
    samples: pts(mv, false).concat(pts(mu, true)),
  };
}

// Confiança na deteção: alta / média / baixa, com os motivos (para mostrar e para o modo automático)
function assessQuality(det, W, H) {
  const why = [], C = det.corners;
  let level = 2;
  const ang = C.map((b, k) => {
    const a = C[(k + 3) % 4], c = C[(k + 1) % 4], v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    return Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1), -1, 1)) * 180 / Math.PI;
  });
  if (ang.some((a) => a < 55 || a > 125)) { level = 0; why.push('cantos com ângulos pouco prováveis'); }
  if (det.margin < 0.6) { level = Math.min(level, 0); why.push('as margens da folha não parecem lisas'); }
  else if (det.margin < 0.8) { level = Math.min(level, 1); why.push('parte das margens não parece papel'); }
  if (det.edgeSamples.some((n) => n < 10)) { level = Math.min(level, 1); why.push('um dos lados quase não tem aresta visível'); }
  const est = estimateRatio(C, W, H), r = Math.max(est.ratio, 1 / est.ratio);
  if (r < 1.15 || r > 1.9) { level = Math.min(level, 0); why.push('proporção da folha pouco provável'); }
  const ct = det.content;
  if (ct.coverage < 0.4) { level = Math.min(level, 1); why.push('pouco texto para confirmar a geometria'); }
  else if (ct.rms > 1) { level = Math.min(level, 1); why.push(`as linhas de texto não ficam bem direitas (${ct.rms.toFixed(1)} mm)`); }
  if (ct.coverage >= 0.4 && !ct.apply && ct.maxMm >= 0.04 * ct.pageHmm) why.push('correção pelas linhas demasiado grande: ignorada');
  return { level: ['baixa', 'média', 'alta'][level], why };
}

// ───────────────────────── grelha ─────────────────────────
// mesh = { N, corners: [tl, tr, br, bl], res: Float64Array(N·N·2) } — res = desvio de cada ponto em relação à homografia.
// A grelha inicial é a perspetiva dos 4 cantos, mais a correção das linhas de texto se esta for aplicada.
export function buildMesh(det, N) {
  const h = homography(det.corners), ct = det.content;
  const f = (u, v) => applyH(h, u + contentDu(ct, u, v), v + contentDv(ct, u, v));
  const m = { N, corners: [f(0, 0), f(1, 0), f(1, 1), f(0, 1)], res: new Float64Array(N * N * 2) };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if ((i === 0 || i === N - 1) && (j === 0 || j === N - 1)) continue;
    const q = f(i / (N - 1), j / (N - 1));
    moveNode(m, i, j, q[0], q[1]);
  }
  return m;
}

// Posição de um ponto da grelha na foto
export function meshNode(mesh, i, j) {
  const N = mesh.N, u = i / (N - 1), v = j / (N - 1);
  if ((i === 0 || i === N - 1) && (j === 0 || j === N - 1)) return mesh.corners[[0, 1, 3, 2][(j ? 2 : 0) + (i ? 1 : 0)]].slice();
  const p = applyH(homography(mesh.corners), u, v);
  return [p[0] + mesh.res[(j * N + i) * 2], p[1] + mesh.res[(j * N + i) * 2 + 1]];
}
// Muda um ponto da grelha (cantos mudam a homografia; os outros só o seu desvio)
export function moveNode(mesh, i, j, x, y) {
  const N = mesh.N;
  if ((i === 0 || i === N - 1) && (j === 0 || j === N - 1)) { mesh.corners[[0, 1, 3, 2][(j ? 2 : 0) + (i ? 1 : 0)]] = [x, y]; return; }
  const p = applyH(homography(mesh.corners), i / (N - 1), j / (N - 1));
  mesh.res[(j * N + i) * 2] = x - p[0]; mesh.res[(j * N + i) * 2 + 1] = y - p[1];
}

// Função (u, v) → (x, y) na foto: homografia + desvio bicúbico (Catmull-Rom)
export function meshMapper(mesh) {
  const N = mesh.N, h = homography(mesh.corners), R = mesh.res;
  const r = (i, j, k) => { // com extrapolação linear fora da grelha
    if (i < 0) return 2 * r(0, j, k) - r(1, j, k);
    if (i > N - 1) return 2 * r(N - 1, j, k) - r(N - 2, j, k);
    if (j < 0) return 2 * r(i, 0, k) - r(i, 1, k);
    if (j > N - 1) return 2 * r(i, N - 1, k) - r(i, N - 2, k);
    return R[(j * N + i) * 2 + k];
  };
  const cr = (f) => [(-f + 2 * f * f - f * f * f) / 2, (2 - 5 * f * f + 3 * f * f * f) / 2, (f + 4 * f * f - 3 * f * f * f) / 2, (-f * f + f * f * f) / 2];
  return (u, v) => {
    const p = applyH(h, u, v);
    const gu = u * (N - 1), gv = v * (N - 1);
    const i = clamp(Math.floor(gu), 0, N - 2), j = clamp(Math.floor(gv), 0, N - 2);
    const wu = cr(gu - i), wv = cr(gv - j);
    let dx = 0, dy = 0;
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
      const w = wu[a] * wv[b];
      if (w) { dx += w * r(i - 1 + a, j - 1 + b, 0); dy += w * r(i - 1 + a, j - 1 + b, 1); }
    }
    return [p[0] + dx, p[1] + dy];
  };
}

// ───────────────────────── tamanho real ─────────────────────────
// Proporção altura/largura real da folha a partir da perspetiva (Zhang & He, "Whiteboard scanning", 2007).
// Centro ótico no centro da foto. Se a foto estiver quase de frente, usa a média dos lados.
export function estimateRatio(corners, W, H) {
  const [tl, tr, br, bl] = corners;
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const simple = (len(tl, bl) + len(tr, br)) / (len(tl, tr) + len(bl, br));
  const u0 = W / 2, v0 = H / 2;
  const m1 = [tl[0], tl[1], 1], m2 = [tr[0], tr[1], 1], m3 = [bl[0], bl[1], 1], m4 = [br[0], br[1], 1];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]), n3 = m3.map((v, i) => k3 * v - m1[i]);
  const den = n2[2] * n3[2];
  if (Math.abs(den) < 1e-9) return { ratio: simple, method: 'lados' };
  const f2 = -((n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 * u0) +
    (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0)) / den;
  const f = Math.sqrt(f2), D = Math.max(W, H);
  if (!(f2 > 0) || f < 0.3 * D || f > 6 * D) return { ratio: simple, method: 'lados' };
  const q = (n) => ((n[0] - u0 * n[2]) ** 2 + (n[1] - v0 * n[2]) ** 2) / f2 + n[2] * n[2];
  const wh = Math.sqrt(q(n2) / q(n3)); // largura / altura
  if (!(wh > 0.2 && wh < 5)) return { ratio: simple, method: 'lados' };
  return { ratio: 1 / wh, method: 'perspetiva', f };
}

// Tamanho em píxeis do resultado: nunca menor do que a folha aparece na foto
export function outputSize(mesh, ratio) {
  const map = meshMapper(mesh), L = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
  const line = (f) => Array.from({ length: 33 }, (_, k) => f(k / 32));
  const w = Math.max(L(line((t) => map(t, 0))), L(line((t) => map(t, 1))));
  const h = Math.max(L(line((t) => map(0, t))), L(line((t) => map(1, t))));
  let W = Math.max(w, h / ratio), H = W * ratio;
  const k = Math.min(1, 14000 / Math.max(W, H), Math.sqrt(120e6 / (W * H)));
  return { w: Math.round(W * k), h: Math.round(H * k) };
}

// ───────────────────────── correção ─────────────────────────
// Gera a página corrigida (outW × outH) a partir da foto, em faixas, com interpolação bicúbica.
export function warpPage(cv, img, mesh, outW, outH, progress = () => {}) {
  const map = meshMapper(mesh), step = 8;
  const gw = Math.ceil(outW / step) + 2, gh = Math.ceil(outH / step) + 2;
  const CX = new Float32Array(gw * gh), CY = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const p = map((i * step + 0.5) / outW, (j * step + 0.5) / outH);
    CX[j * gw + i] = p[0]; CY[j * gw + i] = p[1]; // coordenadas contínuas (centro do píxel em k + 0,5)
  }
  const src = cv.matFromImageData(img), out = new Uint8ClampedArray(outW * outH * 4);
  const SH = 256, mx = new cv.Mat(SH, outW, cv.CV_32FC1), my = new cv.Mat(SH, outW, cv.CV_32FC1), dst = new cv.Mat();
  const white = new cv.Scalar(255, 255, 255, 255);
  try {
    for (let y0 = 0; y0 < outH; y0 += SH) {
      progress(Math.min(1, y0 / outH));
      const rows = Math.min(SH, outH - y0), X = mx.data32F, Y = my.data32F;
      for (let y = 0; y < rows; y++) {
        const gy = (y0 + y) / step, j = gy | 0, fy = gy - j;
        for (let x = 0; x < outW; x++) {
          const gx = x / step, i = gx | 0, fx = gx - i, a = j * gw + i;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          X[y * outW + x] = CX[a] * w00 + CX[a + 1] * w10 + CX[a + gw] * w01 + CX[a + gw + 1] * w11 - 0.5;
          Y[y * outW + x] = CY[a] * w00 + CY[a + 1] * w10 + CY[a + gw] * w01 + CY[a + gw + 1] * w11 - 0.5;
        }
      }
      const rx = rows === SH ? mx : mx.rowRange(0, rows), ry = rows === SH ? my : my.rowRange(0, rows);
      cv.remap(src, dst, rx, ry, cv.INTER_CUBIC, cv.BORDER_CONSTANT, white);
      out.set(dst.data.subarray(0, rows * outW * 4), y0 * outW * 4);
      if (rx !== mx) { rx.delete(); ry.delete(); }
    }
  } finally { src.delete(); mx.delete(); my.delete(); dst.delete(); }
  return out;
}

// ───────────────────────── formatos ─────────────────────────
export const FORMATS = { a3: [297, 420], a4: [210, 297], a5: [148, 210], a6: [105, 148], letter: [215.9, 279.4], legal: [215.9, 355.6] };
// Plano da página corrigida: formato (fmt = 'auto', chave de FORMATS ou 'custom' com custom = [l, a] em mm),
// tamanho em mm, píxeis e ppp. key = formato usado; auto = escolhido pela perspetiva; assumed = largura suposta (210 mm).
export function planPage(mesh, W, H, fmt, custom) {
  const est = estimateRatio(mesh.corners, W, H);
  let mm = null, key = null, auto = false;
  if (fmt === 'custom') mm = custom.slice();
  else if (FORMATS[fmt]) { mm = FORMATS[fmt].slice(); key = fmt; }
  else { key = guessFormat(est.ratio); if (key) { mm = FORMATS[key].slice(); auto = true; } }
  if (mm && (est.ratio >= 1) !== (mm[1] >= mm[0])) mm.reverse(); // mesma orientação da folha na foto
  const assumed = !mm;
  if (!mm) mm = [210, 210 * est.ratio];
  const ratio = mm[1] / mm[0], sz = outputSize(mesh, ratio);
  return { mm, ratio, key, auto, assumed, sz, dpi: sz.w / (mm[0] / 25.4) };
}

// Formato mais próximo da proporção medida (A4 representa a série A). A série A tem preferência (tolerância 10%:
// a proporção tirada da perspetiva chega a errar ~8%); Carta e Ofício só ganham se baterem quase exatamente.
export function guessFormat(ratio) {
  const r = Math.max(ratio, 1 / ratio), err = (k) => Math.abs(FORMATS[k][1] / FORMATS[k][0] - r) / r;
  const ea = err('a4'), el = err('letter'), eo = err('legal');
  if (el < 0.015 && el < ea / 3) return 'letter';
  if (eo < 0.015 && eo < ea / 3) return 'legal';
  return ea < 0.1 ? 'a4' : null;
}
