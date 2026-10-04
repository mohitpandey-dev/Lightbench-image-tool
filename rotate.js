'use strict';

/* ==========================================================
   Lightbench: Rotate and flip an image.

   Quarter turns, mirror flips and a fine angle (to straighten a
   crooked photo). The preview is drawn small and quick; the
   download is drawn again at full size.

   Needs script.js (createTool, say, withBusy, canvasToBlob,
   outputTypeFor, baseName, bindSlider, EXT).
   ========================================================== */

(function initRotate() {
  if (!$('#tool-rotate')) return; // this tool is not on the current page

  const PREVIEW_MAX = 1100;          // longest side of the on-screen preview
  const MAX_PIXELS = 16 * 1024 * 1024; // browsers (iPhones especially) refuse bigger canvases

  const els = {
    left: $('#rot-left'),
    right: $('#rot-right'),
    flipH: $('#rot-fliph'),
    flipV: $('#rot-flipv'),
    reset: $('#rot-reset'),
    angle: $('#rot-angle'),
    angleOut: $('#rot-angle-out'),
    fit: $('#rot-fit'),
    fill: $('#rot-fill'),
    fillColor: $('#rot-fill-color'),
    format: $('#rot-format'),
    qualityField: $('#rot-quality-field'),
    quality: $('#rot-quality'),
    qualityOut: $('#rot-quality-out'),
    canvas: $('#rot-canvas'),
    stage: $('#rot-stage'),
    info: $('#rot-info'),
    download: $('#rot-download')
  };

  const state = { quarter: 0, flipH: false, flipV: false };

  const tool = createTool('rotate', () => {
    resetAll();
  });
  const section = tool.section;

  /* ---------- Working out the result ---------- */

  const angleRad = () => (Number(els.angle.value) * Math.PI) / 180;

  // Size of the finished picture for the current settings
  function outputSize() {
    const { img } = tool.image;
    const odd = state.quarter % 2 === 1;
    const bw = odd ? img.naturalHeight : img.naturalWidth;
    const bh = odd ? img.naturalWidth : img.naturalHeight;
    if (els.fit.value === 'keep') return [bw, bh];
    const a = angleRad();
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    return [Math.ceil(bw * c + bh * s - 1e-6), Math.ceil(bw * s + bh * c - 1e-6)];
  }

  // The colour behind the picture, or null for transparent
  function backgroundColor(type) {
    if (els.fill.value === 'white') return '#ffffff';
    if (els.fill.value === 'color') return els.fillColor.value;
    return type === 'image/jpeg' ? '#ffffff' : null; // JPG cannot be transparent
  }

  // Draws the result on `canvas`, `scale` times its full size
  function draw(canvas, scale, type) {
    const { img } = tool.image;
    const [ow, oh] = outputSize();
    canvas.width = Math.max(1, Math.round(ow * scale));
    canvas.height = Math.max(1, Math.round(oh * scale));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bg = backgroundColor(type);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    ctx.scale(canvas.width / ow, canvas.height / oh);
    ctx.translate(ow / 2, oh / 2);
    ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1); // flips are applied last, so they mirror what you see
    ctx.rotate(angleRad() + (state.quarter * Math.PI) / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }

  /* ---------- Preview ---------- */

  function outputType() {
    return els.format.value === 'same' ? outputTypeFor(tool.image.file) : els.format.value;
  }

  function refresh() {
    if (!tool.image) return;
    const [ow, oh] = outputSize();
    const scale = Math.min(1, PREVIEW_MAX / Math.max(ow, oh));
    const type = outputType();
    draw(els.canvas, scale, type);

    const fill = els.fill.value;
    els.stage.classList.toggle('is-checker', fill === 'transparent' && type !== 'image/jpeg');
    els.canvas.style.backgroundColor = '';
    els.fillColor.hidden = fill !== 'color';

    const turned = ((state.quarter * 90 + Number(els.angle.value)) % 360 + 360) % 360;
    let text = `Result: ${ow} \u00d7 ${oh} px, turned ${turned}\u00b0 clockwise`;
    if (state.flipH) text += ', flipped left to right';
    if (state.flipV) text += ', flipped top to bottom';
    if (type === 'image/jpeg' && fill === 'transparent' && els.angle.value % 90 !== 0) {
      text += '. JPG cannot be transparent, so the corners are white.';
    }
    els.info.textContent = text.endsWith('.') ? text : text + '.';

    els.qualityField.hidden = type === 'image/png';
  }

  function resetAll() {
    state.quarter = 0;
    state.flipH = false;
    state.flipV = false;
    els.angle.value = 0;
    els.angleOut.textContent = '0';
    refresh();
  }

  /* ---------- Controls ---------- */

  els.left.addEventListener('click', () => { state.quarter = (state.quarter + 3) % 4; refresh(); });
  els.right.addEventListener('click', () => { state.quarter = (state.quarter + 1) % 4; refresh(); });
  els.flipH.addEventListener('click', () => { state.flipH = !state.flipH; refresh(); });
  els.flipV.addEventListener('click', () => { state.flipV = !state.flipV; refresh(); });
  els.reset.addEventListener('click', () => { if (tool.image) resetAll(); });

  bindSlider(els.angle, els.angleOut);
  bindSlider(els.quality, els.qualityOut);
  els.angle.addEventListener('input', refresh);
  [els.fit, els.fill, els.format].forEach((el) => el.addEventListener('change', refresh));
  els.fillColor.addEventListener('input', refresh);

  /* ---------- Download ---------- */

  els.download.addEventListener('click', () =>
    withBusy(els.download, section, async () => {
      say(section, '');
      const type = outputType();
      let [ow, oh] = outputSize();
      let scale = 1;
      if (ow * oh > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (ow * oh));

      const canvas = document.createElement('canvas');
      draw(canvas, scale, type);
      const quality = type === 'image/png' ? undefined : Number(els.quality.value) / 100;
      const blob = await canvasToBlob(canvas, type, quality);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName(tool.image.file.name)}-rotated.${EXT[blob.type] || 'png'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      let note = `Saved a ${canvas.width} \u00d7 ${canvas.height} px image (${formatBytes(blob.size)}).`;
      if (scale < 1) note += ' It was scaled down because browsers cannot save pictures this large.';
      if (blob.type !== type) note += ' This browser cannot create that format, so it saved a PNG instead.';
      say(section, note, blob.type !== type);
    })
  );
})();
