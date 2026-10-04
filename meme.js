'use strict';

/* ==========================================================
   Lightbench: Meme tools.

   One engine runs several pages. The page says which one it is with
   data-mode on #tool-meme:

     classic          text on the picture (Meme Generator, Meme Maker,
                      Add Text to Image, Meme Templates, Image to Meme)
     caption          a caption bar above or below the picture
     reaction         a caption bar plus a draggable emoji sticker
     demotivational   black frame, white border, title and small line

   The picture and its text are drawn small for the live preview, and
   again at full size for the download.

   MemeText (the text drawing) is shared with the GIF meme maker.

   Needs script.js (createTool, say, withBusy, showResult, hideResult,
   canvasToBlob, baseName, bindSlider, clamp, EXT) and docs.js
   (frameThrottle, roundedRect).
   ========================================================== */

const MEME_FONTS = {
  impact: '"Impact", "Anton", "Haettenschweiler", "Arial Narrow Bold", sans-serif',
  site: '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  comic: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive, sans-serif',
  serif: 'Georgia, "Times New Roman", serif'
};

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

const MemeText = (function () {
  // Impact has no bold, so asking for one would smear it
  const fontCss = (key, px) => `${key === 'impact' ? '' : 'bold '}${px}px ${MEME_FONTS[key] || MEME_FONTS.site}`;

  // Breaks text into lines no wider than maxWidth (words stay whole when they can)
  function wrap(ctx, text, maxWidth) {
    const lines = [];
    text.split('\n').forEach((paragraph) => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push('');
        return;
      }
      let line = '';
      words.forEach((word) => {
        const attempt = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(attempt).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = attempt;
        }
      });
      lines.push(line);
    });
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines;
  }

  // Draws lines of text with an outline. o = {
  //   W, H, px, outline (percent of px), color, strokeColor, font, caps,
  //   plate: 'none' | 'dark' | 'light',
  //   items: [{ name, text, x, y, w }]   x, y: centre as a fraction; w: widest line as a fraction
  // }
  // Returns the box each line ended up in, for dragging.
  function drawLines(ctx, o) {
    const { W, H, px } = o;
    const outline = (px * o.outline) / 100;
    const lineHeight = px * 1.08;
    const boxes = [];

    ctx.save();
    ctx.font = fontCss(o.font, px);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    o.items.forEach((item) => {
      let text = item.text || '';
      if (!text.trim()) return;
      if (o.caps) text = text.toUpperCase();

      const lines = wrap(ctx, text, W * item.w - outline * 2);
      if (!lines.length) return;

      const blockH = lines.length * lineHeight;
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
      // Keep the whole block on the picture
      const cx = clamp(item.x * W, widest / 2 + outline, W - widest / 2 - outline);
      const cy = clamp(item.y * H, blockH / 2, H - blockH / 2);

      if (o.plate && o.plate !== 'none') {
        const pad = px * 0.32;
        ctx.fillStyle = o.plate === 'dark' ? 'rgba(0, 0, 0, 0.64)' : 'rgba(255, 255, 255, 0.84)';
        roundedRect(ctx, cx - widest / 2 - pad, cy - blockH / 2 - pad * 0.7, widest + pad * 2, blockH + pad * 1.4, px * 0.28);
        ctx.fill();
      }

      lines.forEach((line, i) => {
        const y = cy - blockH / 2 + lineHeight * (i + 0.5);
        if (outline > 0) {
          ctx.lineWidth = outline * 2;
          ctx.strokeStyle = o.strokeColor;
          ctx.strokeText(line, cx, y);
        }
        ctx.fillStyle = o.color;
        ctx.fillText(line, cx, y);
      });

      boxes.push({
        name: item.name,
        x: cx - widest / 2 - outline,
        y: cy - blockH / 2 - outline / 2,
        w: widest + outline * 2,
        h: blockH + outline
      });
    });

    ctx.restore();
    return boxes;
  }

  return { fontCss, wrap, drawLines };
})();


/* ---------- The picture tools ---------- */

