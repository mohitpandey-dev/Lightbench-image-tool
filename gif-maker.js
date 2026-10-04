'use strict';

/* ==========================================================
   Lightbench: GIF maker.

   Turns a set of pictures into one animated GIF. The GIF file is
   written right here in the browser (no library, no upload):
     1. Pick a colour palette from all the frames (median cut).
     2. Turn each frame into palette numbers (optionally dithered).
     3. Squeeze each frame with LZW and write the GIF89a file.

   Needs script.js (setupDropzone, say, withBusy, showResult,
   hideResult, bindSlider, clamp) and docs.js (createImageList,
   drawImageFit, frameThrottle, bindSwatches, nextFrame).
   ========================================================== */

/* ---------- The GIF writer ---------- */

const GifMaker = (function () {
  // A growing list of bytes
  class Bytes {
    constructor(size = 1 << 16) {
      this.data = new Uint8Array(size);
      this.length = 0;
    }
    ensure(extra) {
      if (this.length + extra <= this.data.length) return;
      let size = this.data.length * 2;
      while (size < this.length + extra) size *= 2;
      const next = new Uint8Array(size);
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    byte(value) {
      this.ensure(1);
      this.data[this.length++] = value;
    }
    word(value) {
      this.byte(value & 255);
      this.byte((value >> 8) & 255);
    }
    bytes(array) {
      this.ensure(array.length);
      this.data.set(array, this.length);
      this.length += array.length;
    }
    ascii(text) {
      for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i));
    }
    result() {
      return this.data.subarray(0, this.length);
    }
  }

  /* ----- Palette: median cut on a 5-bits-per-channel histogram ----- */

  const key15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

  // Adds one frame's pixels to the histogram (every `step`-th pixel)
  function sampleFrame(histogram, rgba, step) {
    for (let i = 0; i < rgba.length; i += 4 * step) {
      if (rgba[i + 3] < 128) continue; // see-through pixels do not need a colour
      histogram[key15(rgba[i], rgba[i + 1], rgba[i + 2])]++;
    }
  }

  // Returns [[r,g,b], ...] with at most `count` colours
  function buildPalette(histogram, count) {
    let entries = [];
    for (let k = 0; k < histogram.length; k++) {
      if (histogram[k]) entries.push(k);
    }
    if (!entries.length) return [[0, 0, 0]];

    const channel = (k, c) => (c === 0 ? (k >> 10) & 31 : c === 1 ? (k >> 5) & 31 : k & 31);

    const makeBox = (list) => {
      const min = [31, 31, 31];
      const max = [0, 0, 0];
      let total = 0;
      for (const k of list) {
        total += histogram[k];
        for (let c = 0; c < 3; c++) {
          const v = channel(k, c);
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }
      const range = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
      const axis = range[0] >= range[1] && range[0] >= range[2] ? 0 : range[1] >= range[2] ? 1 : 2;
      return { list, total, axis, range: range[axis] };
    };

    const boxes = [makeBox(entries)];
    while (boxes.length < count) {
      // Split the box that holds the most pixels and still has more than one colour
      let pick = -1;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.list.length < 2) continue;
        if (pick < 0 || box.total * (1 + box.range) > boxes[pick].total * (1 + boxes[pick].range)) pick = i;
      }
      if (pick < 0) break;

      const box = boxes[pick];
      const axis = box.axis;
      box.list.sort((a, b) => channel(a, axis) - channel(b, axis));
      let running = 0;
      let cut = 1;
      for (let i = 0; i < box.list.length; i++) {
        running += histogram[box.list[i]];
        if (running >= box.total / 2) {
          cut = clamp(i + 1, 1, box.list.length - 1);
          break;
        }
      }
      boxes.splice(pick, 1, makeBox(box.list.slice(0, cut)), makeBox(box.list.slice(cut)));
    }

    return boxes.map((box) => {
      let r = 0, g = 0, b = 0;
      for (const k of box.list) {
        const w = histogram[k];
        r += ((k >> 10) & 31) * w;
        g += ((k >> 5) & 31) * w;
        b += (k & 31) * w;
      }
      const n = box.total || 1;
      // 5-bit values back to 8-bit (the +4 puts us in the middle of each bucket)
      return [
        clamp(Math.round((r / n) * 8 + 4), 0, 255),
        clamp(Math.round((g / n) * 8 + 4), 0, 255),
        clamp(Math.round((b / n) * 8 + 4), 0, 255)
      ];
    });
  }

  /* ----- Turning pixels into palette numbers ----- */

  // palette: [[r,g,b]...]; offset: index of the first real colour
  // (1 when index 0 is kept free for transparency)
  function makeIndexer(palette, offset) {
    const cache = new Int16Array(32768).fill(-1);
    const n = palette.length;
    const pr = new Int16Array(n), pg = new Int16Array(n), pb = new Int16Array(n);
    palette.forEach((c, i) => { pr[i] = c[0]; pg[i] = c[1]; pb[i] = c[2]; });

    return function nearest(r, g, b) {
      const k = key15(r, g, b);
      let hit = cache[k];
      if (hit >= 0) return hit;
      // Compare against the middle of the bucket so every pixel in it agrees
      const cr = ((r >> 3) << 3) + 4, cg = ((g >> 3) << 3) + 4, cb = ((b >> 3) << 3) + 4;
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < n; i++) {
        const dr = pr[i] - cr, dg = pg[i] - cg, db = pb[i] - cb;
        const d = dr * dr * 3 + dg * dg * 4 + db * db * 2; // the eye is most sensitive to green
        if (d < bestDist) { bestDist = d; best = i; }
      }
      hit = best + offset;
      cache[k] = hit;
      return hit;
    };
  }

  // rgba -> one palette number per pixel
  function indexFrame(rgba, width, height, palette, offset, dither, transparent) {
    const out = new Uint8Array(width * height);
    const nearest = makeIndexer(palette, offset);

    if (!dither) {
      for (let p = 0, i = 0; p < out.length; p++, i += 4) {
        out[p] = transparent && rgba[i + 3] < 128 ? 0 : nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
      }
      return out;
    }

    // Floyd-Steinberg: spread each pixel's colour error onto its neighbours
    let cur = new Float32Array((width + 2) * 3);
    let next = new Float32Array((width + 2) * 3);
    for (let y = 0; y < height; y++) {
      next.fill(0);
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const i = p * 4;
        if (transparent && rgba[i + 3] < 128) {
          out[p] = 0;
          continue;
        }
        const e = (x + 1) * 3;
        const r = clamp(Math.round(rgba[i] + cur[e]), 0, 255);
        const g = clamp(Math.round(rgba[i + 1] + cur[e + 1]), 0, 255);
        const b = clamp(Math.round(rgba[i + 2] + cur[e + 2]), 0, 255);
        const index = nearest(r, g, b);
        out[p] = index;
        const c = palette[index - offset];
        const er = r - c[0], eg = g - c[1], eb = b - c[2];
        // right 7/16, below-left 3/16, below 5/16, below-right 1/16
        cur[e + 3] += er * 0.4375; cur[e + 4] += eg * 0.4375; cur[e + 5] += eb * 0.4375;
        next[e - 3] += er * 0.1875; next[e - 2] += eg * 0.1875; next[e - 1] += eb * 0.1875;
        next[e] += er * 0.3125; next[e + 1] += eg * 0.3125; next[e + 2] += eb * 0.3125;
        next[e + 3] += er * 0.0625; next[e + 4] += eg * 0.0625; next[e + 5] += eb * 0.0625;
      }
      [cur, next] = [next, cur];
    }
    return out;
  }

  /* ----- LZW, the compression GIF uses ----- */

  // Returns the "image data" part of a frame: minimum code size, then
  // the compressed bytes cut into blocks of up to 255 bytes.
  function lzwBlock(indices, minCodeSize) {
    const out = new Bytes(Math.max(1024, indices.length >> 1));
    out.byte(minCodeSize);

    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let dict = new Map();

    let bitBuffer = 0;
    let bitCount = 0;
    const block = new Uint8Array(255);
    let blockLength = 0;

    const pushByte = (value) => {
      block[blockLength++] = value;
      if (blockLength === 255) {
        out.byte(255);
        out.bytes(block);
        blockLength = 0;
      }
    };
    const emit = (code) => {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        pushByte(bitBuffer & 255);
        bitBuffer >>>= 8;
        bitCount -= 8;
      }
    };

    emit(clearCode);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const value = indices[i];
      const key = (prefix << 8) | value;
      const found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix);
      if (nextCode < 4096) {
        dict.set(key, nextCode++);
        if (nextCode - 1 === (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        // Dictionary is full: tell the viewer to start again
        emit(clearCode);
        dict = new Map();
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      }
      prefix = value;
    }
    emit(prefix);
    emit(endCode);
    if (bitCount > 0) pushByte(bitBuffer & 255);
    if (blockLength > 0) {
      out.byte(blockLength);
      out.bytes(block.subarray(0, blockLength));
    }
    out.byte(0); // end of this frame's data
    return out.result();
  }

  /* ----- Putting the file together ----- */

  // options: width, height, palette (array of [r,g,b]), transparent (bool),
  // loops (0 = forever, 1 = once, n = n times)
  // frames: [{ indices: Uint8Array }]   sequence: [{ frame: i, delay: centiseconds }]
  function writeFile({ width, height, palette, transparent, loops }, encoded, sequence) {
    const colours = palette.length + (transparent ? 1 : 0);
    let bits = 1;
    while ((1 << bits) < colours) bits++;
    bits = Math.max(bits, 2);
    const tableSize = 1 << bits;

    const out = new Bytes(1 << 18);
    out.ascii('GIF89a');
    out.word(width);
    out.word(height);
    out.byte(0x80 | ((bits - 1) << 4) | (bits - 1)); // global colour table, its size
    out.byte(0); // background colour index
    out.byte(0); // pixel aspect ratio

    const table = [];
    if (transparent) table.push([0, 0, 0]);
    palette.forEach((c) => table.push(c));
    while (table.length < tableSize) table.push([0, 0, 0]);
    table.forEach((c) => { out.byte(c[0]); out.byte(c[1]); out.byte(c[2]); });

    if (loops !== 1) {
      // Netscape extension: how many times to repeat after the first play
      out.byte(0x21); out.byte(0xff); out.byte(11);
      out.ascii('NETSCAPE2.0');
      out.byte(3); out.byte(1);
      out.word(loops === 0 ? 0 : loops - 1);
      out.byte(0);
    }

    sequence.forEach(({ frame, delay }) => {
      out.byte(0x21); out.byte(0xf9); out.byte(4); // graphic control extension
      // dispose to background (2) when transparent, otherwise leave in place (1)
      out.byte(((transparent ? 2 : 1) << 2) | (transparent ? 1 : 0));
      out.word(delay);
      out.byte(0); // transparent colour index
      out.byte(0);

      out.byte(0x2c); // image descriptor
      out.word(0); out.word(0);
      out.word(width); out.word(height);
      out.byte(0); // no local colour table
      out.bytes(encoded[frame]);
    });

    out.byte(0x3b); // end of file
    return out.result();
  }

  return { Bytes, sampleFrame, buildPalette, indexFrame, lzwBlock, writeFile };
})();


