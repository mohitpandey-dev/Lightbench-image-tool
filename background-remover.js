'use strict';

/* ==========================================================
   Lightbench: Background remover.

   Works by colour, entirely in the browser:
   1. Finds the background colour (from the picture's border, or
      from a click) and measures how far every pixel is from it.
   2. Removes the pixels that are close enough, either only those
      connected to the edges or that colour everywhere.
   3. Trims and softens the edge.
   4. You decide what else goes: a magic wand (click an area), a
      lasso or rectangle (remove inside, or keep inside and remove
      the rest), Erase and Restore brushes, and Undo. The automatic
      step can be switched off to start from the whole picture.

   Needs script.js (createTool, say, canvasToBlob, baseName).
   ========================================================== */

(function initBackgroundRemover() {
  if (!$('#tool-bgremove')) return; // this tool is not on the current page

  const MAX_SIDE = 2560;   // longest side we work at, to keep phones happy

  const els = {
    tolerance: $('#bg-tolerance'),
    toleranceOut: $('#bg-tolerance-out'),
    soft: $('#bg-soft'),
    softOut: $('#bg-soft-out'),
    trim: $('#bg-trim'),
    trimOut: $('#bg-trim-out'),
    scope: $('#bg-scope'),
    fill: $('#bg-fill'),
    fillColor: $('#bg-fill-color'),
    brush: $('#bg-brush'),
    brushOut: $('#bg-brush-out'),
    brushField: $('#bg-brush-field'),
    swatch: $('#bg-swatch'),
    auto: $('#bg-auto'),
    ai: $('#bg-ai'),
    clear: $('#bg-clear'),
    original: $('#bg-original'),
    download: $('#bg-download'),
    canvas: $('#bg-canvas'),
    overlay: $('#bg-overlay'),
    autoOn: $('#bg-auto-on'),
    action: $('#bg-action'),
    actionField: $('#bg-action-field'),
    undo: $('#bg-undo'),
    stage: $('#bg-stage'),
    info: $('#bg-info'),
    toolTip: $('#bg-tool-tip'),
    tools: $$('[data-bg-tool]')
  };

  const ctx = els.canvas.getContext('2d', { willReadFrequently: true });

  // Everything about the current picture lives here
  let W = 0, H = 0, N = 0;
  let src = null;          // Uint8ClampedArray: original pixels (RGBA)
  let out = null;          // ImageData that is shown on screen
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

  // Writes pixels in the rectangle into `out`, then paints that part on screen
  function compose(x0 = 0, y0 = 0, x1 = W, y1 = H) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1));  y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const d = out.data;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * W + x, i = p * 4;
        let a;
        if (showingOriginal) a = src[i + 3] / 255;
        else if (manual[p] === 1) a = 0;
        else if (manual[p] === 2) a = src[i + 3] / 255;
        else a = alpha[p] * (src[i + 3] / 255);
        d[i] = src[i]; d[i + 1] = src[i + 1]; d[i + 2] = src[i + 2];
        d[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  function updateBackdrop() {
    const mode = els.fill.value;
    els.fillColor.hidden = mode !== 'color';
    els.stage.classList.toggle('is-checker', mode === 'transparent');
    els.canvas.style.backgroundColor = mode === 'white' ? '#ffffff' : mode === 'color' ? els.fillColor.value : '';
  }

  function refresh() {
    computeAlpha();
    compose();
    describe();
  }

  function describe() {
    let cleared = 0;
    for (let p = 0; p < N; p += 7) if (manual[p] === 1 || (manual[p] !== 2 && alpha[p] < 0.5)) cleared++;
    const pct = Math.round((cleared / Math.ceil(N / 7)) * 100);
    els.info.textContent = `${W} \u00d7 ${H} px. About ${pct}% of the picture is removed.` + tooBigNote;
  }

  /* ---------- Loading a picture ---------- */

  const tool_ = createTool('bgremove', (loaded) => {
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
    els.tools.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bgTool === name)));
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
  els.tools.forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.bgTool)));

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

  els.fill.addEventListener('change', updateBackdrop);
  els.fillColor.addEventListener('input', updateBackdrop);

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
      const mode = els.fill.value;
      if (mode !== 'transparent') {
        fctx.fillStyle = mode === 'white' ? '#ffffff' : els.fillColor.value;
        fctx.fillRect(0, 0, W, H);
      }
      fctx.drawImage(els.canvas, 0, 0);

      const blob = await canvasToBlob(file, 'image/png');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName(tool_.image.file.name)}-no-background.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      say(section, `Saved a ${W} \u00d7 ${H} px PNG (${formatBytes(blob.size)}).`);
    })
  );
})();
