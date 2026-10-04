'use strict';

/* ==========================================================
   Lightbench: GIF meme maker.

   Open an animated GIF, put meme text on it, save a new GIF.
     1. The browser's own decoder (ImageDecoder) reads every frame.
     2. The text is drawn on every frame.
     3. GifMaker (from gif-maker.js) writes the new GIF.

   Needs script.js, docs.js, meme.js (MemeText) and gif-maker.js (GifMaker).
   ========================================================== */

(function initGifMeme() {
  const section = $('#tool-gifmeme');
  if (!section) return; // this tool is not on the current page

  const STORE_WIDTH = 640;   // frames are kept at this width at most
  const MAX_FRAMES = 150;    // GIFs with more frames than this lose every other (or third...) frame
  const MIN_DELAY = 20;      // ms; browsers play anything faster than this slowly

  const q = (id) => $(`#gm-${id}`);
  const els = {
    top: q('top'), bottom: q('bottom'), font: q('font'), caps: q('caps'),
    size: q('size'), stroke: q('stroke'), color: q('color'), strokeColor: q('stroke-color'),
    width: q('width'), speed: q('speed'), preview: q('preview'), note: q('preview-note'),
    play: q('play'), go: q('go'), info: q('info')
  };
  ['size', 'stroke'].forEach((name) => bindSlider(els[name], q(`${name}-out`)));

  let frames = [];     // [{ canvas, delay }]
  let fileName = 'animation';
  let step = 0;
  let timer = 0;
  let playing = true;
  let loadToken = 0;

  const TEXT_POS = {
    top: { x: 0.5, y: 0.12, w: 0.94 },
    bottom: { x: 0.5, y: 0.88, w: 0.94 }
  };

  /* ----- Text on one frame ----- */

  function textOptions(W, H) {
    return {
      W, H,
      px: Math.max(8, Math.round((W * Number(els.size.value)) / 100)),
      outline: Number(els.stroke.value),
      color: els.color.value,
      strokeColor: els.strokeColor.value,
      font: els.font.value,
      caps: els.caps.checked,
      plate: 'none',
      items: [
        { name: 'top', text: els.top.value, ...TEXT_POS.top },
        { name: 'bottom', text: els.bottom.value, ...TEXT_POS.bottom }
      ]
    };
  }

  function paintFrame(ctx, frame, W, H) {
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff'; // under any see-through parts of the GIF
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(frame.canvas, 0, 0, W, H);
    MemeText.drawLines(ctx, textOptions(W, H));
  }

  // Size of the finished GIF
  function outputSize() {
    if (!frames.length) return { w: 0, h: 0 };
    const stored = frames[0].canvas;
    const w = Math.min(Number(els.width.value), stored.width);
    return { w, h: Math.max(1, Math.round((w * stored.height) / stored.width)) };
  }

  /* ----- Live preview ----- */

  function paintPreview() {
    if (!frames.length) return;
    const frame = frames[step % frames.length];
    const stored = frame.canvas;
    const k = Math.min(1, 560 / stored.width);
    const w = Math.max(1, Math.round(stored.width * k));
    const h = Math.max(1, Math.round(stored.height * k));
    if (els.preview.width !== w || els.preview.height !== h) {
      els.preview.width = w;
      els.preview.height = h;
    }
    paintFrame(els.preview.getContext('2d'), frame, w, h);
    els.note.textContent = `Frame ${(step % frames.length) + 1} of ${frames.length}`;
  }

  const speed = () => Number(els.speed.value) || 1;

  function tick() {
    clearTimeout(timer);
    if (!frames.length) return;
    paintPreview();
    if (!playing || frames.length < 2) return;
    const wait = Math.max(MIN_DELAY, frames[step % frames.length].delay / speed());
    step = (step + 1) % frames.length;
    timer = setTimeout(tick, wait);
  }

  const repaint = frameThrottle(() => {
    if (!playing || frames.length < 2) paintPreview();
  });

  els.play.addEventListener('click', () => {
    playing = !playing;
    els.play.textContent = playing ? 'Pause preview' : 'Play preview';
    els.play.setAttribute('aria-pressed', String(!playing));
    if (playing) tick();
  });

  function changed() {
    hideResult(section);
    repaint();
    showInfo();
  }

  function showInfo() {
    if (!frames.length) {
      els.info.textContent = '';
      return;
    }
    const { w, h } = outputSize();
    const total = frames.reduce((sum, f) => sum + f.delay, 0) / speed() / 1000;
    els.info.textContent = `${frames.length} frames, ${w} \u00d7 ${h} px, about ${total.toFixed(1)} seconds per loop.`;
  }

  [els.top, els.bottom, els.size, els.stroke, els.color, els.strokeColor].forEach((c) => c.addEventListener('input', changed));
  [els.caps, els.width, els.speed].forEach((c) => c.addEventListener('change', () => { changed(); if (c === els.speed && playing) tick(); }));
  els.font.addEventListener('change', () => {
    const probe = MemeText.fontCss(els.font.value, 40);
    (document.fonts && document.fonts.load ? document.fonts.load(probe).catch(() => {}) : Promise.resolve()).then(changed);
  });
  $$('#gm-color-box [data-color]', section).forEach((chip) =>
    chip.addEventListener('click', () => {
      els.color.value = chip.dataset.color;
      changed();
    })
  );

  /* ----- Opening the GIF ----- */

  async function load(file) {
    const token = ++loadToken;
    say(section, '');
    hideResult(section);

    if (file.type !== 'image/gif') {
      say(section, 'Choose a GIF file. For a normal picture, use the Meme Generator.', true);
      return;
    }
    if (!('ImageDecoder' in window)) {
      say(section, 'This browser cannot read the frames of a GIF. Try the latest Chrome, Edge, Safari or Firefox.', true);
      return;
    }

    let decoder;
    try {
      say(section, 'Reading the GIF...');
      decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
      await decoder.tracks.ready;
      await decoder.completed;
      const count = decoder.tracks.selectedTrack.frameCount;
      if (!count) throw new Error('This GIF has no frames.');

      const every = Math.max(1, Math.ceil(count / MAX_FRAMES));
      const durations = [];
      const kept = [];

      for (let i = 0; i < count; i++) {
        if (token !== loadToken) return; // a newer GIF was chosen meanwhile
        const { image } = await decoder.decode({ frameIndex: i });
        durations[i] = Math.max(MIN_DELAY, (image.duration || 100000) / 1000);

        if (i % every === 0) {
          const dw = image.displayWidth;
          const dh = image.displayHeight;
          const k = Math.min(1, STORE_WIDTH / dw);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(dw * k));
          canvas.height = Math.max(1, Math.round(dh * k));
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          kept.push({ index: i, canvas });
        }
        image.close();

        if (i % 8 === 7) {
          say(section, `Reading the GIF... frame ${i + 1} of ${count}`);
          await nextFrame();
        }
      }

      // A kept frame lasts as long as the frames it stands in for
      const list = kept.map((item, n) => {
        const end = n + 1 < kept.length ? kept[n + 1].index : count;
        let delay = 0;
        for (let i = item.index; i < end; i++) delay += durations[i];
        return { canvas: item.canvas, delay };
      });

      if (token !== loadToken) return;
      frames = list;
      fileName = baseName(file.name);
      step = 0;
      $('.workspace', section).hidden = false;
      if (frames.length < 2) {
        say(section, 'This GIF has only one frame, so the result will not move.');
      } else {
        say(section, every > 1 ? `This GIF is long, so every ${every === 2 ? 'other' : `${every}th`} frame was used to keep the file a sensible size.` : '');
      }

      // Offer widths up to the size we actually kept
      const stored = frames[0].canvas.width;
      Array.from(els.width.options).forEach((option) => { option.disabled = Number(option.value) > stored && Number(option.value) !== 240; });
      if (els.width.selectedOptions[0] && els.width.selectedOptions[0].disabled) els.width.value = '240';
      showInfo();
      tick();
    } catch (error) {
      say(section, error && error.message ? error.message : 'This GIF could not be read.', true);
    } finally {
      if (decoder) decoder.close();
    }
  }

  setupDropzone(section, load, { pasteFilter: (f) => f.type === 'image/gif' });

  /* ----- Making the new GIF ----- */

  els.go.addEventListener('click', () =>
    withBusy(els.go, section, async () => {
      say(section, '');
      if (!frames.length) return;

      const { w, h } = outputSize();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const grab = (frame) => {
        paintFrame(ctx, frame, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };

      const probe = MemeText.fontCss(els.font.value, 40);
      if (document.fonts && document.fonts.load) await document.fonts.load(probe).catch(() => {});

      // Pass 1: one palette that suits every frame
      const histogram = new Uint32Array(32768);
      const pixelStep = Math.max(1, Math.floor((w * h) / 60000));
      for (let i = 0; i < frames.length; i++) {
        say(section, `Choosing colours... frame ${i + 1} of ${frames.length}`);
        await nextFrame();
        GifMaker.sampleFrame(histogram, grab(frames[i]), pixelStep);
      }
      const palette = GifMaker.buildPalette(histogram, 256);
      let bits = 1;
      while ((1 << bits) < palette.length) bits++;
      const minCodeSize = Math.max(bits, 2);

      // Pass 2: write every frame
      const encoded = [];
      for (let i = 0; i < frames.length; i++) {
        say(section, `Building the GIF... frame ${i + 1} of ${frames.length}`);
        await nextFrame();
        const indices = GifMaker.indexFrame(grab(frames[i]), w, h, palette, 0, true, false);
        encoded.push(GifMaker.lzwBlock(indices, minCodeSize));
      }

      const bytes = GifMaker.writeFile(
        { width: w, height: h, palette, transparent: false, loops: 0 },
        encoded,
        frames.map((frame, i) => ({ frame: i, delay: Math.max(2, Math.round(frame.delay / speed() / 10)) }))
      );
      const blob = new Blob([bytes], { type: 'image/gif' });
      showResult(section, { original: null, blob, width: w, height: h, filename: `${fileName}-meme.gif` });
      say(section, blob.size > 8 * 1024 * 1024 ? 'This GIF is large. For a smaller file, choose a smaller width.' : '');
    })
  );
})();