(function initMeme() {
  const section = $('#tool-meme');
  if (!section) return; // this tool is not on the current page

  const mode = section.dataset.mode || 'classic';
  const PREVIEW_MAX = 900;       // widest the on-screen preview gets
  const MAX_SIDE = 4096;         // longest side of the download
  const MAX_PIXELS = 16 * 1024 * 1024;

  const q = (id) => $(`#mm-${id}`);
  const els = {
    top: q('top'), bottom: q('bottom'), extra: q('extra'),
    font: q('font'), caps: q('caps'), size: q('size'),
    color: q('color'), strokeColor: q('stroke-color'), stroke: q('stroke'),
    plate: q('plate'), guides: q('guides'), reset: q('reset'),
    barPos: q('bar-pos'), barColor: q('bar-color'), align: q('align'),
    stickerSize: q('sticker-size'),
    format: q('format'), canvas: q('canvas'), go: q('go'), copy: q('copy')
  };
  const value = (el, fallback) => (el ? el.value : fallback);
  const checked = (el, fallback) => (el ? el.checked : fallback);

  ['size', 'stroke', 'stickerSize'].forEach((name) => {
    const id = name === 'stickerSize' ? 'sticker-size' : name;
    if (els[name]) bindSlider(els[name], q(`${id}-out`));
  });

  /* ----- Where things sit -----
     Each piece keeps its centre as a fraction of the picture, so it lands
     in the same place at any size. `w` is the widest a line may be. */

  const home = () => ({
    top: { x: 0.5, y: 0.13, w: 0.94 },
    bottom: { x: 0.5, y: 0.87, w: 0.94 },
    extra: { x: 0.5, y: 0.5, w: 0.94 },
    sticker: { x: mode === 'reaction' ? 0.8 : 0.82, y: mode === 'reaction' ? 0.3 : 0.22 }
  });
  let pos = home();
  let selected = mode === 'reaction' ? 'sticker' : 'top';
  let hitBoxes = [];      // where each piece was drawn on the preview
  let sticker = (section.dataset.sticker || '').trim();
  let pending = null;     // a template waiting to be applied to the next picture

  // What the controls say before any template changes them
  const defaults = {
    size: value(els.size, ''), color: value(els.color, ''),
    stroke: value(els.stroke, ''), strokeColor: value(els.strokeColor, ''),
    labels: {}
  };
  ['top', 'bottom', 'extra'].forEach((name) => {
    const label = $(`label[for="mm-${name}"]`);
    if (label) defaults.labels[name] = label.textContent;
  });

  const setValue = (el, v) => {
    if (!el || v === undefined) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const tool = createTool('meme', ({ file }) => {
    pos = home();
    selected = mode === 'reaction' ? 'sticker' : 'top';
    setValue(els.size, defaults.size);
    setValue(els.color, defaults.color);
    setValue(els.stroke, defaults.stroke);
    setValue(els.strokeColor, defaults.strokeColor);
    Object.keys(defaults.labels).forEach((name) => {
      $(`label[for="mm-${name}"]`).textContent = defaults.labels[name];
    });

    if (pending) {
      Object.keys(pending.pos || {}).forEach((name) => Object.assign(pos[name], pending.pos[name]));
      Object.keys(pending.labels || {}).forEach((name) => {
        const label = $(`label[for="mm-${name}"]`);
        if (label) label.textContent = pending.labels[name];
      });
      setValue(els.size, pending.size);
      setValue(els.color, pending.color);
      setValue(els.stroke, pending.stroke);
      pending = null;
    }

    if (els.format) els.format.value = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    redraw();
  });

  /* ---------- Drawing ---------- */

  const measure = document.createElement('canvas').getContext('2d');

  // Items for the outlined text modes
  function textItems() {
    return ['top', 'bottom', 'extra']
      .filter((name) => els[name])
      .map((name) => ({ name, text: els[name].value, ...pos[name] }));
  }

  function drawSticker(ctx, W, H, boxes) {
    if (!sticker) return;
    const spx = Math.round((W * Number(value(els.stickerSize, 22))) / 100);
    const half = spx * 0.62;
    const cx = clamp(pos.sticker.x * W, half, W - half);
    const cy = clamp(pos.sticker.y * H, half, H - half);
    ctx.save();
    ctx.font = `${spx}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(sticker, cx, cy);
    ctx.restore();
    boxes.push({ name: 'sticker', x: cx - half, y: cy - half, w: half * 2, h: half * 2 });
  }

  function drawGuide(ctx, W, boxes) {
    const box = boxes.find((b) => b.name === selected);
    if (!box || !checked(els.guides, false)) return;
    ctx.save();
    ctx.lineWidth = Math.max(1, W / 450);
    ctx.setLineDash([W / 100, W / 150]);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineDashOffset = W / 100;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }

  // Text on the picture
  function drawClassic(canvas, W, guides) {
    const { img } = tool.image;
    const H = Math.round((W * img.naturalHeight) / img.naturalWidth);
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);

    const boxes = MemeText.drawLines(ctx, {
      W, H,
      px: Math.max(8, Math.round((W * Number(els.size.value)) / 100)),
      outline: Number(value(els.stroke, 0)),
      color: els.color.value,
      strokeColor: value(els.strokeColor, '#000000'),
      font: value(els.font, 'impact'),
      caps: checked(els.caps, false),
      plate: value(els.plate, 'none'),
      items: textItems()
    });
    drawSticker(ctx, W, H, boxes);
    if (guides) {
      hitBoxes = boxes;
      drawGuide(ctx, W, boxes);
    }
    return { W, H };
  }

  // A bar of text above or below the picture
  function drawCaption(canvas, W, guides) {
    const { img } = tool.image;
    const imgH = Math.round((W * img.naturalHeight) / img.naturalWidth);
    const px = Math.max(8, Math.round((W * Number(els.size.value)) / 100));
    const font = value(els.font, 'site');
    let text = els.top.value;
    if (checked(els.caps, false)) text = text.toUpperCase();

    measure.font = MemeText.fontCss(font, px);
    const lines = text.trim() ? MemeText.wrap(measure, text, W * 0.9) : [];
    const lineHeight = px * 1.25;
    const padY = px * 0.7;
    const barH = lines.length ? Math.round(lines.length * lineHeight + padY * 2) : 0;
    const H = imgH + barH;
    const atTop = value(els.barPos, 'top') === 'top';

    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = value(els.barColor, '#ffffff');
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, atTop ? barH : 0, W, imgH);

    if (lines.length) {
      const left = value(els.align, 'left') === 'left';
      ctx.font = MemeText.fontCss(font, px);
      ctx.fillStyle = els.color.value;
      ctx.textBaseline = 'middle';
      ctx.textAlign = left ? 'left' : 'center';
      const x = left ? W * 0.05 : W / 2;
      const y0 = atTop ? 0 : imgH;
      lines.forEach((line, i) => ctx.fillText(line, x, y0 + padY + lineHeight * (i + 0.5)));
    }

    const boxes = [];
    drawSticker(ctx, W, H, boxes);
    if (guides) {
      hitBoxes = boxes;
      drawGuide(ctx, W, boxes);
    }
    return { W, H };
  }

  // Black frame, white border, a big title and a small line under it
  function drawDemotivational(canvas, W) {
    const { img } = tool.image;
    const pad = Math.round(W * 0.08);
    const inner = W - pad * 2;
    const imgH = Math.round((inner * img.naturalHeight) / img.naturalWidth);
    const titlePx = Math.max(10, Math.round((W * Number(els.size.value)) / 100));
    const subPx = Math.round(titlePx * 0.42);
    const font = value(els.font, 'serif');
    const family = MEME_FONTS[font] || MEME_FONTS.serif;

    const title = els.top.value.trim() ? els.top.value.toUpperCase() : '';
    const sub = els.bottom.value.trim();

    measure.font = `${font === 'impact' ? '' : 'bold '}${titlePx}px ${family}`;
    const titleLines = title ? MemeText.wrap(measure, title, W * 0.86) : [];
    measure.font = `${subPx}px ${family}`;
    const subLines = sub ? MemeText.wrap(measure, sub, W * 0.82) : [];

    const gap = Math.round(W * 0.05);
    const titleH = titleLines.length * titlePx * 1.2;
    const subH = subLines.length * subPx * 1.45;
    const H = Math.round(pad + imgH + gap + titleH + (subH ? subPx * 0.5 + subH : 0) + pad * 0.8);

    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // The thin white line around the picture
    const border = Math.max(2, W / 260);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = border;
    const ring = W * 0.012;
    ctx.strokeRect(pad - ring - border / 2, pad - ring - border / 2, inner + (ring + border / 2) * 2, imgH + (ring + border / 2) * 2);
    ctx.drawImage(img, pad, pad, inner, imgH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = els.color ? els.color.value : '#fff';
    let y = pad + imgH + gap;
    ctx.font = `${font === 'impact' ? '' : 'bold '}${titlePx}px ${family}`;
    titleLines.forEach((line, i) => ctx.fillText(line, W / 2, y + titlePx * 0.6 + i * titlePx * 1.2));
    y += titleH + subPx * 0.5;
    ctx.font = `${subPx}px ${family}`;
    subLines.forEach((line, i) => ctx.fillText(line, W / 2, y + subPx * 0.72 + i * subPx * 1.45));

    hitBoxes = [];
    return { W, H };
  }

  function draw(canvas, W, guides) {
    if (mode === 'caption' || mode === 'reaction') return drawCaption(canvas, W, guides);
    if (mode === 'demotivational') return drawDemotivational(canvas, W);
    return drawClassic(canvas, W, guides);
  }

  const redraw = frameThrottle(() => {
    if (!tool.image) return;
    draw(els.canvas, Math.min(PREVIEW_MAX, tool.image.img.naturalWidth), true);
  });

  // Fonts load late; redraw once they arrive so the first preview is right
  function loadFont(key) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const probe = MemeText.fontCss(key, 40);
    const extra = key === 'impact' ? document.fonts.load('40px "Anton"').catch(() => {}) : Promise.resolve();
    return Promise.all([document.fonts.load(probe).catch(() => {}), extra]);
  }
  loadFont(value(els.font, 'impact')).then(redraw);

  function changed() {
    hideResult(section);
    redraw();
  }

  /* ---------- Controls ---------- */

  ['top', 'bottom', 'extra'].forEach((name) => {
    if (!els[name]) return;
    els[name].addEventListener('input', changed);
    els[name].addEventListener('focus', () => {
      if (mode === 'classic') selected = name;
      redraw();
    });
  });
  [els.size, els.stroke, els.color, els.strokeColor, els.barColor, els.stickerSize]
    .filter(Boolean)
    .forEach((c) => c.addEventListener('input', changed));
  [els.caps, els.guides, els.plate, els.barPos, els.align].filter(Boolean).forEach((c) => c.addEventListener('change', changed));
  if (els.font) {
    els.font.addEventListener('change', () => loadFont(els.font.value).then(changed));
  }

  // "White / Black / ..." chips next to a colour picker
  function bindChips(box, picker) {
    if (!box || !picker) return;
    $$('[data-color]', box).forEach((chip) =>
      chip.addEventListener('click', () => {
        picker.value = chip.dataset.color;
        changed();
      })
    );
  }
  bindChips($('#mm-color-box'), els.color);
  bindChips($('#mm-bar-box'), els.barColor);

  // Quick-start wordings (Image to Meme)
  $$('[data-fill]', section).forEach((chip) =>
    chip.addEventListener('click', () => {
      ['top', 'bottom', 'extra'].forEach((name) => {
        if (els[name]) els[name].value = chip.dataset[name] || '';
      });
      changed();
      if (els.top) els.top.focus();
    })
  );

  // Emoji stickers
  const stickerChips = $$('[data-sticker]', section);
  function markStickers() {
    stickerChips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.sticker === sticker)));
  }
  stickerChips.forEach((chip) =>
    chip.addEventListener('click', () => {
      sticker = chip.dataset.sticker;
      selected = 'sticker';
      markStickers();
      changed();
    })
  );
  markStickers();

  if (els.reset) {
    els.reset.addEventListener('click', () => {
      pos = home();
      changed();
    });
  }

  /* ---------- Dragging ---------- */

  function pointer(event) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * els.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * els.canvas.height
    };
  }

  const hit = (p) =>
    [...hitBoxes].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);

  let drag = null;

  els.canvas.addEventListener('pointerdown', (event) => {
    if (!tool.image) return;
    const p = pointer(event);
    const box = hit(p);
    if (!box) return;
    selected = box.name;
    drag = { name: box.name, dx: p.x - (box.x + box.w / 2), dy: p.y - (box.y + box.h / 2) };
    els.canvas.setPointerCapture(event.pointerId);
    els.canvas.classList.add('is-grabbing');
    event.preventDefault();
    redraw();
  });

  els.canvas.addEventListener('pointermove', (event) => {
    if (!tool.image) return;
    const p = pointer(event);
    if (!drag) {
      els.canvas.classList.toggle('is-text', Boolean(hit(p)));
      return;
    }
    pos[drag.name] = Object.assign(pos[drag.name], {
      x: clamp((p.x - drag.dx) / els.canvas.width, 0, 1),
      y: clamp((p.y - drag.dy) / els.canvas.height, 0, 1)
    });
    hideResult(section);
    redraw();
  });

  const endDrag = () => {
    drag = null;
    els.canvas.classList.remove('is-grabbing');
  };
  els.canvas.addEventListener('pointerup', endDrag);
  els.canvas.addEventListener('pointercancel', endDrag);

  // Arrow keys nudge the selected piece (hold Shift for bigger steps)
  els.canvas.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!move || !tool.image || !pos[selected] || !hitBoxes.length) return;
    event.preventDefault();
    pos[selected].x = clamp(pos[selected].x + move[0], 0, 1);
    pos[selected].y = clamp(pos[selected].y + move[1], 0, 1);
    changed();
  });

  /* ---------- Making the picture ---------- */

  async function render(maxW) {
    const { img } = tool.image;
    let W = Math.min(img.naturalWidth, maxW || MAX_SIDE);
    let note = '';
    await loadFont(value(els.font, 'impact'));

    const canvas = document.createElement('canvas');
    let size = draw(canvas, W, false);
    const k = Math.min(1, MAX_SIDE / Math.max(size.W, size.H), Math.sqrt(MAX_PIXELS / (size.W * size.H)));
    if (k < 1) {
      W = Math.floor(W * k);
      size = draw(canvas, W, false);
      note = 'The picture is very large, so it was saved a little smaller to stay within browser limits.';
    }
    return { canvas, size, note };
  }

  els.go.addEventListener('click', () =>
    withBusy(els.go, section, async () => {
      say(section, '');
      if (!tool.image) return;
      const { canvas, size, note } = await render();
      const blob = await canvasToBlob(canvas, value(els.format, 'image/jpeg'), 0.92);
      showResult(section, {
        original: null,
        blob,
        width: size.W,
        height: size.H,
        filename: `${baseName(tool.image.file.name)}-${section.dataset.suffix || 'meme'}.${EXT[blob.type] || 'png'}`
      });
      say(section, note);
    })
  );

  // Copy the finished picture, ready to paste into a chat
  if (els.copy) {
    els.copy.addEventListener('click', () =>
      withBusy(els.copy, section, async () => {
        say(section, '');
        if (!tool.image) return;
        if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
          throw new Error('This browser cannot copy pictures. Use the make button, then download it.');
        }
        const { canvas } = await render(2048);
        const blob = await canvasToBlob(canvas, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        say(section, 'Copied. Paste it into a chat or a post.');
      })
    );
  }

  /* ---------- Template gallery (Meme Templates page) ---------- */

  const gallery = $('#mm-templates');
  if (gallery) {
    const input = $('.dropzone input[type="file"]', section);

    const TEMPLATES = [
      {
        id: 'sunset', name: 'Sunset', w: 900, h: 600,
        paint(ctx, w, h) {
          const g = ctx.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, '#4b2a86'); g.addColorStop(0.55, '#d6456f'); g.addColorStop(1, '#ff9a4a');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = 'rgba(255, 236, 170, 0.9)';
          ctx.beginPath(); ctx.arc(w / 2, h * 0.62, h * 0.17, 0, Math.PI * 2); ctx.fill();
        }
      },
      {
        id: 'before-after', name: 'Before and after', w: 1000, h: 600,
        labels: { top: 'Left text', bottom: 'Right text', extra: 'Heading (optional)' },
        pos: { top: { x: 0.25, y: 0.55, w: 0.42 }, bottom: { x: 0.75, y: 0.55, w: 0.42 }, extra: { x: 0.5, y: 0.1, w: 0.9 } },
        size: 7,
        paint(ctx, w, h) {
          ctx.fillStyle = '#2f6fed'; ctx.fillRect(0, 0, w / 2, h);
          ctx.fillStyle = '#e0446b'; ctx.fillRect(w / 2, 0, w / 2, h);
          ctx.fillStyle = '#fff'; ctx.fillRect(w / 2 - 4, 0, 8, h);
        }
      },
      {
        id: 'two-choices', name: 'No and yes', w: 800, h: 900,
        labels: { top: 'No (top row)', bottom: 'Yes (bottom row)', extra: 'Heading (optional)' },
        pos: { top: { x: 0.6, y: 0.25, w: 0.66 }, bottom: { x: 0.6, y: 0.75, w: 0.66 }, extra: { x: 0.5, y: 0.5, w: 0.9 } },
        size: 7,
        paint(ctx, w, h) {
          ctx.fillStyle = '#d94b4b'; ctx.fillRect(0, 0, w, h / 2);
          ctx.fillStyle = '#2f9e5b'; ctx.fillRect(0, h / 2, w, h / 2);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(80, h * 0.25 - 50); ctx.lineTo(180, h * 0.25 + 50);
          ctx.moveTo(180, h * 0.25 - 50); ctx.lineTo(80, h * 0.25 + 50); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(70, h * 0.75); ctx.lineTo(120, h * 0.75 + 48); ctx.lineTo(190, h * 0.75 - 50); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.fillRect(0, h / 2 - 4, w, 8);
        }
      },
      {
        id: 'three-panels', name: 'Three panels', w: 1200, h: 600,
        labels: { top: 'Left', bottom: 'Right', extra: 'Middle' },
        pos: { top: { x: 0.1667, y: 0.5, w: 0.28 }, bottom: { x: 0.8333, y: 0.5, w: 0.28 }, extra: { x: 0.5, y: 0.5, w: 0.28 } },
        size: 5,
        paint(ctx, w, h) {
          ['#2f6fed', '#7a4bd1', '#e0446b'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect((w / 3) * i, 0, w / 3, h); });
          ctx.fillStyle = '#fff'; ctx.fillRect(w / 3 - 4, 0, 8, h); ctx.fillRect((w * 2) / 3 - 4, 0, 8, h);
        }
      },
      {
        id: 'dark', name: 'Dark card', w: 900, h: 900,
        paint(ctx, w, h) {
          ctx.fillStyle = '#14181b'; ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = '#2c353b'; ctx.lineWidth = 6; ctx.strokeRect(30, 30, w - 60, h - 60);
        }
      },
      {
        id: 'plain-white', name: 'Plain white', w: 900, h: 900,
        color: '#111111', stroke: 0,
        paint(ctx, w, h) {
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        }
      }
    ];

    function useTemplate(template) {
      pending = template;
      const canvas = document.createElement('canvas');
      canvas.width = template.w;
      canvas.height = template.h;
      template.paint(canvas.getContext('2d'), template.w, template.h);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const file = new File([blob], `${template.id}-template.png`, { type: 'image/png' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => $('.workspace', section).scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
      }, 'image/png');
    }

    TEMPLATES.forEach((template) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'template-btn';

      const thumb = document.createElement('canvas');
      thumb.width = 240;
      thumb.height = 160; // every thumbnail has the same shape so the labels line up
      const full = document.createElement('canvas');
      full.width = template.w;
      full.height = template.h;
      template.paint(full.getContext('2d'), template.w, template.h);
      // Fit the whole template inside the thumbnail, centred
      const fit = Math.min(thumb.width / template.w, thumb.height / template.h);
      const tw = template.w * fit;
      const th = template.h * fit;
      const tctx = thumb.getContext('2d');
      tctx.fillStyle = '#e8edf0';
      tctx.fillRect(0, 0, thumb.width, thumb.height);
      tctx.drawImage(full, (thumb.width - tw) / 2, (thumb.height - th) / 2, tw, th);
      thumb.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.textContent = template.name;
      button.append(thumb, name);
      button.addEventListener('click', () => useTemplate(template));
      gallery.append(button);
    });
  }
})();
