'use strict';

/* ==========================================================
   Lightbench: Image Color Picker and Image Palette Generator.
   Both read pixels straight off a canvas, so nothing here
   needs a network connection.
   ========================================================== */

(function () {
  const section = $('[data-color-tool]');
  if (!section) return;
  const mode = section.dataset.colorTool; // "picker" or "palette"
  const el = (id) => document.getElementById(id);

  const MAX_SIDE = 1600; // big enough to pick precisely, small enough to stay fast

  function toCanvas(img) {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = scale >= 1;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function hex2(n) {
    return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  }

  function toHex(r, g, b) {
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
  }

  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function textFor(r, g, b) {
    const hsl = toHsl(r, g, b);
    return { hex: toHex(r, g, b), rgb: `rgb(${r}, ${g}, ${b})`, hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` };
  }


  /* ==========================================================
     COLOR PICKER
     ========================================================== */

  if (mode === 'picker') {
    const canvas = el('cp-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const loupe = el('cp-loupe');
    const loupeCtx = loupe.getContext('2d');
    const swatchNow = el('cp-current');
    const hexOut = el('cp-hex');
    const rgbOut = el('cp-rgb');
    const hslOut = el('cp-hsl');
    const listBox = el('cp-list');
    const emptyNote = el('cp-empty');
    const clearButton = el('cp-clear');

    let source = null;
    let picked = [];

    createTool(section.id.replace('tool-', ''), ({ img }) => {
      source = toCanvas(img);
      const stage = canvas.closest('.stage');
      layout(stage);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      setCurrent(128, 128, 128, true);
    });

    function layout(stage) {
      const avail = stage.clientWidth - 56;
      const ratio = source.width / source.height;
      const maxH = clamp(window.innerHeight * 0.6, 240, 560);
      const cw = Math.max(80, Math.min(avail, maxH * ratio, 900));
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${cw / ratio}px`;
      canvas.width = source.width;
      canvas.height = source.height;
      ctx.imageSmoothingEnabled = false;
      if (source) ctx.drawImage(source, 0, 0);
    }
    window.addEventListener('resize', () => source && layout(canvas.closest('.stage')));

    function pixelAt(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const x = clamp(Math.floor(((clientX - box.left) / box.width) * canvas.width), 0, canvas.width - 1);
      const y = clamp(Math.floor(((clientY - box.top) / box.height) * canvas.height), 0, canvas.height - 1);
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return { x, y, r, g, b };
    }

    function setCurrent(r, g, b, quiet) {
      const t = textFor(r, g, b);
      swatchNow.style.background = t.hex;
      hexOut.textContent = t.hex;
      rgbOut.textContent = t.rgb;
      hslOut.textContent = t.hsl;
      if (!quiet) say(section, 'Click anywhere on the photo to pick that colour.');
    }

    function drawLoupe(x, y) {
      const size = 9; // pixels of source shown across the loupe
      const half = Math.floor(size / 2);
      loupeCtx.imageSmoothingEnabled = false;
      loupeCtx.clearRect(0, 0, loupe.width, loupe.height);
      loupeCtx.drawImage(
        canvas,
        clamp(x - half, 0, canvas.width - size), clamp(y - half, 0, canvas.height - size), size, size,
        0, 0, loupe.width, loupe.height
      );
      const cell = loupe.width / size;
      loupeCtx.strokeStyle = 'rgba(20, 24, 27, 0.5)';
      loupeCtx.lineWidth = 1;
      for (let i = 1; i < size; i++) {
        loupeCtx.beginPath(); loupeCtx.moveTo(i * cell, 0); loupeCtx.lineTo(i * cell, loupe.height); loupeCtx.stroke();
        loupeCtx.beginPath(); loupeCtx.moveTo(0, i * cell); loupeCtx.lineTo(loupe.width, i * cell); loupeCtx.stroke();
      }
      loupeCtx.strokeStyle = '#f2b705';
      loupeCtx.lineWidth = 2;
      loupeCtx.strokeRect(half * cell + 1, half * cell + 1, cell - 2, cell - 2);
    }

    canvas.addEventListener('pointermove', (event) => {
      if (!source) return;
      const p = pixelAt(event.clientX, event.clientY);
      setCurrent(p.r, p.g, p.b, true);
      drawLoupe(p.x, p.y);
      loupe.hidden = false;
    });
    canvas.addEventListener('pointerleave', () => { loupe.hidden = true; });

    function addSwatch(r, g, b) {
      const t = textFor(r, g, b);
      picked.unshift({ r, g, b, ...t });
      picked = picked.slice(0, 24);
      renderList();
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (!source) return;
      const p = pixelAt(event.clientX, event.clientY);
      setCurrent(p.r, p.g, p.b);
      addSwatch(p.r, p.g, p.b);
    });

    function renderList() {
      listBox.innerHTML = '';
      picked.forEach((c, i) => {
        const li = document.createElement('li');
        li.className = 'swatch';
        li.style.setProperty('--sw', c.hex);
        li.innerHTML = `<span class="swatch-color"></span><span class="swatch-hex">${c.hex}</span>`;
        li.title = `${c.hex} \u2013 click to copy`;
        li.addEventListener('click', () => copySwatch(c, li));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'swatch-x';
        remove.setAttribute('aria-label', `Remove ${c.hex}`);
        remove.textContent = '\u00d7';
        remove.addEventListener('click', (event) => { event.stopPropagation(); picked.splice(i, 1); renderList(); });
        li.append(remove);
        listBox.append(li);
      });
      emptyNote.hidden = Boolean(picked.length);
      clearButton.hidden = !picked.length;
    }

    async function copySwatch(c, li) {
      try { await navigator.clipboard.writeText(c.hex); } catch (error) { /* clipboard may be unavailable */ }
      say(section, `Copied ${c.hex} to the clipboard.`);
      li.classList.add('is-copied');
      setTimeout(() => li.classList.remove('is-copied'), 500);
    }

    [hexOut, rgbOut, hslOut].forEach((node) => {
      node.style.cursor = 'pointer';
      node.title = 'Click to copy';
      node.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(node.textContent); } catch (error) { /* ignore */ }
        say(section, `Copied ${node.textContent} to the clipboard.`);
      });
    });

    clearButton.addEventListener('click', () => { picked = []; renderList(); });
    renderList();
  }


  /* ==========================================================
     PALETTE GENERATOR
     ========================================================== */

  if (mode === 'palette') {
    const preview = el('pl-preview');
    const countInput = el('pl-count');
    const countOut = el('pl-count-out');
    const swatchBox = el('pl-swatches');
    const copyCss = el('pl-copy-css');
    const copyHex = el('pl-copy-hex');
    const downloadButton = el('pl-download');
    let source = null;
    let palette = [];
    let debounceTimer = 0;

    createTool(section.id.replace('tool-', ''), ({ img }) => {
      preview.src = img.src;
      source = sampleImage(img);
      generate();
    });

    function sampleImage(img) {
      const side = 160; // small and fast; colour, not detail, is what matters here
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const pixels = [];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue; // skip mostly-transparent pixels
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      return pixels;
    }

    // Picks the main colours of a picture (median cut on the picture's distinct colours).
    //  1. Pixels with nearly the same colour are counted together first, so a big flat
    //     area (a wall, a logo background) counts as one colour, not a hundred.
    //  2. The box holding the widest spread of colour is split at the middle of its
    //     weight until there are enough boxes.
    //  3. Boxes whose colours look the same are merged, so no two swatches repeat.
    function quantize(pixels, n) {
      // 1. Count nearly-equal colours together (5 bits per channel)
      const groups = new Map();
      pixels.forEach((p) => {
        const key = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3);
        const g = groups.get(key);
        if (g) { g.r += p[0]; g.g += p[1]; g.b += p[2]; g.count++; }
        else groups.set(key, { r: p[0], g: p[1], b: p[2], count: 1 });
      });
      const entries = Array.from(groups.values()).map((g) => ({
        c: [g.r / g.count, g.g / g.count, g.b / g.count], count: g.count
      }));
      const total = pixels.length || 1;

      const average = (bucket) => {
        let r = 0, g = 0, b = 0, count = 0;
        bucket.forEach((e) => { r += e.c[0] * e.count; g += e.c[1] * e.count; b += e.c[2] * e.count; count += e.count; });
        return { r: r / count, g: g / count, b: b / count, count };
      };

      // 2. Median cut into k boxes, splitting by weight
      function cut(k) {
        const buckets = [entries.slice()];
        while (buckets.length < k) {
          let idx = -1, bestRange = 0, bestChannel = 0;
          buckets.forEach((bucket, i) => {
            if (bucket.length < 2) return;
            for (let c = 0; c < 3; c++) {
              let min = 255, max = 0;
              bucket.forEach((e) => { if (e.c[c] < min) min = e.c[c]; if (e.c[c] > max) max = e.c[c]; });
              if (max - min > bestRange) { bestRange = max - min; idx = i; bestChannel = c; }
            }
          });
          if (idx === -1) break;                         // nothing left to tell apart
          const bucket = buckets[idx];
          bucket.sort((x, y) => x.c[bestChannel] - y.c[bestChannel]);
          const half = bucket.reduce((sum, e) => sum + e.count, 0) / 2;
          let run = 0, cutAt = 1;
          for (let i = 0; i < bucket.length; i++) {
            run += bucket[i].count;
            if (run >= half) { cutAt = Math.min(Math.max(i + 1, 1), bucket.length - 1); break; }
          }
          buckets.splice(idx, 1, bucket.slice(0, cutAt), bucket.slice(cutAt));
        }
        return buckets.map(average);
      }

      // 3. Merge colours that look the same (the larger one wins)
      function merge(list) {
        const out = [];
        list.slice().sort((x, y) => y.count - x.count).forEach((c) => {
          const twin = out.find((o) => Math.hypot(o.r - c.r, o.g - c.g, o.b - c.b) < 26);
          if (twin) {
            const sum = twin.count + c.count;
            twin.r = (twin.r * twin.count + c.r * c.count) / sum;
            twin.g = (twin.g * twin.count + c.g * c.count) / sum;
            twin.b = (twin.b * twin.count + c.b * c.count) / sum;
            twin.count = sum;
          } else {
            out.push({ ...c });
          }
        });
        return out;
      }

      // Ask for more boxes until enough different colours survive the merge
      let palette = [];
      const limit = Math.min(entries.length, n * 6);
      for (let k = Math.min(n, entries.length); k <= Math.max(limit, 1); k++) {
        palette = merge(cut(k));
        if (palette.length >= n) break;
      }
      return palette
        .sort((x, y) => y.count - x.count)
        .slice(0, n)
        .map((c) => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), share: c.count / total }));
    }

    function generate() {
      if (!source || !source.length) return;
      const n = Number(countInput.value);
      countOut.textContent = n;
      palette = quantize(source, n).map((c) => ({ ...c, ...textFor(c.r, c.g, c.b) }));
      renderSwatches();
      say(section, palette.length < n ? `This picture only has ${palette.length} clearly different colour${palette.length === 1 ? '' : 's'}.` : '');
      say(section, palette.length < n ? `This picture only has ${palette.length} clearly different colour${palette.length === 1 ? '' : 's'}, so that is all that was found.` : '');
    }

    function renderSwatches() {
      swatchBox.innerHTML = '';
      palette.forEach((c) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'palette-card';
        card.style.setProperty('--sw', c.hex);
        card.innerHTML = `
          <span class="palette-color"></span>
          <span class="palette-info">
            <span class="palette-hex">${c.hex}</span>
            <span class="palette-share">${Math.round(c.share * 100)}%</span>
          </span>`;
        card.title = `${c.hex} \u2013 click to copy`;
        card.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(c.hex); } catch (error) { /* ignore */ }
          say(section, `Copied ${c.hex} to the clipboard.`);
        });
        swatchBox.append(card);
      });
      const has = Boolean(palette.length);
      copyCss.disabled = !has;
      copyHex.disabled = !has;
      downloadButton.disabled = !has;
    }

    countInput.addEventListener('input', () => {
      countOut.textContent = countInput.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(generate, 120);
    });

    async function copyText(text, label) {
      try { await navigator.clipboard.writeText(text); say(section, `Copied ${label} to the clipboard.`); }
      catch (error) { say(section, 'Could not copy automatically. Select and copy the swatches manually.', true); }
    }

    copyCss.addEventListener('click', () => {
      const lines = [':root {', ...palette.map((c, i) => `  --color-${i + 1}: ${c.hex};`), '}'];
      copyText(lines.join('\n'), 'the CSS variables');
    });

    copyHex.addEventListener('click', () => {
      copyText(palette.map((c) => c.hex).join(', '), 'the hex codes');
    });

    downloadButton.addEventListener('click', () => {
      if (!palette.length) return;
      const swatchSize = 140;
      const canvas = document.createElement('canvas');
      canvas.width = swatchSize * palette.length;
      canvas.height = swatchSize + 40;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      palette.forEach((c, i) => {
        const x = i * swatchSize;
        ctx.fillStyle = c.hex;
        ctx.fillRect(x, 0, swatchSize, swatchSize);
        ctx.fillStyle = '#14181b';
        ctx.fillText(c.hex, x + swatchSize / 2, swatchSize + 24);
      });
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'palette.png';
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    });
  }
})();