/* ---------- The tool ---------- */

(function initGifMaker() {
  const section = $('#tool-gif');
  if (!section) return; // this tool is not on the current page

  const el = {
    width: $('#gf-width'),
    shape: $('#gf-shape'),
    fit: $('#gf-fit'),
    fitField: $('#gf-fit-field'),
    bg: $('#gf-bg'),
    bgField: $('#gf-bg-field'),
    transparent: $('#gf-transparent'),
    delay: $('#gf-delay'),
    colours: $('#gf-colours'),
    loops: $('#gf-loops'),
    pingpong: $('#gf-pingpong'),
    dither: $('#gf-dither'),
    play: $('#gf-play'),
    preview: $('#gf-preview'),
    previewNote: $('#gf-preview-note'),
    go: $('#gf-go'),
    estimate: $('#gf-estimate')
  };

  const MAX_SIDE = 1600;           // longest side of the finished GIF
  const MAX_PIXELS_TOTAL = 160e6;  // frames x width x height, to keep the browser happy
  const SAMPLE_PIXELS = 60000;     // pixels per frame used to choose the palette

  bindSlider(el.delay, $('#gf-delay-out'));

  /* ----- Sizes ----- */

  function aspect(items) {
    if (el.shape.value !== 'first') return Number(el.shape.value);
    return items.length ? items[0].width / items[0].height : 1;
  }

  function outputSize(items) {
    const a = aspect(items);
    let w = Number(el.width.value);
    let h = Math.round(w / a);
    if (Math.max(w, h) > MAX_SIDE) {
      const k = MAX_SIDE / Math.max(w, h);
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  const wantsTransparent = () => el.transparent.checked && el.fit.value === 'contain';

  // Draws one picture into a canvas of the given size
  function drawFrame(ctx, item, source, sw, sh, w, h) {
    ctx.clearRect(0, 0, w, h);
    if (!wantsTransparent()) {
      ctx.fillStyle = el.bg.value;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    drawImageFit(ctx, source, sw, sh, { x: 0, y: 0, w, h }, el.fit.value, 0);
  }

  // The order the frames play in (forward, or forward then back)
  function playOrder(count) {
    const order = Array.from({ length: count }, (_, i) => i);
    if (el.pingpong.checked && count > 2) {
      for (let i = count - 2; i >= 1; i--) order.push(i);
    }
    return order;
  }

  /* ----- Live preview: the frames play on a canvas ----- */

  let step = 0;
  let timer = 0;
  let playing = true;

  function paintPreview() {
    const items = list.items;
    if (!items.length) return;
    const order = playOrder(items.length);
    const item = items[order[step % order.length]];
    const size = outputSize(items);
    const k = Math.min(1, 640 / size.w);
    const w = Math.max(1, Math.round(size.w * k));
    const h = Math.max(1, Math.round(size.h * k));
    if (el.preview.width !== w || el.preview.height !== h) {
      el.preview.width = w;
      el.preview.height = h;
    }
    const ctx = el.preview.getContext('2d');
    drawFrame(ctx, item, item.proxy, item.proxy.width, item.proxy.height, w, h);
    el.previewNote.textContent = `Frame ${(order[step % order.length]) + 1} of ${items.length}`;
  }

  function tick() {
    clearTimeout(timer);
    if (!list.items.length) return;
    paintPreview();
    if (!playing || list.items.length < 2) return;
    step++;
    timer = setTimeout(tick, Number(el.delay.value));
  }

  const repaint = frameThrottle(() => {
    paintPreview();
  });

  function restart() {
    step = 0;
    clearTimeout(timer);
    if (list.items.length) tick();
  }

  el.play.addEventListener('click', () => {
    playing = !playing;
    el.play.textContent = playing ? 'Pause preview' : 'Play preview';
    el.play.setAttribute('aria-pressed', String(!playing));
    if (playing) tick();
  });

  /* ----- The list of frames ----- */

  const list = createImageList(section, {
    keepProxy: true,
    moreLabel: 'Drop more pictures here or choose files',
    pastedName: 'frame',
    onChange(items) {
      refreshControls();
      restart();
      showEstimate();
    }
  });
  setupDropzone(section, (files) => list.add(files), { multiple: true });

  function showEstimate() {
    const items = list.items;
    if (!items.length) {
      el.estimate.textContent = '';
      return;
    }
    const size = outputSize(items);
    const seconds = (playOrder(items.length).length * Number(el.delay.value)) / 1000;
    el.estimate.textContent =
      `${items.length} frame${items.length === 1 ? '' : 's'}, ${size.w} \u00d7 ${size.h} px, about ${seconds.toFixed(1)} seconds per loop.` +
      (items.length === 1 ? ' Add at least two pictures to make it move.' : '');
  }

  function refreshControls() {
    const contain = el.fit.value === 'contain';
    el.transparent.closest('.check').hidden = !contain;
    el.bgField.hidden = wantsTransparent();
    $$('[data-color]', section).forEach((chip) => { chip.disabled = wantsTransparent(); });
  }

  [el.width, el.shape, el.fit].forEach((control) =>
    control.addEventListener('change', () => {
      hideResult(section);
      refreshControls();
      repaint();
      showEstimate();
    })
  );
  el.transparent.addEventListener('change', () => {
    hideResult(section);
    refreshControls();
    repaint();
  });
  el.pingpong.addEventListener('change', () => {
    hideResult(section);
    restart();
    showEstimate();
  });
  el.delay.addEventListener('input', () => {
    hideResult(section);
    showEstimate();
  });
  [el.colours, el.loops, el.dither].forEach((control) =>
    control.addEventListener('change', () => hideResult(section))
  );
  bindSwatches(section, el.bg, () => { hideResult(section); repaint(); });
  refreshControls();

  /* ----- Making the GIF ----- */

  el.go.addEventListener('click', () =>
    withBusy(el.go, section, async () => {
      say(section, '');
      const items = list.items;
      if (!items.length) return;

      const { w, h } = outputSize(items);
      const order = playOrder(items.length);
      if (w * h * items.length > MAX_PIXELS_TOTAL) {
        throw new Error('That is a lot of frames at this size. Use fewer pictures or a smaller width, then try again.');
      }

      const transparent = wantsTransparent();
      const maxColours = Number(el.colours.value) - (transparent ? 1 : 0);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const grab = (item) => {
        drawFrame(ctx, item, item.img, item.width, item.height, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };

      // Pass 1: choose one palette that suits every frame
      const histogram = new Uint32Array(32768);
      const pixelStep = Math.max(1, Math.floor((w * h) / SAMPLE_PIXELS));
      for (let i = 0; i < items.length; i++) {
        say(section, `Choosing colours... frame ${i + 1} of ${items.length}`);
        await nextFrame();
        GifMaker.sampleFrame(histogram, grab(items[i]), pixelStep);
      }
      const palette = GifMaker.buildPalette(histogram, maxColours);
      const offset = transparent ? 1 : 0;
      let bits = 1;
      while ((1 << bits) < palette.length + offset) bits++;
      const minCodeSize = Math.max(bits, 2);

      // Pass 2: turn every frame into palette numbers and compress it
      const encoded = [];
      for (let i = 0; i < items.length; i++) {
        say(section, `Building the GIF... frame ${i + 1} of ${items.length}`);
        await nextFrame();
        const rgba = grab(items[i]);
        const indices = GifMaker.indexFrame(rgba, w, h, palette, offset, el.dither.checked, transparent);
        encoded.push(GifMaker.lzwBlock(indices, minCodeSize));
      }

      const centis = Math.max(2, Math.round(Number(el.delay.value) / 10));
      const bytes = GifMaker.writeFile(
        { width: w, height: h, palette, transparent, loops: Number(el.loops.value) },
        encoded,
        order.map((frame) => ({ frame, delay: centis }))
      );
      const blob = new Blob([bytes], { type: 'image/gif' });

      showResult(section, { original: null, blob, width: w, height: h, filename: 'animation.gif' });
      const heavy = blob.size > 8 * 1024 * 1024;
      say(
        section,
        heavy
          ? 'This GIF is large. For a smaller file, use a smaller width, fewer colours or fewer frames.'
          : items.length === 1
            ? 'Only one picture was used, so this GIF does not move. Add more pictures for an animation.'
            : ''
      );
    })
  );
})();
