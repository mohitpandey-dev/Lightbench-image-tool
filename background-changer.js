'use strict';

/* ==========================================================
   Lightbench: Background changer.

   Cuts the subject out by colour (the same engine as the Background
   remover: pick colour, magic wand, lasso, box, erase and restore
   brushes, undo) and then puts a new background behind it:
   a colour, a gradient, your own picture, a blurred copy of the
   original, or nothing (transparent).

   The picture on screen is the finished result, so what you see is
   what you download.

   Needs script.js (createTool, say, canvasToBlob, baseName,
   bindSlider, formatBytes, withBusy, EXT) and docs.js (frameThrottle).
   ========================================================== */

(function initBackgroundChanger() {
  if (!$('#tool-bgchange')) return; // this tool is not on the current page

  const MAX_SIDE = 2560;   // longest side we work at, to keep phones happy

  const els = {
    tolerance: $('#bc-tolerance'),
    toleranceOut: $('#bc-tolerance-out'),
    soft: $('#bc-soft'),
    softOut: $('#bc-soft-out'),
    trim: $('#bc-trim'),
    trimOut: $('#bc-trim-out'),
    scope: $('#bc-scope'),
    fill: $('#bc-fill'),
    fillColor: $('#bc-fill-color'),
    gradA: $('#bc-grad-a'),
    gradB: $('#bc-grad-b'),
    gradDir: $('#bc-grad-dir'),
    bgFile: $('#bc-bg-file'),
    bgFit: $('#bc-bg-fit'),
    blurAmount: $('#bc-blur'),
    blurOut: $('#bc-blur-out'),
    format: $('#bc-format'),
    panels: $$('[data-bc-panel]'),
    swatches: $$('[data-bc-color]'),
    brush: $('#bc-brush'),
    brushOut: $('#bc-brush-out'),
    brushField: $('#bc-brush-field'),
    swatch: $('#bc-swatch'),
    auto: $('#bc-auto'),
    ai: $('#bc-ai'),
    clear: $('#bc-clear'),
    original: $('#bc-original'),
    download: $('#bc-download'),
    canvas: $('#bc-canvas'),
    overlay: $('#bc-overlay'),
    autoOn: $('#bc-auto-on'),
    action: $('#bc-action'),
    actionField: $('#bc-action-field'),
    undo: $('#bc-undo'),
    stage: $('#bc-stage'),
    info: $('#bc-info'),
    toolTip: $('#bc-tool-tip'),
    tools: $$('[data-bc-tool]')
  };

  const ctx = els.canvas.getContext('2d', { willReadFrequently: true });

  // Everything about the current picture lives here
  let W = 0, H = 0, N = 0;
  let src = null;          // Uint8ClampedArray: original pixels (RGBA)
  let out = null;          // ImageData that is shown on screen
  let bd = null;           // Uint8ClampedArray: the new background (RGBA), same size as the picture
  let bgPicture = null;    // an Image the user chose as a background
  let dist = null;         // Float32Array: colour distance from the background, per pixel
  let aiAlpha = null;      // Float32Array: result of the AI person finder (or null)
  let alpha = null;        // Float32Array: result of the colour step (0 to 1)
  let scratch = null;      // Float32Array: working space for trim and soften
  let manual = null;       // Uint8Array: 0 = untouched, 1 = erased by hand, 2 = restored by hand
  let key = [255, 255, 255];
  let keyLab = [100, 0, 0];
  let tool = 'pick';
  let showingOriginal = false;
  let tooBigNote = '';

  /* ---------- Colour maths ---------- */

  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function toLab(r, g, b) {
    const R = LIN[r], G = LIN[g], B = LIN[b];
    const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  /* ---------- Finding the background colour ---------- */

  // The most common colour along the border of the picture
  function detectBackground() {
    const bins = new Map();
    const take = (x, y) => {
      const i = (y * W + x) * 4;
      if (src[i + 3] < 128) return;
      const r = src[i], g = src[i + 1], b = src[i + 2];
      const k = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      const e = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      bins.set(k, e);
    };
    const stepX = Math.max(1, Math.floor(W / 400));
    const stepY = Math.max(1, Math.floor(H / 400));
    for (let x = 0; x < W; x += stepX) { take(x, 0); take(x, H - 1); }
    for (let y = 0; y < H; y += stepY) { take(0, y); take(W - 1, y); }

    let best = null;
    bins.forEach((e) => { if (!best || e.n > best.n) best = e; });
    return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
  }

  function setKey(color) {
    key = color.map((v) => Math.round(v));
    keyLab = toLab(key[0], key[1], key[2]);
    els.swatch.style.background = hex(key);
    els.swatch.title = 'Background colour ' + hex(key);
    computeDistance();
  }

  function computeDistance() {
    const [L0, A0, B0] = keyLab;
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      const lab = toLab(src[i], src[i + 1], src[i + 2]);
      const dl = lab[0] - L0, da = lab[1] - A0, db = lab[2] - B0;
      dist[p] = Math.sqrt(dl * dl + da * da + db * db);
    }
  }

  /* ---------- Removing the background ---------- */

  // Fills `alpha` from the distances. Pixels near the background colour become
  // transparent; a narrow band at the edge of the range becomes semi-transparent.
  function computeAlpha() {
    if (aiAlpha) {                                         // AI person finder is in use
      for (let p = 0; p < N; p++) alpha[p] = src[p * 4 + 3] === 0 ? 0 : aiAlpha[p];
      trimAndSoften(Number(els.trim.value), Number(els.soft.value));
      return;
    }
    if (!els.autoOn.checked) { alpha.fill(1); return; }   // nothing removed until the user chooses
    const T = Number(els.tolerance.value);
    const T0 = T * 0.55;
    const edgesOnly = els.scope.value === 'edges';
    const removed = new Uint8Array(N);

    if (edgesOnly) {
      const queue = new Int32Array(N);
      let head = 0, tail = 0;
      const seed = (p) => {
        if (!removed[p] && dist[p] <= T && src[p * 4 + 3] > 0) { removed[p] = 1; queue[tail++] = p; }
      };
      for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
      for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
      while (head < tail) {
        const p = queue[head++];
        const x = p % W;
        let q;
        if (x > 0)     { q = p - 1; if (!removed[q] && dist[q] <= T) { removed[q] = 1; queue[tail++] = q; } }
        if (x < W - 1) { q = p + 1; if (!removed[q] && dist[q] <= T) { removed[q] = 1; queue[tail++] = q; } }
        if (p >= W)    { q = p - W; if (!removed[q] && dist[q] <= T) { removed[q] = 1; queue[tail++] = q; } }
        if (p < N - W) { q = p + W; if (!removed[q] && dist[q] <= T) { removed[q] = 1; queue[tail++] = q; } }
      }
    } else {
      for (let p = 0; p < N; p++) if (dist[p] <= T) removed[p] = 1;
    }

    const span = Math.max(0.001, T - T0);
    for (let p = 0; p < N; p++) {
      if (src[p * 4 + 3] === 0) { alpha[p] = 0; continue; }
      if (!removed[p]) alpha[p] = 1;
      else alpha[p] = dist[p] <= T0 ? 0 : (dist[p] - T0) / span;
    }

    trimAndSoften(Number(els.trim.value), Number(els.soft.value));
  }

  // Shrinks the kept area a little (to lose the halo) and then blurs the edge
  function trimAndSoften(trim, soft) {
    if (trim > 0) { minFilter(alpha, trim); }
    if (soft > 0) { boxBlur(alpha, soft); }
  }

  function minFilter(a, r) {
    // horizontal then vertical, using a simple window (r is small)
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        let m = 1;
        const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
        for (let k = x0; k <= x1; k++) { const v = a[row + k]; if (v < m) m = v; }
        scratch[row + x] = m;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let m = 1;
        const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
        for (let k = y0; k <= y1; k++) { const v = scratch[k * W + x]; if (v < m) m = v; }
        a[y * W + x] = m;
      }
    }
  }

  function boxBlur(a, r) {
    const size = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[row + Math.min(W - 1, Math.max(0, k))];
      for (let x = 0; x < W; x++) {
        scratch[row + x] = sum / size;
        sum += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += scratch[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum / size;
        sum += scratch[Math.min(H - 1, y + r + 1) * W + x] - scratch[Math.max(0, y - r) * W + x];
      }
    }
  }

  /* ---------- Drawing the result ---------- */

  // Writes pixels in the rectangle into `out`, then paints that part on screen.
  // The subject (src, with its cut-out alpha) is laid over the new background (bd).
  function compose(x0 = 0, y0 = 0, x1 = W, y1 = H) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1));  y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const d = out.data;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * W + x, i = p * 4;
        if (showingOriginal) {
          d[i] = src[i]; d[i + 1] = src[i + 1]; d[i + 2] = src[i + 2]; d[i + 3] = src[i + 3];
          continue;
        }
        let a;
        if (manual[p] === 1) a = 0;
        else if (manual[p] === 2) a = src[i + 3] / 255;
        else a = alpha[p] * (src[i + 3] / 255);

        if (a >= 0.999) {                 // all subject
          d[i] = src[i]; d[i + 1] = src[i + 1]; d[i + 2] = src[i + 2]; d[i + 3] = 255;
        } else if (a <= 0.001) {          // all new background
          d[i] = bd[i]; d[i + 1] = bd[i + 1]; d[i + 2] = bd[i + 2]; d[i + 3] = bd[i + 3];
        } else {                          // the soft edge: mix the two
          const ba = (bd[i + 3] / 255) * (1 - a);
          const ra = a + ba;
          d[i] = (src[i] * a + bd[i] * ba) / ra;
          d[i + 1] = (src[i + 1] * a + bd[i + 1] * ba) / ra;
          d[i + 2] = (src[i + 2] * a + bd[i + 2] * ba) / ra;
          d[i + 3] = Math.round(ra * 255);
        }
      }
    }
    ctx.putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  /* ---------- The new background ---------- */

  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  function fillBackdrop(draw) {
    work.width = W;
    work.height = H;
    wctx.clearRect(0, 0, W, H);
    draw(wctx);
    bd.set(wctx.getImageData(0, 0, W, H).data);
  }

  // A soft copy of a canvas: shrink it in halves, then grow it back in doubles.
  // This blurs the same way in every browser (canvas filters are not everywhere).
  function softCopy(source, amount) {
    const factor = 1 + amount * 0.7;
    const targetW = Math.max(2, Math.round(source.width / factor));
    const steps = [];
    let cur = source;
    while (cur.width > targetW) {
      const w = Math.max(targetW, Math.round(cur.width / 2));
      const h = Math.max(2, Math.round(cur.height * (w / cur.width)));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cc = c.getContext('2d');
      cc.imageSmoothingQuality = 'high';
      cc.drawImage(cur, 0, 0, w, h);
      steps.push(c);
      cur = c;
    }
    // grow it back up, one doubling at a time
    for (let k = steps.length - 2; k >= -1; k--) {
      const goal = k >= 0 ? steps[k] : source;
      const c = document.createElement('canvas');
      c.width = goal.width; c.height = goal.height;
      const cc = c.getContext('2d');
      cc.imageSmoothingQuality = 'high';
      cc.drawImage(cur, 0, 0, c.width, c.height);
      cur = c;
    }
    return cur;
  }

  // Fits the picture the user chose over the whole frame
  function drawChosenPicture(c) {
    const iw = bgPicture.naturalWidth, ih = bgPicture.naturalHeight;
    c.imageSmoothingQuality = 'high';
    if (els.bgFit.value === 'stretch') {
      c.drawImage(bgPicture, 0, 0, W, H);
      return;
    }
    const k = Math.max(W / iw, H / ih);   // fill the frame and crop the rest
    const w = iw * k, h = ih * k;
    c.drawImage(bgPicture, (W - w) / 2, (H - h) / 2, w, h);
  }

  function buildBackdrop() {
    if (!src) return;
    const mode = els.fill.value;

    if (mode === 'transparent') {
      bd.fill(0);
    } else if (mode === 'color') {
      fillBackdrop((c) => { c.fillStyle = els.fillColor.value; c.fillRect(0, 0, W, H); });
    } else if (mode === 'gradient') {
      fillBackdrop((c) => {
        const dir = els.gradDir.value;
        const g = dir === 'horizontal' ? c.createLinearGradient(0, 0, W, 0)
          : dir === 'diagonal' ? c.createLinearGradient(0, 0, W, H)
          : dir === 'radial' ? c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2)
          : c.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, els.gradA.value);
        g.addColorStop(1, els.gradB.value);
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
      });
    } else if (mode === 'picture') {
      if (bgPicture) fillBackdrop(drawChosenPicture);
      else fillBackdrop((c) => { c.fillStyle = '#d9dee2'; c.fillRect(0, 0, W, H); });   // until one is chosen
    } else if (mode === 'blur') {
      const original = document.createElement('canvas');
      original.width = W; original.height = H;
      const octx2 = original.getContext('2d');
      const copy = octx2.createImageData(W, H);
      copy.data.set(src);
      octx2.putImageData(copy, 0, 0);
      const soft = softCopy(original, Number(els.blurAmount.value));
      fillBackdrop((c) => { c.drawImage(soft, 0, 0, W, H); });
    }
  }

  // Shows only the settings that belong to the chosen background, then redraws
  function updateBackdrop() {
    const mode = els.fill.value;
    els.panels.forEach((panel) => { panel.hidden = !panel.dataset.bcPanel.split(' ').includes(mode); });
    els.stage.classList.toggle('is-checker', mode === 'transparent');
    buildBackdrop();
    compose();
  }

  const queueBackdrop = frameThrottle(updateBackdrop);

  function refresh() {
    computeAlpha();
    compose();
    describe();
  }

  function describe() {
    let cleared = 0;
    for (let p = 0; p < N; p += 7) if (manual[p] === 1 || (manual[p] !== 2 && alpha[p] < 0.5)) cleared++;
    const pct = Math.round((cleared / Math.ceil(N / 7)) * 100);
    els.info.textContent = `${W} \u00d7 ${H} px. About ${pct}% of the picture is replaced.` + tooBigNote;
  }

  /* ---------- Loading a picture ---------- */

  const tool_ = createTool('bgchange', (loaded) => {
    const { img } = loaded;
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    tooBigNote = scale < 1 ? ` Large photos are processed at up to ${MAX_SIDE} px on the longest side.` : '';

    els.canvas.width = els.overlay.width = W = w;
    els.canvas.height = els.overlay.height = H = h;
    N = W * H;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    out = ctx.getImageData(0, 0, W, H);
    src = new Uint8ClampedArray(out.data);

    aiAlpha = null;
    dist = new Float32Array(N);
    alpha = new Float32Array(N);
    scratch = new Float32Array(N);
    manual = new Uint8Array(N);
    bd = new Uint8ClampedArray(N * 4);
    undoStack.length = 0;
    updateUndo();
    showingOriginal = false;
    els.original.setAttribute('aria-pressed', 'false');
    selectTool('pick');
    updateBackdrop();

    setKey(detectBackground());
    refresh();
  });
  const section = tool_.section;

  /* ---------- Tools ---------- */

  const BRUSH_TOOLS = ['erase', 'restore'];
  const SHAPE_TOOLS = ['lasso', 'rect'];
  const CURSORS = { pick: 'crosshair', wand: 'crosshair', lasso: 'crosshair', rect: 'crosshair', erase: 'cell', restore: 'cell' };
  const undoStack = [];

  function selectTool(name) {
    tool = name;
    els.tools.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bcTool === name)));
    els.brushField.hidden = !BRUSH_TOOLS.includes(name);
    els.actionField.hidden = !SHAPE_TOOLS.includes(name);
    els.overlay.style.cursor = CURSORS[name] || 'crosshair';
    octx.clearRect(0, 0, W, H);
    const tips = {
      pick: 'Click the background to choose the colour that is removed automatically.',
      wand: 'Click an area to remove it. Everything joined to it with a similar colour goes too. Tolerance sets how similar.',
      lasso: 'Draw around an area. Let go to finish the shape.',
      rect: 'Drag a box over an area.',
      erase: 'Paint over anything you want to remove.',
      restore: 'Paint over anything you want to bring back.'
    };
    els.toolTip.textContent = tips[name] || '';
  }
  els.tools.forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.bcTool)));

  const octx = els.overlay.getContext('2d');

  /* Undo: each action keeps a copy of the hand-made edits before it runs */

  function updateUndo() { els.undo.disabled = undoStack.length === 0; }
  function pushUndo() {
    if (undoStack.length >= 10) undoStack.shift();
    undoStack.push(manual.slice());
    updateUndo();
  }
  els.undo.addEventListener('click', () => {
    if (!src || !undoStack.length) return;
    manual.set(undoStack.pop());
    updateUndo();
    compose();
    describe();
  });

  function pointOf(event) {
    const r = els.canvas.getBoundingClientRect();
    return [(event.clientX - r.left) * W / r.width, (event.clientY - r.top) * H / r.height];
  }

  const screenScale = () => W / (els.canvas.getBoundingClientRect().width || W);

  function averageAt(x, y) {
    const cx = Math.min(W - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(H - 1, Math.max(0, Math.round(y)));
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const i = (py * W + px) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
      }
    }
    return [r / n, g / n, b / n];
  }

  function pickAt(x, y) {
    setKey(averageAt(x, y));
    refresh();
  }

  // Magic wand: removes the area around the click that is close to the clicked colour
  function wandAt(x, y) {
    const cx = Math.min(W - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(H - 1, Math.max(0, Math.round(y)));
    const seed = averageAt(cx, cy);
    const [L0, A0, B0] = toLab(Math.round(seed[0]), Math.round(seed[1]), Math.round(seed[2]));
    const T = Number(els.tolerance.value);
    const seen = new Uint8Array(N);
    const queue = new Int32Array(N);
    let head = 0, tail = 0;

    const near = (q) => {
      const i = q * 4;
      if (src[i + 3] === 0) return true;
      const lab = toLab(src[i], src[i + 1], src[i + 2]);
      const dl = lab[0] - L0, da = lab[1] - A0, db = lab[2] - B0;
      return Math.sqrt(dl * dl + da * da + db * db) <= T;
    };
    const start = cy * W + cx;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++];
      manual[p] = 1;
      const px = p % W;
      let q;
      if (px > 0)     { q = p - 1; if (!seen[q]) { seen[q] = 1; if (near(q)) queue[tail++] = q; } }
      if (px < W - 1) { q = p + 1; if (!seen[q]) { seen[q] = 1; if (near(q)) queue[tail++] = q; } }
      if (p >= W)     { q = p - W; if (!seen[q]) { seen[q] = 1; if (near(q)) queue[tail++] = q; } }
      if (p < N - W)  { q = p + W; if (!seen[q]) { seen[q] = 1; if (near(q)) queue[tail++] = q; } }
    }
    compose();
    describe();
  }

  // Brush size is in screen pixels, so it feels the same on any picture
  function brushRadius() {
    return Math.max(1, (Number(els.brush.value) / 2) * screenScale());
  }

  function stamp(x, y, value) {
    const r = brushRadius();
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - x, dy = py - y;
        if (dx * dx + dy * dy <= r2) manual[py * W + px] = value;
      }
    }
    compose(x0, y0, x1 + 1, y1 + 1);
  }

  function stroke(from, to, value) {
    const step = Math.max(1, brushRadius() / 3);
    const count = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
    for (let k = 1; k <= count; k++) {
      stamp(from[0] + (to[0] - from[0]) * k / count, from[1] + (to[1] - from[1]) * k / count, value);
    }
  }

  // The outline of the shape being drawn
  function shapePoints(d) {
    if (d.kind === 'rect') {
      const [x0, y0] = d.a, [x1, y1] = d.b;
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    return d.pts;
  }

  function traceShape(c, pts) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.closePath();
  }

  function drawSelection(d) {
    octx.clearRect(0, 0, W, H);
    const pts = shapePoints(d);
    if (pts.length < 2) return;
    const px = screenScale();
    const keep = els.action.value === 'keep';
    traceShape(octx, pts);
    octx.fillStyle = keep ? 'rgba(40, 120, 255, 0.22)' : 'rgba(220, 40, 40, 0.28)';
    octx.fill();
    octx.setLineDash([9 * px, 6 * px]);
    octx.lineWidth = 4 * px;
    octx.strokeStyle = 'rgba(0,0,0,0.55)';
    octx.stroke();
    octx.lineWidth = 2 * px;
    octx.strokeStyle = '#ffffff';
    octx.stroke();
    octx.setLineDash([]);
  }

  // Removes the inside of the shape, or everything outside it
  function applyShape(d) {
    const pts = shapePoints(d);
    if (pts.length < 3) return;
    if (d.kind === 'rect' && (Math.abs(d.a[0] - d.b[0]) < 3 || Math.abs(d.a[1] - d.b[1]) < 3)) return;

    const mask = document.createElement('canvas');
    mask.width = W; mask.height = H;
    const mctx = mask.getContext('2d', { willReadFrequently: true });
    traceShape(mctx, pts);
    mctx.fillStyle = '#000';
    mctx.fill();
    const data = mctx.getImageData(0, 0, W, H).data;

    pushUndo();
    const keep = els.action.value === 'keep';
    for (let p = 0; p < N; p++) {
      const inside = data[p * 4 + 3] > 127;
      if (keep ? !inside : inside) manual[p] = 1;
    }
    compose();
    describe();
  }

  let last = null;   // brush: the previous point
  let drag = null;   // lasso or box being drawn

  els.overlay.addEventListener('pointerdown', (event) => {
    if (!src) return;
    event.preventDefault();
    const pt = pointOf(event);
    if (tool === 'pick') { pickAt(pt[0], pt[1]); return; }
    if (showingOriginal) setOriginal(false);
    if (tool === 'wand') { pushUndo(); wandAt(pt[0], pt[1]); return; }

    els.overlay.setPointerCapture(event.pointerId);
    if (BRUSH_TOOLS.includes(tool)) {
      pushUndo();
      last = pt;
      stamp(pt[0], pt[1], tool === 'erase' ? 1 : 2);
    } else if (tool === 'lasso') {
      drag = { kind: 'lasso', pts: [pt] };
    } else if (tool === 'rect') {
      drag = { kind: 'rect', a: pt, b: pt };
    }
  });

  els.overlay.addEventListener('pointermove', (event) => {
    const pt = pointOf(event);
    if (last) {
      stroke(last, pt, tool === 'erase' ? 1 : 2);
      last = pt;
    } else if (drag) {
      if (drag.kind === 'rect') drag.b = pt;
      else {
        const prev = drag.pts[drag.pts.length - 1];
        if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) >= 2 * screenScale()) drag.pts.push(pt);
      }
      drawSelection(drag);
    }
  });

  function endStroke() {
    if (last) { last = null; describe(); }
    if (drag) {
      const finished = drag;
      drag = null;
      octx.clearRect(0, 0, W, H);
      applyShape(finished);
    }
  }
  els.overlay.addEventListener('pointerup', endStroke);
  els.overlay.addEventListener('pointercancel', () => { last = null; drag = null; octx.clearRect(0, 0, W, H); });

  /* ---------- Other controls ---------- */

  bindSlider(els.tolerance, els.toleranceOut);
  bindSlider(els.soft, els.softOut);
  bindSlider(els.trim, els.trimOut);
  bindSlider(els.brush, els.brushOut);

  let queued = 0;
  function queueRefresh() {
    if (!src) return;
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(refresh);
  }
  [els.tolerance, els.soft, els.trim].forEach((el) => el.addEventListener('input', queueRefresh));
  els.scope.addEventListener('change', queueRefresh);

  bindSlider(els.blurAmount, els.blurOut);
  els.fill.addEventListener('change', updateBackdrop);
  [els.fillColor, els.gradA, els.gradB, els.blurAmount].forEach((el) => el.addEventListener('input', queueBackdrop));
  [els.gradDir, els.bgFit].forEach((el) => el.addEventListener('change', queueBackdrop));

  // Quick colour buttons
  els.swatches.forEach((chip) =>
    chip.addEventListener('click', () => {
      els.fillColor.value = chip.dataset.bcColor;
      els.fill.value = 'color';
      updateBackdrop();
    })
  );

  // Choosing a picture for the background
  els.bgFile.addEventListener('change', () => {
    const file = els.bgFile.files && els.bgFile.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      say(section, 'Choose an image file for the background.', true);
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      bgPicture = image;
      els.fill.value = 'picture';
      say(section, '');
      updateBackdrop();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      say(section, 'That file could not be opened as a picture.', true);
    };
    image.src = url;
  });

  els.auto.addEventListener('click', () => {
    if (!src) return;
    aiAlpha = null;
    setKey(detectBackground());
    refresh();
  });

  // AI person finder: works on busy backgrounds where colour alone fails
  els.ai.addEventListener('click', () =>
    withBusy(els.ai, section, async () => {
      if (!src) return;
      if (!window.SubjectMask) { say(section, 'The person finder could not load. Check your connection and reload the page.', true); return; }
      try {
        const status = (t) => say(section, t);
        const snapshot = document.createElement('canvas');
        snapshot.width = W; snapshot.height = H;
        const sctx = snapshot.getContext('2d');
        sctx.putImageData(new ImageData(new Uint8ClampedArray(src), W, H), 0, 0);
        aiAlpha = await window.SubjectMask.detect(snapshot, W, H, status);
        say(section, 'Done. Use Erase and Restore to fix any small spots.');
        refresh();
      } catch (err) {
        console.error(err);
        say(section, 'Could not run the person finder. It needs a connection the first time to download its model. You can still use the colour tools.', true);
      }
    })
  );

  els.clear.addEventListener('click', () => {
    if (!src) return;
    pushUndo();
    manual.fill(0);
    compose();
    describe();
  });

  // Switching the automatic step on or off, or changing what a shape does
  els.autoOn.addEventListener('change', queueRefresh);

  function setOriginal(on) {
    showingOriginal = on;
    els.original.setAttribute('aria-pressed', String(on));
    compose();
  }
  els.original.addEventListener('click', () => { if (src) setOriginal(!showingOriginal); });

  /* ---------- Download ---------- */

  els.download.addEventListener('click', () =>
    withBusy(els.download, section, async () => {
      say(section, '');
      if (showingOriginal) setOriginal(false);

      const file = document.createElement('canvas');
      file.width = W;
      file.height = H;
      const fctx = file.getContext('2d');
      const type = els.format.value;
      if (type === 'image/jpeg') {            // JPG has no see-through, so use white
        fctx.fillStyle = '#ffffff';
        fctx.fillRect(0, 0, W, H);
      }
      fctx.drawImage(els.canvas, 0, 0);

      const blob = await canvasToBlob(file, type, 0.92);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName(tool_.image.file.name)}-new-background.${EXT[blob.type] || 'png'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say(section, `Saved a ${W} \u00d7 ${H} px ${(EXT[blob.type] || 'png').toUpperCase()} (${formatBytes(blob.size)}).` + (els.fill.value === 'transparent' && blob.type === 'image/jpeg' ? ' JPG cannot be see-through, so the empty area is white.' : ''));
    })
  );
})();
