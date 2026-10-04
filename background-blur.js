'use strict';

/* ==========================================================
   Lightbench: Background blur.

   You choose what stays sharp. A focus shape (oval, box or band)
   with a soft edge keeps part of the picture sharp, and everything
   else is replaced by a blurred copy. Brushes then paint extra
   sharp or blurred areas, so the edge can follow your subject.

   The blur is calculated here (not with canvas filters), so it
   also works in browsers that do not support them.

   Needs script.js (createTool, say, withBusy, canvasToBlob,
   outputTypeFor, baseName, bindSlider, EXT, formatBytes).
   ========================================================== */

(function initBackgroundBlur() {
  if (!$('#tool-blur')) return; // this tool is not on the current page

  const MAX_SIDE = 2400;   // longest side we work at, to keep phones happy

  const els = {
    amount: $('#bl-amount'),
    amountOut: $('#bl-amount-out'),
    shape: $('#bl-shape'),
    width: $('#bl-width'),
    widthOut: $('#bl-width-out'),
    height: $('#bl-height'),
    heightOut: $('#bl-height-out'),
    feather: $('#bl-feather'),
    featherOut: $('#bl-feather-out'),
    brush: $('#bl-brush'),
    brushOut: $('#bl-brush-out'),
    brushField: $('#bl-brush-field'),
    sizeFields: $$('[data-bl-size]'),
    format: $('#bl-format'),
    qualityField: $('#bl-quality-field'),
    quality: $('#bl-quality'),
    qualityOut: $('#bl-quality-out'),
    center: $('#bl-center'),
    ai: $('#bl-ai'),
    clear: $('#bl-clear'),
    original: $('#bl-original'),
    download: $('#bl-download'),
    canvas: $('#bl-canvas'),
    overlay: $('#bl-overlay'),
    info: $('#bl-info'),
    tools: $$('[data-bl-tool]')
  };

  const ctx = els.canvas.getContext('2d', { willReadFrequently: true });
  const octx = els.overlay.getContext('2d');

  // Everything about the current picture lives here
  let W = 0, H = 0, N = 0;
  let srcCanvas = null;    // the picture at working size
  let src = null;          // Uint8ClampedArray: original pixels
  let bl = null;           // Uint8ClampedArray: blurred copy
  let out = null;          // ImageData shown on screen
  let subjectMask = null;  // Float32Array: the person, found by the AI person finder (or null)
  let shapeMask = null;    // Float32Array: 1 = sharp, 0 = blurred, from the focus shape
  let adj = null;          // Float32Array: brush edits, +1 painted sharp, -1 painted blurred
  let focus = { x: 0.5, y: 0.5 };
  let tool = 'move';
  let showingOriginal = false;
  let tooBigNote = '';
  let blurTimer = 0;
  let rafId = 0;

  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

  /* ---------- The blur ---------- */

  // One box blur pass over RGBA floats, both directions
  function boxPass(data, w, h, rho, tmp) {
    const size = 2 * rho + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -rho; k <= rho; k++) sum += data[row + Math.min(w - 1, Math.max(0, k)) * 4 + c];
        for (let x = 0; x < w; x++) {
          tmp[row + x * 4 + c] = sum / size;
          sum += data[row + Math.min(w - 1, x + rho + 1) * 4 + c] - data[row + Math.max(0, x - rho) * 4 + c];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -rho; k <= rho; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w * 4 + x * 4 + c];
        for (let y = 0; y < h; y++) {
          data[y * w * 4 + x * 4 + c] = sum / size;
          sum += tmp[Math.min(h - 1, y + rho + 1) * w * 4 + x * 4 + c] - tmp[Math.max(0, y - rho) * w * 4 + x * 4 + c];
        }
      }
    }
  }

  // Blur strength (the slider) to a blur radius in pixels of the working picture
  const sigmaFor = () => (Number(els.amount.value) / 100) * 0.03 * Math.max(W, H);

  function computeBlur() {
    const sigma = sigmaFor();
    if (sigma < 0.6) { bl = new Uint8ClampedArray(src); return; }

    // Large blurs are done on a smaller copy, which is much faster and looks the same
    const s = Math.max(1, Math.floor(sigma / 5));
    const sw = Math.max(1, Math.ceil(W / s)), sh = Math.max(1, Math.ceil(H / s));
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(srcCanvas, 0, 0, sw, sh);
    const pixels = sctx.getImageData(0, 0, sw, sh);

    const data = Float32Array.from(pixels.data);
    const tmp = new Float32Array(data.length);
    const rho = Math.max(1, Math.round(sigma / s));
    for (let pass = 0; pass < 3; pass++) boxPass(data, sw, sh, rho, tmp);
    pixels.data.set(data); // rounds and clamps for us
    sctx.putImageData(pixels, 0, 0);

    let blurred;
    if (s === 1) {
      blurred = pixels.data;
    } else {
      const big = document.createElement('canvas');
      big.width = W; big.height = H;
      const bctx = big.getContext('2d', { willReadFrequently: true });
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(small, 0, 0, W, H);
      blurred = bctx.getImageData(0, 0, W, H).data;
    }
    bl = new Uint8ClampedArray(blurred);
    for (let i = 3; i < bl.length; i += 4) bl[i] = src[i]; // keep transparency as it was
  }

  /* ---------- The focus shape ---------- */

  // Blurs a 0-1 mask a little (two box passes) so the sharp area fades out gently
  function softenMask(m, r) {
    const tmp = new Float32Array(m.length);
    const size = 2 * r + 1;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) {
        const row = y * W;
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += m[row + Math.min(W - 1, Math.max(0, k))];
        for (let x = 0; x < W; x++) {
          tmp[row + x] = sum / size;
          sum += m[row + Math.min(W - 1, x + r + 1)] - m[row + Math.max(0, x - r)];
        }
      }
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
        for (let y = 0; y < H; y++) {
          m[y * W + x] = sum / size;
          sum += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
        }
      }
    }
  }

  function computeShape() {
    const kind = els.shape.value;
    const rx = Math.max(1, (Number(els.width.value) / 100) * W / 2);
    const ry = Math.max(1, (Number(els.height.value) / 100) * H / 2);
    const cx = focus.x * W, cy = focus.y * H;
    const f = (Number(els.feather.value) / 100) * 0.8;
    const lo = Math.max(0, 1 - f), hi = 1 + f;

    if (kind === 'none') { shapeMask.fill(0); return; }
    if (kind === 'subject') {
      // The person found by AI. Soft edge widens the transition a little.
      if (!subjectMask) { shapeMask.fill(1); return; }
      shapeMask.set(subjectMask);
      const r = Math.round((Number(els.feather.value) / 100) * Math.max(W, H) * 0.006);
      if (r > 0) softenMask(shapeMask, r);
      return;
    }
    for (let y = 0; y < H; y++) {
      const dy = (y - cy) / ry;
      for (let x = 0; x < W; x++) {
        const dx = (x - cx) / rx;
        let d;
        if (kind === 'oval') d = Math.sqrt(dx * dx + dy * dy);
        else if (kind === 'box') d = Math.max(Math.abs(dx), Math.abs(dy));
        else d = Math.abs(dy); // horizontal band
        shapeMask[y * W + x] = f === 0 ? (d <= 1 ? 1 : 0) : 1 - smooth((d - lo) / (hi - lo));
      }
    }
  }

  /* ---------- Putting it together ---------- */

  function compose(x0 = 0, y0 = 0, x1 = W, y1 = H) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1));  y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const d = out.data;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * W + x, i = p * 4;
        let m = 1;
        if (!showingOriginal) {
          const sm = shapeMask[p], a = adj[p];
          m = a > 0 ? sm + (1 - sm) * a : sm * (1 + a);
        }
        d[i]     = bl[i]     + (src[i]     - bl[i])     * m;
        d[i + 1] = bl[i + 1] + (src[i + 1] - bl[i + 1]) * m;
        d[i + 2] = bl[i + 2] + (src[i + 2] - bl[i + 2]) * m;
        d[i + 3] = src[i + 3];
      }
    }
    ctx.putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  // The dashed outline that shows where the focus is (not saved in the download)
  function drawOutline() {
    octx.clearRect(0, 0, W, H);
    if (tool !== 'move' || showingOriginal || els.shape.value === 'none' || els.shape.value === 'subject') return;
    const shown = els.canvas.getBoundingClientRect().width || W;
    const px = W / shown;
    const rx = (Number(els.width.value) / 100) * W / 2;
    const ry = (Number(els.height.value) / 100) * H / 2;
    const cx = focus.x * W, cy = focus.y * H;

    const trace = () => {
      octx.beginPath();
      const kind = els.shape.value;
      if (kind === 'oval') octx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      else if (kind === 'box') octx.rect(cx - rx, cy - ry, rx * 2, ry * 2);
      else { octx.moveTo(0, cy - ry); octx.lineTo(W, cy - ry); octx.moveTo(0, cy + ry); octx.lineTo(W, cy + ry); }
    };
    octx.setLineDash([10 * px, 7 * px]);
    octx.lineWidth = 4 * px;
    octx.strokeStyle = 'rgba(0,0,0,0.55)';
    trace(); octx.stroke();
    octx.lineWidth = 2 * px;
    octx.strokeStyle = '#ffffff';
    trace(); octx.stroke();
    // a small dot at the centre
    octx.setLineDash([]);
    octx.beginPath();
    octx.arc(cx, cy, 6 * px, 0, Math.PI * 2);
    octx.fillStyle = '#f2b705';
    octx.fill();
    octx.lineWidth = 2 * px;
    octx.strokeStyle = '#1d2022';
    octx.stroke();
  }

  function refreshShape() {
    computeShape();
    compose();
    drawOutline();
  }

  function queueShape() {
    if (!src) return;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(refreshShape);
  }

  function refreshBlur() {
    computeBlur();
    compose();
    drawOutline();
    els.info.textContent = `${W} \u00d7 ${H} px.${tooBigNote}`;
  }

  function queueBlur() {
    if (!src) return;
    clearTimeout(blurTimer);
    blurTimer = setTimeout(refreshBlur, 140);
  }

  /* ---------- Loading a picture ---------- */

  const imageTool = createTool('blur', (loaded) => {
    const { img } = loaded;
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    W = Math.max(1, Math.round(img.naturalWidth * scale));
    H = Math.max(1, Math.round(img.naturalHeight * scale));
    N = W * H;
    tooBigNote = scale < 1 ? ` Large photos are processed at up to ${MAX_SIDE} px on the longest side.` : '';

    srcCanvas = document.createElement('canvas');
    srcCanvas.width = W; srcCanvas.height = H;
    const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, W, H);
    out = sctx.getImageData(0, 0, W, H);
    src = new Uint8ClampedArray(out.data);

    els.canvas.width = els.overlay.width = W;
    els.canvas.height = els.overlay.height = H;
    shapeMask = new Float32Array(N);
    subjectMask = null;
    if (els.shape.value === 'subject') els.shape.value = 'oval';
    adj = new Float32Array(N);
    focus = { x: 0.5, y: 0.5 };
    showingOriginal = false;
    els.original.setAttribute('aria-pressed', 'false');
    selectTool('move');
    updateFormat();

    computeShape();
    refreshBlur();
  });
  const section = imageTool.section;

  /* ---------- Tools: move focus, paint sharp, paint blur ---------- */

  function selectTool(name) {
    tool = name;
    els.tools.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.blTool === name)));
    els.brushField.hidden = name === 'move';
    els.overlay.style.cursor = name === 'move' ? 'crosshair' : 'cell';
    drawOutline();
  }
  els.tools.forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.blTool)));

  const pointOf = (event) => {
    const r = els.canvas.getBoundingClientRect();
    return [(event.clientX - r.left) * W / r.width, (event.clientY - r.top) * H / r.height];
  };

  function brushRadius() {
    const shown = els.canvas.getBoundingClientRect().width || W;
    return Math.max(2, (Number(els.brush.value) / 2) * (W / shown));
  }

  // Paints a soft round dab: full strength in the middle, fading out at the edge
  function stamp(x, y, target) {
    const r = brushRadius();
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const t = Math.hypot(px - x, py - y) / r;
        if (t >= 1) continue;
        const w = t < 0.5 ? 1 : 1 - smooth((t - 0.5) / 0.5);
        const p = py * W + px;
        adj[p] = adj[p] * (1 - w) + target * w;
      }
    }
    compose(x0, y0, x1 + 1, y1 + 1);
  }

  function stroke(from, to, target) {
    const step = Math.max(1, brushRadius() / 3);
    const count = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
    for (let k = 1; k <= count; k++) {
      stamp(from[0] + (to[0] - from[0]) * k / count, from[1] + (to[1] - from[1]) * k / count, target);
    }
  }

  let last = null;
  els.overlay.addEventListener('pointerdown', (event) => {
    if (!src) return;
    event.preventDefault();
    if (showingOriginal) setOriginal(false);
    els.overlay.setPointerCapture(event.pointerId);
    const pt = pointOf(event);
    last = pt;
    if (tool === 'move') {
      focus = { x: Math.min(1, Math.max(0, pt[0] / W)), y: Math.min(1, Math.max(0, pt[1] / H)) };
      queueShape();
    } else {
      stamp(pt[0], pt[1], tool === 'sharp' ? 1 : -1);
    }
  });
  els.overlay.addEventListener('pointermove', (event) => {
    if (!last) return;
    const pt = pointOf(event);
    if (tool === 'move') {
      focus = { x: Math.min(1, Math.max(0, pt[0] / W)), y: Math.min(1, Math.max(0, pt[1] / H)) };
      queueShape();
    } else {
      stroke(last, pt, tool === 'sharp' ? 1 : -1);
    }
    last = pt;
  });
  const endStroke = () => { last = null; };
  els.overlay.addEventListener('pointerup', endStroke);
  els.overlay.addEventListener('pointercancel', endStroke);

  /* ---------- Other controls ---------- */

  [els.amount, els.width, els.height, els.feather, els.brush, els.quality].forEach((slider) => {
    const out_ = $('#' + slider.id + '-out');
    if (out_) bindSlider(slider, out_);
  });

  els.amount.addEventListener('input', queueBlur);
  [els.width, els.height, els.feather].forEach((el) => el.addEventListener('input', queueShape));

  function updateSizeFields() {
    const kind = els.shape.value;
    els.sizeFields.forEach((f) => {
      const need = f.dataset.blSize; // which shapes use this slider
      f.hidden = kind === 'none' || !need.split(' ').includes(kind);
    });
  }
  els.shape.addEventListener('change', () => {
    updateSizeFields();
    queueShape();
    if (els.shape.value === 'subject' && !subjectMask && src) els.ai.click();
  });
  updateSizeFields();

  // AI person finder: keeps the person sharp and blurs everything else
  els.ai.addEventListener('click', () =>
    withBusy(els.ai, section, async () => {
      if (!src) return;
      if (!window.SubjectMask) { say(section, 'The person finder could not load. Check your connection and reload the page.', true); return; }
      try {
        const snapshot = document.createElement('canvas');
        snapshot.width = W; snapshot.height = H;
        snapshot.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src), W, H), 0, 0);
        subjectMask = await window.SubjectMask.detect(snapshot, W, H, (t) => say(section, t));
        els.shape.value = 'subject';
        updateSizeFields();
        say(section, 'Done. Use the brushes to fix any small spots.');
        refreshShape();
      } catch (err) {
        console.error(err);
        say(section, 'Could not run the person finder. It needs a connection the first time to download its model. You can still use the oval, box and brushes.', true);
      }
    })
  );

  els.center.addEventListener('click', () => {
    focus = { x: 0.5, y: 0.5 };
    queueShape();
  });

  els.clear.addEventListener('click', () => {
    if (!src) return;
    adj.fill(0);
    compose();
  });

  function setOriginal(on) {
    showingOriginal = on;
    els.original.setAttribute('aria-pressed', String(on));
    compose();
    drawOutline();
  }
  els.original.addEventListener('click', () => { if (src) setOriginal(!showingOriginal); });

  /* ---------- Download ---------- */

  function outputType() {
    return els.format.value === 'same' ? outputTypeFor(imageTool.image.file) : els.format.value;
  }

  function updateFormat() {
    if (!imageTool.image) return;
    els.qualityField.hidden = outputType() === 'image/png';
  }
  els.format.addEventListener('change', updateFormat);

  els.download.addEventListener('click', () =>
    withBusy(els.download, section, async () => {
      say(section, '');
      const type = outputType();
      const file = document.createElement('canvas');
      file.width = W; file.height = H;
      const fctx = file.getContext('2d');
      if (type === 'image/jpeg') { fctx.fillStyle = '#ffffff'; fctx.fillRect(0, 0, W, H); }

      // Draw the finished picture again without the display state (outline, "show original")
      const was = showingOriginal;
      if (was) setOriginal(false);
      fctx.drawImage(els.canvas, 0, 0);

      const quality = type === 'image/png' ? undefined : Number(els.quality.value) / 100;
      const blob = await canvasToBlob(file, type, quality);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName(imageTool.image.file.name)}-blurred-background.${EXT[blob.type] || 'png'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      let note = `Saved a ${W} \u00d7 ${H} px image (${formatBytes(blob.size)}).`;
      if (blob.type !== type) note += ' This browser cannot create that format, so it saved a PNG instead.';
      say(section, note, blob.type !== type);
    })
  );

  window.addEventListener('resize', () => { if (src) drawOutline(); });
})();
