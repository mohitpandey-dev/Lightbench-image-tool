'use strict';

/* ==========================================================
   Lightbench: image and document tools.

   1. Image to PDF   2. JPG to PDF   3. PNG to PDF
   4. Screenshot to PDF (these four share one engine)
   5. PDF to Image   6. Collage maker
   7. Contact sheet  8. Sprite sheet

   Needs script.js (shared helpers) and docs-core.js (PDF writer,
   ZIP writer and layout maths). Every tool checks that its page
   is the current one before it starts.
   ========================================================== */

// Where this file lives, so the PDF reader can be found next to it
const DOCS_BASE = document.currentScript
  ? new URL('.', document.currentScript.src).href
  : new URL('.', document.baseURI).href;

const SITE_FONT = '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';


/* ---------- Small helpers ---------- */

// Lets the page repaint (progress messages) between heavy steps
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

// Runs `work` on a list, a few items at a time
async function mapLimit(list, limit, work) {
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      results[i] = await work(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}

// A smaller copy of an image or canvas, on a new canvas
function scaleCanvas(source, sw, sh, maxSide) {
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draws a picture inside a box. "cover" fills the box and crops the
// edges. "contain" shows the whole picture and leaves space around it.
function drawImageFit(ctx, source, sw, sh, box, fit, radius) {
  let dx = box.x, dy = box.y, dw = box.w, dh = box.h;
  let sx = 0, sy = 0, cw = sw, ch = sh;

  if (fit === 'cover') {
    const k = Math.max(dw / sw, dh / sh);
    cw = dw / k;
    ch = dh / k;
    sx = (sw - cw) / 2;
    sy = (sh - ch) / 2;
  } else {
    const k = Math.min(dw / sw, dh / sh);
    const w = sw * k;
    const h = sh * k;
    dx += (dw - w) / 2;
    dy += (dh - h) / 2;
    dw = w;
    dh = h;
  }

  ctx.save();
  if (radius > 0) {
    roundedRect(ctx, dx, dy, dw, dh, Math.min(radius, dw / 2, dh / 2));
    ctx.clip();
  }
  ctx.drawImage(source, sx, sy, cw, ch, dx, dy, dw, dh);
  ctx.restore();
}

// Shortens "a-very-long-name.jpg" to "a-very-lo…me.jpg" so it fits
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const dot = text.lastIndexOf('.');
  const ext = dot > 0 && text.length - dot <= 6 ? text.slice(dot) : '';
  const base = ext ? text.slice(0, dot) : text;
  for (let keep = base.length - 1; keep > 0; keep--) {
    const attempt = base.slice(0, keep) + '\u2026' + ext;
    if (ctx.measureText(attempt).width <= maxWidth) return attempt;
  }
  return '\u2026' + ext;
}

async function copyText(button, text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const helper = document.createElement('textarea');
    helper.value = text;
    document.body.append(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = label; }, 1500);
}

// Links a colour picker and its "White / Black / ..." chips
function bindSwatches(section, picker, onChange) {
  $$('[data-color]', section).forEach((chip) => {
    chip.addEventListener('click', () => {
      picker.value = chip.dataset.color;
      onChange();
    });
  });
  picker.addEventListener('input', onChange);
}

// Repaints a preview at most once per frame
function frameThrottle(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}


/* ==========================================================
   Shared: the list of images (thumbnails you can reorder)
   ========================================================== */

const IMAGE_LIMIT = 200;
const PROXY_SIDE = 560; // size of the small copy used for thumbnails and live previews

function createImageList(section, options = {}) {
  const listEl = $('.filelist', section);
  const countEl = $('.filelist-count', section);
  const workspace = $('.workspace', section);
  const zone = $('.dropzone', section);
  const zoneTitle = $('.dz-title', zone);
  const zoneTitleText = zoneTitle.textContent;
  const items = [];
  let counter = 0;
  let pastedCount = 0;

  // Pasted screenshots all arrive called "image.png", so give them real names
  function tidyName(file) {
    if (!options.pastedName || (file.name && file.name !== 'image.png')) return file;
    const ext = EXT[file.type] || 'png';
    return new File([file], `${options.pastedName} ${++pastedCount}.${ext}`, { type: file.type });
  }

  async function add(files) {
    say(section, '');
    const problems = [];
    let list = Array.from(files);

    const room = IMAGE_LIMIT - items.length;
    if (list.length > room) {
      problems.push(`Up to ${IMAGE_LIMIT} images fit in one go, so the rest were left out.`);
      list = list.slice(0, Math.max(0, room));
    }

    const loaded = await mapLimit(list, 3, async (original) => {
      const reason = options.accept ? options.accept(original) : '';
      if (reason) {
        problems.push(`${original.name} ${reason}`);
        return null;
      }
      try {
        const file = tidyName(original);
        const { img, url } = await loadImage(file);
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        const proxy = scaleCanvas(img, width, height, PROXY_SIDE);
        const thumbBlob = await canvasToBlob(scaleCanvas(proxy, proxy.width, proxy.height, 320), 'image/webp', 0.8);
        return {
          id: ++counter,
          file, img, url, width, height,
          proxy: options.keepProxy ? proxy : null,
          thumb: URL.createObjectURL(thumbBlob)
        };
      } catch (error) {
        problems.push(`${original.name}: ${error.message}`);
        return null;
      }
    });

    loaded.filter(Boolean).forEach((item) => items.push(item));
    render();

    if (problems.length) {
      const shown = problems.slice(0, 3).join(' ');
      const more = problems.length > 3 ? ` And ${problems.length - 3} more were skipped.` : '';
      say(section, `Skipped: ${shown}${more}`, true);
    }
  }

  function buildItem(item, index) {
    const li = document.createElement('li');
    li.className = 'fileitem';
    li.dataset.id = item.id;

    const thumb = document.createElement('span');
    thumb.className = 'fi-thumb';
    const img = new Image();
    img.src = item.thumb;
    img.alt = '';
    thumb.append(img);

    const number = document.createElement('span');
    number.className = 'fi-num';
    number.textContent = index + 1;

    const name = document.createElement('span');
    name.className = 'fi-name';
    name.textContent = item.file.name;
    name.title = item.file.name;

    const meta = document.createElement('span');
    meta.className = 'fi-meta';
    meta.textContent = `${item.width} \u00d7 ${item.height} px, ${formatBytes(item.file.size)}`;

    const actions = document.createElement('span');
    actions.className = 'fi-actions';
    const button = (act, text, label, disabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn';
      b.dataset.act = act;
      b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', `${label}: ${item.file.name}`);
      b.disabled = disabled;
      return b;
    };
    actions.append(
      button('earlier', '\u2039', 'Move earlier', index === 0),
      button('later', '\u203a', 'Move later', index === items.length - 1),
      button('remove', '\u00d7', 'Remove', false)
    );

    li.append(thumb, number, name, meta, actions);
    return li;
  }

  function render(focus) {
    workspace.hidden = items.length === 0;
    zone.classList.toggle('is-compact', items.length > 0);
    zoneTitle.textContent = items.length ? (options.moreLabel || 'Drop more images here or choose files') : zoneTitleText;

    const total = items.reduce((sum, item) => sum + item.file.size, 0);
    countEl.textContent = items.length
      ? `${items.length} image${items.length === 1 ? '' : 's'}, ${formatBytes(total)}`
      : '';

    listEl.replaceChildren(...items.map(buildItem));
    if (focus) {
      const target = $(`[data-id="${focus.id}"] [data-act="${focus.act}"]`, listEl);
      const fallback = $(`[data-id="${focus.id}"] [data-act="remove"]`, listEl);
      const chosen = target && !target.disabled ? target : fallback;
      if (chosen) chosen.focus();
    }

    hideResult(section);
    if (options.onChange) options.onChange(items);
  }

  function release(item) {
    URL.revokeObjectURL(item.url);
    URL.revokeObjectURL(item.thumb);
  }

  function removeAt(index) {
    release(items[index]);
    items.splice(index, 1);
    const next = items[Math.min(index, items.length - 1)];
    render(next ? { id: next.id, act: 'remove' } : null);
    if (!next) $('input[type="file"]', zone).focus();
  }

  function move(index, step) {
    const target = index + step;
    if (target < 0 || target >= items.length) return;
    const [item] = items.splice(index, 1);
    items.splice(target, 0, item);
    return item;
  }

  listEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button) return;
    const id = Number(button.closest('.fileitem').dataset.id);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;

    if (button.dataset.act === 'remove') {
      removeAt(index);
    } else {
      const moved = move(index, button.dataset.act === 'earlier' ? -1 : 1);
      if (moved) render({ id: moved.id, act: button.dataset.act });
    }
  });

  const actions = {
    sort() {
      items.sort((a, b) => LBCore.naturalCompare(a.file.name, b.file.name));
    },
    reverse() {
      items.reverse();
    },
    shuffle() {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    },
    clear() {
      items.forEach(release);
      items.length = 0;
    }
  };
  $$('[data-list]', section).forEach((chip) => {
    chip.addEventListener('click', () => {
      actions[chip.dataset.list]();
      render();
      if (!items.length) $('input[type="file"]', zone).focus();
    });
  });

  return { items, add, render };
}


/* ==========================================================
   Shared: result panel for tools that make files (PDF, ZIP...)
   ========================================================== */

const fileUrls = new WeakMap();

function urlFor(section, blob) {
  const url = URL.createObjectURL(blob);
  if (!fileUrls.has(section)) fileUrls.set(section, []);
  fileUrls.get(section).push(url);
  return url;
}

// tiles: [{ blob, name, caption }] shows small previews (pages)
// tileDownload: give every tile its own download link
function showFileResult(section, { blob, filename, summary, tiles = [], tileDownload = false, openInTab = false }) {
  (fileUrls.get(section) || []).forEach((url) => URL.revokeObjectURL(url));
  fileUrls.set(section, []);

  const result = $('.result', section);
  $('.result-summary', result).textContent = summary;

  const grid = $('.pages', result);
  if (grid) {
    grid.replaceChildren(...tiles.map((tile) => {
      const figure = document.createElement('figure');
      figure.className = 'page-tile';
      const img = new Image();
      img.src = urlFor(section, tile.blob);
      img.alt = tile.alt || tile.caption;
      const caption = document.createElement('figcaption');
      caption.textContent = tile.caption;
      figure.append(img, caption);
      if (tileDownload) {
        const link = document.createElement('a');
        link.className = 'chip';
        link.href = img.src;
        link.download = tile.name;
        link.textContent = 'Download';
        link.setAttribute('aria-label', `Download ${tile.name}`);
        figure.append(link);
      }
      return figure;
    }));
    grid.hidden = tiles.length === 0;
  }

  const link = $('.download', result);
  link.href = urlFor(section, blob);
  link.download = filename;
  if (link.dataset.label) link.textContent = link.dataset.label;

  const open = $('.open-link', result);
  if (open) {
    open.hidden = !openInTab;
    if (openInTab) open.href = link.href;
  }

  result.hidden = false;
  result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}


/* ==========================================================
   1-4. TO PDF: Image, JPG, PNG and Screenshot
   ========================================================== */

(function initToPdf() {
  const section = ['image-to-pdf', 'jpg-to-pdf', 'png-to-pdf', 'screenshot-to-pdf']
    .map((id) => $('#tool-' + id))
    .find(Boolean);
  if (!section) return; // none of these tools is on the current page

  const kind = section.dataset.kind; // any, jpg, png or screenshot
  const sizeSelect = $('#pd-size');
  const orientSelect = $('#pd-orient');
  const marginSelect = $('#pd-margin');
  const fitSelect = $('#pd-fit');
  const qualitySelect = $('#pd-quality');
  const orientField = $('#pd-orient-field');
  const fitField = $('#pd-fit-field');
  const hint = $('#pd-hint');
  const goButton = $('#pd-go');

  // Images this big are stored as JPG instead, to keep the browser from running out of memory
  const LOSSLESS_LIMIT = 36e6;
  const PRESETS = { high: { quality: 0.85, side: 3000 }, compact: { quality: 0.65, side: 1600 } };

  const HINTS = {
    any: 'JPG photos go into the PDF exactly as they are. PNG, WebP and GIF images are stored without losing quality, and transparent areas stay transparent.',
    jpg: 'Your JPG files go into the PDF exactly as they are, so nothing is re-compressed and the PDF stays about the size of the photos.',
    png: 'PNG images are stored without losing quality, and transparent areas stay transparent. Large PNGs make large PDFs.',
    screenshot: 'Screenshots are stored without losing quality, so text stays sharp. Pick Compact if the file is too big to send.',
    high: 'Images are saved as JPG at 85% quality and shrunk to 3000 pixels on the long side. Transparent areas turn white.',
    compact: 'Images are saved as JPG at 65% quality and shrunk to 1600 pixels on the long side. Transparent areas turn white.'
  };

  const rules = {
    jpg: (file) => (file.type === 'image/jpeg' ? '' : 'is not a JPG. Use Image to PDF for other formats.'),
    png: (file) => (file.type === 'image/png' ? '' : 'is not a PNG. Use Image to PDF for other formats.')
  };

  const list = createImageList(section, {
    accept: rules[kind],
    pastedName: kind === 'screenshot' ? 'Screenshot' : '',
    moreLabel: kind === 'screenshot' ? 'Drop or paste more screenshots' : undefined
  });
  setupDropzone(section, (files) => list.add(files), { multiple: true });

  function refresh() {
    const same = sizeSelect.value === 'match';
    orientField.hidden = same;
    fitField.hidden = same;
    hint.textContent = qualitySelect.value === 'original' ? HINTS[kind] : HINTS[qualitySelect.value];
    hideResult(section);
  }
  $$('select', section).forEach((select) => select.addEventListener('change', refresh));
  refresh();

  // Screenshot page: a button for phones and browsers where Ctrl+V is not handy
  const pasteButton = $('#pd-paste');
  if (pasteButton) {
    pasteButton.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('unsupported');
        const files = [];
        for (const entry of await navigator.clipboard.read()) {
          const type = entry.types.find((t) => t.startsWith('image/'));
          if (type) files.push(new File([await entry.getType(type)], 'image.png', { type }));
        }
        if (!files.length) {
          say(section, 'The clipboard has no image. Take a screenshot first, then choose Paste again.', true);
          return;
        }
        list.add(files);
      } catch (error) {
        say(section, 'This browser did not let the page read the clipboard. Press Ctrl+V (Cmd+V on a Mac) on this page instead.', true);
      }
    });
  }

  // Puts one image into the PDF. Returns { id, fellBack }.
  async function embed(doc, item, quality) {
    const { file, img, width, height } = item;
    let fellBack = false;

    if (quality === 'original') {
      if (file.type === 'image/jpeg') {
        // Best case: the JPG goes in byte for byte
        const bytes = new Uint8Array(await file.arrayBuffer());
        const info = LBCore.parseJpeg(bytes);
        if (LBCore.canEmbedJpeg(info) && info.width === width && info.height === height) {
          return { id: doc.addJpeg(bytes, width, height, info.components) };
        }
        // Rotated by an EXIF tag, or CMYK: redraw it below as a high quality JPG
      } else if (LBCore.canDeflate() && width * height <= LOSSLESS_LIMIT) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const { rgb, alpha } = await LBCore.encodeRaster(ctx.getImageData(0, 0, width, height).data, width, height);
        return { id: doc.addRaster(width, height, rgb, alpha) };
      } else {
        fellBack = true;
      }
    }

    const preset = PRESETS[quality] || { quality: 0.92, side: Infinity };
    const k = Math.min(1, preset.side / Math.max(width, height));
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    const blob = await canvasToBlob(drawToCanvas(img, w, h, 'image/jpeg'), 'image/jpeg', preset.quality);
    return { id: doc.addJpeg(new Uint8Array(await blob.arrayBuffer()), w, h, 3), fellBack };
  }

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      const items = list.items;
      if (!items.length) return;

      const layout = {
        size: sizeSelect.value,
        orient: orientSelect.value,
        margin: Number(marginSelect.value),
        fit: fitSelect.value
      };
      const doc = new LBCore.PdfDocument();
      let fellBack = false;

      for (let i = 0; i < items.length; i++) {
        say(section, `Adding image ${i + 1} of ${items.length}...`);
        await nextFrame();
        const done = await embed(doc, items[i], qualitySelect.value);
        fellBack = fellBack || Boolean(done.fellBack);
        LBCore.planPages(items[i].width, items[i].height, layout).forEach((plan) =>
          doc.addPage(plan.width, plan.height, LBCore.pageContent(plan, 'Im0'), { Im0: done.id })
        );
      }

      const name = items.length === 1 ? baseName(items[0].file.name) : section.dataset.name;
      const blob = doc.finish(name);
      const pages = doc.pageCount;
      showFileResult(section, {
        blob,
        filename: name + '.pdf',
        summary: `${pages} page${pages === 1 ? '' : 's'}, ${formatBytes(blob.size)}`,
        openInTab: true
      });
      say(section, fellBack
        ? 'This browser cannot store images without loss, so some were saved as high quality JPG.'
        : '');
    })
  );
})();


/* ==========================================================
   5. PDF TO IMAGE
   The PDF reader (pdf.js) sits in the vendor folder and loads
   the first time you open a PDF. Your file never leaves the browser.
   ========================================================== */

(function initPdfToImage() {
  const section = $('#tool-pdf-to-image');
  if (!section) return;

  const formatSelect = $('#pi-format');
  const dpiSelect = $('#pi-dpi');
  const pagesSelect = $('#pi-pages');
  const rangeField = $('#pi-range-field');
  const rangeInput = $('#pi-range');
  const info = $('#pi-info');
  const passwordRow = $('#pi-password-row');
  const passwordInput = $('#pi-password');
  const unlockButton = $('#pi-unlock');
  const goButton = $('#pi-go');
  const workspace = $('.workspace', section);

  const LIB = DOCS_BASE + 'vendor/pdfjs/';
  const MAX_PIXELS = 80e6;
  const MAX_SIDE = 16000;

  let pdfjs = null;
  let doc = null;
  let file = null;
  let waiting = null; // a password protected file that is waiting for its password

  async function loadReader() {
    if (!pdfjs) {
      const lib = await import(LIB + 'pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc = LIB + 'pdf.worker.min.mjs';
      pdfjs = lib;
    }
    return pdfjs;
  }

  async function open(chosen, password) {
    if (!(chosen.type === 'application/pdf' || /\.pdf$/i.test(chosen.name))) {
      say(section, `${chosen.name} is not a PDF. Choose a file that ends in .pdf.`, true);
      return;
    }
    say(section, 'Opening the PDF...');
    try {
      const reader = await loadReader();
      const task = reader.getDocument({
        data: new Uint8Array(await chosen.arrayBuffer()),
        password: password || undefined,
        cMapUrl: LIB + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: LIB + 'standard_fonts/',
        wasmUrl: LIB + 'wasm/',
        iccUrl: LIB + 'iccs/'
      });
      const opened = await task.promise;

      if (doc) doc.destroy();
      doc = opened;
      file = chosen;
      waiting = null;
      passwordRow.hidden = true;
      passwordInput.value = '';
      workspace.hidden = false;
      hideResult(section);
      info.textContent = `${chosen.name} has ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}.`;
      say(section, '');
    } catch (error) {
      if (error && error.name === 'PasswordException') {
        waiting = chosen;
        workspace.hidden = true;
        passwordRow.hidden = false;
        say(section,
          error.code === 2 ? 'That password is not right. Try again.' : 'This PDF is locked. Enter its password to open it.',
          error.code === 2);
        passwordInput.focus();
      } else if (error && (error.name === 'InvalidPDFException' || error.name === 'FormatError')) {
        say(section, 'This file could not be read as a PDF. It may be damaged.', true);
      } else {
        say(section, 'The PDF reader could not start. Open this site from a web address (not as a file on your computer) and check your connection.', true);
      }
    }
  }

  setupDropzone(section, (chosen) => open(chosen, ''), { pasteFilter: () => false });

  unlockButton.addEventListener('click', () => {
    if (waiting) open(waiting, passwordInput.value);
  });
  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && waiting) open(waiting, passwordInput.value);
  });

  pagesSelect.addEventListener('change', () => {
    rangeField.hidden = pagesSelect.value === 'all';
    if (!rangeField.hidden) rangeInput.focus();
  });
  // Old results go away as soon as a setting changes, like in the other tools
  [formatSelect, dpiSelect, pagesSelect, rangeInput].forEach((control) =>
    control.addEventListener('input', () => hideResult(section))
  );

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      if (!doc) return;

      let numbers;
      try {
        numbers = LBCore.parsePageRange(pagesSelect.value === 'all' ? '' : rangeInput.value, doc.numPages);
      } catch (error) {
        say(section, error.message, true);
        return;
      }
      if (pagesSelect.value !== 'all' && !rangeInput.value.trim()) {
        say(section, 'Type the pages you want, for example 1-3, 5.', true);
        return;
      }

      const type = formatSelect.value;
      const dpi = Number(dpiSelect.value);
      const base = baseName(file.name);
      const digits = String(doc.numPages).length;
      const tiles = [];
      let lowered = false;

      for (let k = 0; k < numbers.length; k++) {
        say(section, `Rendering page ${k + 1} of ${numbers.length}...`);
        await nextFrame();

        const page = await doc.getPage(numbers[k]);
        let scale = dpi / 72;
        let viewport = page.getViewport({ scale });
        const tooBig = viewport.width * viewport.height > MAX_PIXELS || Math.max(viewport.width, viewport.height) > MAX_SIDE;
        if (tooBig) {
          scale *= Math.min(
            Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)),
            MAX_SIDE / Math.max(viewport.width, viewport.height)
          );
          viewport = page.getViewport({ scale });
          lowered = true;
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvas, viewport, background: '#ffffff' }).promise;
        const blob = await canvasToBlob(canvas, type, 0.92);
        page.cleanup();

        tiles.push({
          blob,
          name: `${base}-page-${String(numbers[k]).padStart(digits, '0')}.${EXT[blob.type] || 'png'}`,
          caption: `Page ${numbers[k]}: ${canvas.width} \u00d7 ${canvas.height} px, ${formatBytes(blob.size)}`,
          alt: `Page ${numbers[k]} of ${file.name}`
        });
        canvas.width = canvas.height = 0; // let the browser free the memory
      }

      let blob = tiles[0].blob;
      let filename = tiles[0].name;
      if (tiles.length > 1) {
        say(section, 'Packing the ZIP file...');
        await nextFrame();
        blob = await LBCore.makeZip(tiles.map((t) => ({ name: t.name, data: t.blob })));
        filename = `${base}-images.zip`;
      }

      const total = tiles.reduce((sum, t) => sum + t.blob.size, 0);
      const link = $('.download', $('.result', section));
      link.dataset.label = tiles.length > 1 ? 'Download all as ZIP' : 'Download image';
      showFileResult(section, {
        blob,
        filename,
        tiles,
        tileDownload: tiles.length > 1,
        summary: `${tiles.length} image${tiles.length === 1 ? '' : 's'}, ${formatBytes(total)} in total`
      });
      say(section, lowered ? 'Some pages are very large, so they were drawn at a lower resolution to stay within browser limits.' : '');
    })
  );
})();


/* ==========================================================
   6. COLLAGE MAKER
   ========================================================== */

(function initCollage() {
  const section = $('#tool-collage');
  if (!section) return;

  const el = {
    layout: $('#cl-layout'),
    shape: $('#cl-shape'), shapeField: $('#cl-shape-field'),
    fit: $('#cl-fit'), fitField: $('#cl-fit-field'),
    cols: $('#cl-cols'), gap: $('#cl-gap'), margin: $('#cl-margin'), radius: $('#cl-radius'),
    bg: $('#cl-bg'), format: $('#cl-format'), size: $('#cl-size')
  };
  const preview = $('#cl-preview');
  const goButton = $('#cl-go');
  const MAX_SIDE = 16000;
  let colsTouched = false;

  ['cols', 'gap', 'margin', 'radius'].forEach((name) => bindSlider(el[name], $(`#cl-${name}-out`)));

  function options() {
    const mode = el.layout.value;
    const n = Math.max(1, list.items.length);
    return {
      layout: mode === 'rows' ? 'rows' : 'grid',
      cols: mode === 'side' ? n : mode === 'stack' ? 1 : Number(el.cols.value),
      aspect: Number(el.shape.value),
      gap: Number(el.gap.value),
      margin: Number(el.margin.value),
      radius: Number(el.radius.value),
      fit: el.fit.value,
      bg: el.bg.value
    };
  }

  // Draws the collage on `canvas`, W pixels wide. Returns its size.
  function draw(canvas, W, precise) {
    const items = list.items;
    const o = options();
    const layout = LBCore.collageLayout(items.map((it) => it.width / it.height), o, W);
    canvas.width = layout.width;
    canvas.height = layout.height;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const radius = o.radius * (W / 1000);
    layout.cells.forEach((cell) => {
      const item = items[cell.i];
      const source = precise ? item.img : item.proxy;
      const sw = precise ? item.width : item.proxy.width;
      const sh = precise ? item.height : item.proxy.height;
      // In "rows" every cell already has the photo's own shape, so nothing is cropped
      drawImageFit(ctx, source, sw, sh, cell, o.layout === 'rows' ? 'cover' : o.fit, radius);
    });
    return layout;
  }

  const redraw = frameThrottle(() => {
    if (list.items.length) draw(preview, 900, false);
  });

  const list = createImageList(section, {
    keepProxy: true,
    onChange(items) {
      if (!colsTouched && items.length) {
        el.cols.value = clamp(Math.ceil(Math.sqrt(items.length)), 1, Number(el.cols.max));
        el.cols.dispatchEvent(new Event('input'));
      }
      redraw();
    }
  });
  setupDropzone(section, (files) => list.add(files), { multiple: true });

  function refresh() {
    const mode = el.layout.value;
    const rows = mode === 'rows';
    el.shapeField.hidden = rows;
    el.fitField.hidden = rows;
    el.cols.closest('.field').hidden = mode === 'side' || mode === 'stack';
    $('#cl-cols-label').textContent = rows ? 'Photos per row' : 'Columns';
    hideResult(section);
    redraw();
  }
  el.layout.addEventListener('change', refresh);
  [el.shape, el.fit].forEach((control) => control.addEventListener('change', refresh));
  [el.cols, el.gap, el.margin, el.radius].forEach((slider) =>
    slider.addEventListener('input', (event) => {
      if (slider === el.cols && event.isTrusted) colsTouched = true;
      hideResult(section);
      redraw();
    })
  );
  bindSwatches(section, el.bg, () => { hideResult(section); redraw(); });
  refresh();

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      if (!list.items.length) return;
      await nextFrame();

      let W = Number(el.size.value);
      let note = '';
      const aspects = list.items.map((it) => it.width / it.height);
      const size = LBCore.collageLayout(aspects, options(), W);
      if (size.height > MAX_SIDE) {
        W = Math.floor((W * MAX_SIDE) / size.height);
        note = `This collage is very tall, so it was made ${W} pixels wide to stay within browser limits.`;
      }

      const canvas = document.createElement('canvas');
      draw(canvas, W, true);
      const blob = await canvasToBlob(canvas, el.format.value, 0.92);
      showResult(section, {
        original: null,
        blob,
        width: canvas.width,
        height: canvas.height,
        filename: `collage.${EXT[blob.type] || 'png'}`
      });
      say(section, note);
    })
  );
})();


/* ==========================================================
   7. CONTACT SHEET MAKER
   ========================================================== */

(function initContactSheet() {
  const section = $('#tool-contact-sheet');
  if (!section) return;

  const el = {
    title: $('#cs-title'), paper: $('#cs-paper'), orient: $('#cs-orient'),
    cols: $('#cs-cols'), rows: $('#cs-rows'), gap: $('#cs-gap'),
    fit: $('#cs-fit'), names: $('#cs-names'), numbers: $('#cs-numbers'),
    theme: $('#cs-theme'), output: $('#cs-output'), dpi: $('#cs-dpi')
  };
  const preview = $('#cs-preview');
  const pager = { prev: $('#cs-prev'), next: $('#cs-next'), label: $('#cs-page-label') };
  const goButton = $('#cs-go');
  const PAPER = { a4: [595.28, 841.89], letter: [612, 792] };
  let pageIndex = 0;

  ['cols', 'rows', 'gap'].forEach((name) => bindSlider(el[name], $(`#cs-${name}-out`)));

  function options() {
    let [pageW, pageH] = PAPER[el.paper.value];
    if (el.orient.value === 'landscape') [pageW, pageH] = [pageH, pageW];
    return {
      pageW, pageH,
      cols: Number(el.cols.value),
      rows: Number(el.rows.value),
      gap: Number(el.gap.value),
      margin: 36,
      title: el.title.value.trim(),
      captions: el.names.checked,
      pageNumbers: el.numbers.checked,
      fit: el.fit.value,
      dark: el.theme.value === 'dark'
    };
  }

  function pageCount(o) {
    return Math.max(1, Math.ceil(list.items.length / (o.cols * o.rows)));
  }

  // Draws one page on `canvas`, `widthPx` wide
  function drawPage(canvas, index, widthPx, precise) {
    const o = options();
    const items = list.items;
    const k = widthPx / o.pageW;
    canvas.width = Math.round(o.pageW * k);
    canvas.height = Math.round(o.pageH * k);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0); // from here on, sizes are in points
    ctx.imageSmoothingQuality = 'high';

    const ink = o.dark ? '#e6eaed' : '#14181b';
    const muted = o.dark ? '#9aa4ab' : '#56616a';
    const mount = o.dark ? '#242a2e' : '#eceff1';
    ctx.fillStyle = o.dark ? '#14181b' : '#ffffff';
    ctx.fillRect(0, 0, o.pageW, o.pageH);

    const geometry = LBCore.contactSheetLayout(o);
    const contentW = o.pageW - 2 * o.margin;
    ctx.textBaseline = 'top';

    if (o.title) {
      ctx.fillStyle = ink;
      ctx.font = `700 18px ${SITE_FONT}`;
      ctx.fillText(fitText(ctx, o.title, contentW), o.margin, geometry.titleY);
    }

    const start = index * geometry.perPage;
    items.slice(start, start + geometry.perPage).forEach((item, j) => {
      const cell = geometry.cells[j];
      ctx.fillStyle = mount;
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      const source = precise ? item.img : item.proxy;
      drawImageFit(ctx, source, precise ? item.width : item.proxy.width, precise ? item.height : item.proxy.height, cell, o.fit, 0);

      if (o.captions) {
        const size = Math.max(5, Math.min(8, cell.captionH * 0.75));
        ctx.font = `500 ${size}px ${SITE_FONT}`;
        ctx.fillStyle = muted;
        ctx.fillText(fitText(ctx, item.file.name, cell.w), cell.x, cell.captionY);
      }
    });

    if (o.pageNumbers) {
      ctx.font = `500 8px ${SITE_FONT}`;
      ctx.fillStyle = muted;
      ctx.textAlign = 'right';
      ctx.fillText(`Page ${index + 1} of ${pageCount(o)}`, o.pageW - o.margin, geometry.footerY + 8);
      ctx.textAlign = 'left';
    }
  }

  function showPreview() {
    if (!list.items.length) return;
    const total = pageCount(options());
    pageIndex = clamp(pageIndex, 0, total - 1);
    drawPage(preview, pageIndex, 640, false);
    pager.label.textContent = `Page ${pageIndex + 1} of ${total}`;
    pager.prev.disabled = pageIndex === 0;
    pager.next.disabled = pageIndex >= total - 1;
  }
  const redraw = frameThrottle(showPreview);

  const list = createImageList(section, { keepProxy: true, onChange: redraw });
  setupDropzone(section, (files) => list.add(files), { multiple: true });

  pager.prev.addEventListener('click', () => { pageIndex--; showPreview(); });
  pager.next.addEventListener('click', () => { pageIndex++; showPreview(); });

  $$('select, input', $('.workspace', section)).forEach((control) => {
    control.addEventListener(control.type === 'range' || control.type === 'text' ? 'input' : 'change', () => {
      hideResult(section);
      redraw();
    });
  });

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      if (!list.items.length) return;

      const o = options();
      const total = pageCount(o);
      const format = el.output.value; // pdf, png or jpg
      const type = format === 'png' ? 'image/png' : 'image/jpeg';
      const width = Math.round(o.pageW * (Number(el.dpi.value) / 72));
      const pages = [];

      for (let p = 0; p < total; p++) {
        say(section, `Drawing page ${p + 1} of ${total}...`);
        await nextFrame();
        const canvas = document.createElement('canvas');
        drawPage(canvas, p, width, true);
        const blob = await canvasToBlob(canvas, type, 0.9);
        pages.push({ blob, width: canvas.width, height: canvas.height });
        canvas.width = canvas.height = 0;
      }

      const tiles = pages.map((page, p) => ({
        blob: page.blob,
        name: `contact-sheet-page-${p + 1}.${format === 'png' ? 'png' : 'jpg'}`,
        caption: `Page ${p + 1}`,
        alt: `Contact sheet page ${p + 1}`
      }));

      let blob;
      let filename;
      let label;
      if (format === 'pdf') {
        const doc = new LBCore.PdfDocument();
        for (const page of pages) {
          const id = doc.addJpeg(new Uint8Array(await page.blob.arrayBuffer()), page.width, page.height, 3);
          doc.addPage(o.pageW, o.pageH, `q ${LBCore.num(o.pageW)} 0 0 ${LBCore.num(o.pageH)} 0 0 cm /Im0 Do Q\n`, { Im0: id });
        }
        blob = doc.finish(o.title || 'Contact sheet');
        filename = 'contact-sheet.pdf';
        label = 'Download PDF';
      } else if (pages.length === 1) {
        blob = pages[0].blob;
        filename = tiles[0].name;
        label = 'Download image';
      } else {
        blob = await LBCore.makeZip(tiles.map((t) => ({ name: t.name, data: t.blob })));
        filename = 'contact-sheet.zip';
        label = 'Download all as ZIP';
      }

      $('.download', $('.result', section)).dataset.label = label;
      showFileResult(section, {
        blob,
        filename,
        tiles,
        openInTab: format === 'pdf',
        summary: `${total} page${total === 1 ? '' : 's'} for ${list.items.length} image${list.items.length === 1 ? '' : 's'}, ${formatBytes(blob.size)}`
      });
      say(section, ''); // clears "Drawing page 2 of 2..."
    })
  );
})();


/* ==========================================================
   8. IMAGE SHEET / SPRITE GENERATOR
   ========================================================== */

(function initSprite() {
  const section = $('#tool-sprite-sheet');
  if (!section) return;

  const el = {
    layout: $('#sp-layout'),
    cols: $('#sp-cols'), colsField: $('#sp-cols-field'),
    pad: $('#sp-pad'),
    maxw: $('#sp-maxw'), maxwField: $('#sp-maxw-field'),
    pow2: $('#sp-pow2'), bg: $('#sp-bg'), format: $('#sp-format'), prefix: $('#sp-prefix')
  };
  const goButton = $('#sp-go');
  const cssBox = $('#sp-css');
  const jsonBox = $('#sp-json');
  const MAX_SIDE = 16384;

  bindSlider(el.cols, $('#sp-cols-out'));
  bindSlider(el.pad, $('#sp-pad-out'));

  const list = createImageList(section, {
    moreLabel: 'Drop more images here or choose files',
    onChange(items) {
      if (items.length && !el.cols.dataset.touched) {
        el.cols.value = clamp(Math.ceil(Math.sqrt(items.length)), 1, Number(el.cols.max));
        el.cols.dispatchEvent(new Event('input'));
      }
    }
  });
  setupDropzone(section, (files) => list.add(files), { multiple: true });

  el.cols.addEventListener('input', (event) => {
    if (event.isTrusted) el.cols.dataset.touched = '1';
  });

  function refresh() {
    const grid = el.layout.value === 'grid';
    el.colsField.hidden = !grid;
    el.maxwField.hidden = grid;
    hideResult(section);
  }
  el.layout.addEventListener('change', refresh);
  refresh();

  const neg = (v) => (v ? `-${v}px` : '0');

  function buildCss(names, rects, prefix, sheetName) {
    const cls = LBCore.slug(prefix) || 'sprite';
    let css = `.${cls} {\n  display: inline-block;\n  background-image: url("${sheetName}");\n  background-repeat: no-repeat;\n}\n`;
    names.forEach((name, i) => {
      css += `\n.${cls}-${name} {\n  width: ${rects[i].w}px;\n  height: ${rects[i].h}px;\n  background-position: ${neg(rects[i].x)} ${neg(rects[i].y)};\n}\n`;
    });
    return css;
  }

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      const items = list.items;
      if (!items.length) return;
      await nextFrame();

      const packed = LBCore.packSprites(items.map((it) => ({ w: it.width, h: it.height })), {
        mode: el.layout.value,
        pad: Number(el.pad.value),
        cols: Number(el.cols.value),
        maxWidth: Number(el.maxw.value),
        pow2: el.pow2.checked
      });
      if (packed.width > MAX_SIDE || packed.height > MAX_SIDE) {
        throw new Error(`The sheet would be ${packed.width} \u00d7 ${packed.height} px, which is more than a browser can draw. Use fewer or smaller images, or a wider sheet.`);
      }

      const canvas = document.createElement('canvas');
      canvas.width = packed.width;
      canvas.height = packed.height;
      const ctx = canvas.getContext('2d');
      if (el.bg.value !== 'transparent') {
        ctx.fillStyle = el.bg.value;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.imageSmoothingEnabled = false; // sprites are copied pixel for pixel
      items.forEach((item, i) => ctx.drawImage(item.img, packed.positions[i].x, packed.positions[i].y));

      const blob = await canvasToBlob(canvas, el.format.value, 0.95);
      const ext = EXT[blob.type] || 'png';
      const sheetName = `sprite-sheet.${ext}`;
      const names = LBCore.spriteNames(items.map((it) => it.file.name));
      const rects = items.map((it, i) => ({ x: packed.positions[i].x, y: packed.positions[i].y, w: it.width, h: it.height }));

      const css = buildCss(names, rects, el.prefix.value, sheetName);
      const frames = {};
      names.forEach((name, i) => { frames[name] = rects[i]; });
      const json = JSON.stringify({ meta: { image: sheetName, width: canvas.width, height: canvas.height }, frames }, null, 2);
      cssBox.value = css;
      jsonBox.value = json;

      const total = items.length;
      showFileResult(section, {
        blob,
        filename: sheetName,
        summary: `${total} sprite${total === 1 ? '' : 's'} on a ${canvas.width} \u00d7 ${canvas.height} px sheet, ${formatBytes(blob.size)}`,
        tiles: [{ blob, name: sheetName, caption: sheetName, alt: 'The finished sprite sheet' }]
      });

      // The CSS and JSON files get their own download links
      const result = $('.result', section);
      const cssLink = $('.download-css', result);
      cssLink.href = urlFor(section, new Blob([css], { type: 'text/css' }));
      cssLink.download = 'sprite-sheet.css';
      const jsonLink = $('.download-json', result);
      jsonLink.href = urlFor(section, new Blob([json], { type: 'application/json' }));
      jsonLink.download = 'sprite-sheet.json';
    })
  );

  $$('[data-copy]', section).forEach((button) => {
    const label = button.textContent;
    button.addEventListener('click', () => copyText(button, $(button.dataset.copy, section).value, label));
  });
})();


/* ==========================================================
   9. COMPRESS PDF
   You type the size you need (KB or MB). Every page is drawn once
   with pdf.js, then saved again at lower sharpness and quality
   until the whole file fits. The best setting that fits is used.
   Your file never leaves the browser.
   ========================================================== */

(function initCompressPdf() {
  const section = $('#tool-compress-pdf');
  if (!section) return;

  const targetInput = $('#cp-target');
  const unitSelect = $('#cp-unit');
  const info = $('#cp-info');
  const passwordRow = $('#cp-password-row');
  const passwordInput = $('#cp-password');
  const unlockButton = $('#cp-unlock');
  const goButton = $('#cp-go');
  const workspace = $('.workspace', section);

  const LIB = DOCS_BASE + 'vendor/pdfjs/';
  const BASE_DPI = 150;
  const MAX_PIXELS = 40e6;
  const PAGE_OVERHEAD = 700; // bytes the PDF adds around each page picture

  // From best quality to smallest file, in 18 small steps so the result can land close to the
  // size you asked for. scale shrinks the picture, quality is the JPG quality.
  // (The first steps keep full size and lower only the quality, then the picture shrinks.)
  const STEPS = Array.from({ length: 18 }, (_, i) => {
    const t = i / 17;
    return {
      scale: t < 0.12 ? 1 : Math.round(Math.pow(0.25, (t - 0.12) / 0.88) * 100) / 100,
      quality: Math.round((0.85 - 0.55 * t) * 100) / 100
    };
  });

  let pdfjs = null;
  let doc = null;
  let file = null;
  let waiting = null;

  async function loadReader() {
    if (!pdfjs) {
      const lib = await import(LIB + 'pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc = LIB + 'pdf.worker.min.mjs';
      pdfjs = lib;
    }
    return pdfjs;
  }

  function targetBytes() {
    const value = Number(targetInput.value);
    if (!value || value <= 0) return 0;
    return Math.round(value * 1024 * (unitSelect.value === 'MB' ? 1024 : 1));
  }

  // Puts a size in the box, using MB for big sizes
  function showTarget(bytes) {
    if (bytes >= 1024 * 1024) {
      unitSelect.value = 'MB';
      targetInput.value = Math.round((bytes / (1024 * 1024)) * 10) / 10;
    } else {
      unitSelect.value = 'KB';
      targetInput.value = Math.max(10, Math.round(bytes / 1024));
    }
  }

  async function open(chosen, password) {
    if (!(chosen.type === 'application/pdf' || /\.pdf$/i.test(chosen.name))) {
      say(section, `${chosen.name} is not a PDF. Choose a file that ends in .pdf.`, true);
      return;
    }
    say(section, 'Opening the PDF...');
    try {
      const reader = await loadReader();
      const task = reader.getDocument({
        data: new Uint8Array(await chosen.arrayBuffer()),
        password: password || undefined,
        cMapUrl: LIB + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: LIB + 'standard_fonts/',
        wasmUrl: LIB + 'wasm/',
        iccUrl: LIB + 'iccs/'
      });
      const opened = await task.promise;

      if (doc) doc.destroy();
      doc = opened;
      file = chosen;
      waiting = null;
      passwordRow.hidden = true;
      passwordInput.value = '';
      workspace.hidden = false;
      hideResult(section);
      showTarget(chosen.size / 2); // a sensible starting point: half the size
      info.textContent = `${chosen.name} has ${doc.numPages} page${doc.numPages === 1 ? '' : 's'} and is ${formatBytes(chosen.size)}.`;
      say(section, '');
    } catch (error) {
      if (error && error.name === 'PasswordException') {
        waiting = chosen;
        workspace.hidden = true;
        passwordRow.hidden = false;
        say(section,
          error.code === 2 ? 'That password is not right. Try again.' : 'This PDF is locked. Enter its password to open it.',
          error.code === 2);
        passwordInput.focus();
      } else if (error && (error.name === 'InvalidPDFException' || error.name === 'FormatError')) {
        say(section, 'This file could not be read as a PDF. It may be damaged.', true);
      } else {
        say(section, 'The PDF reader could not start. Open this site from a web address (not as a file on your computer) and check your connection.', true);
      }
    }
  }

  setupDropzone(section, (chosen) => open(chosen, ''), { pasteFilter: () => false });

  unlockButton.addEventListener('click', () => {
    if (waiting) open(waiting, passwordInput.value);
  });
  passwordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && waiting) open(waiting, passwordInput.value);
  });

  $$('.chip[data-kb]', section).forEach((chip) =>
    chip.addEventListener('click', () => {
      showTarget(Number(chip.dataset.kb) * 1024);
      hideResult(section);
    })
  );
  [targetInput, unitSelect].forEach((control) =>
    control.addEventListener('input', () => hideResult(section))
  );

  // Draws a saved page picture smaller and saves it again as a JPG
  async function reencode(base, step) {
    if (step.scale === 1 && step.quality === STEPS[0].quality) return base;
    const bitmap = await createImageBitmap(base.blob);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(base.width * step.scale));
    canvas.height = Math.max(1, Math.round(base.height * step.scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvasToBlob(canvas, 'image/jpeg', step.quality);
    const result = {
      blob,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
      pageW: base.pageW,
      pageH: base.pageH
    };
    canvas.width = canvas.height = 0;
    return result;
  }

  function buildPdf(pages) {
    const out = new LBCore.PdfDocument();
    pages.forEach((p) => {
      const imageId = out.addJpeg(p.bytes, p.width, p.height, 3);
      const w = p.pageW.toFixed(2);
      const h = p.pageH.toFixed(2);
      out.addPage(p.pageW, p.pageH, `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`, { Im0: imageId });
    });
    return out.finish(baseName(file.name));
  }

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      if (!doc) return;

      const target = targetBytes();
      if (!target) {
        say(section, 'Type the size you want, for example 500 KB.', true);
        targetInput.focus();
        return;
      }
      if (target >= file.size) {
        say(section, `Your PDF is already ${formatBytes(file.size)}, which is under ${formatBytes(target)}. Type a smaller size.`, true);
        return;
      }

      // 1. Draw every page once, at good quality
      const total = doc.numPages;
      const base = [];

      // Does the original have real text? (It becomes part of the picture, so tell the person.)
      let hadText = false;
      for (let n = 1; n <= Math.min(3, total) && !hadText; n++) {
        const probe = await doc.getPage(n);
        const content = await probe.getTextContent();
        hadText = content.items.some((item) => item.str && item.str.trim());
        probe.cleanup();
      }
      for (let n = 1; n <= total; n++) {
        say(section, `Reading page ${n} of ${total}...`);
        await nextFrame();
        const page = await doc.getPage(n);
        const size = page.getViewport({ scale: 1 });
        let scale = BASE_DPI / 72;
        let viewport = page.getViewport({ scale });
        if (viewport.width * viewport.height > MAX_PIXELS) {
          scale *= Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));
          viewport = page.getViewport({ scale });
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        await page.render({ canvas, viewport, background: '#ffffff' }).promise;
        const blob = await canvasToBlob(canvas, 'image/jpeg', STEPS[0].quality);
        base.push({
          blob,
          bytes: new Uint8Array(await blob.arrayBuffer()),
          width: canvas.width,
          height: canvas.height,
          pageW: size.width,
          pageH: size.height
        });
        page.cleanup();
        canvas.width = canvas.height = 0;
      }

      // 2. Find the best setting that fits the size you typed
      const cache = new Map();
      async function pagesAt(index) {
        if (!cache.has(index)) {
          const list = [];
          for (const p of base) list.push(await reencode(p, STEPS[index]));
          cache.set(index, list);
        }
        return cache.get(index);
      }
      async function estimate(index) {
        say(section, `Trying a setting to reach ${formatBytes(target)}...`);
        await nextFrame();
        const list = await pagesAt(index);
        return list.reduce((sum, p) => sum + p.bytes.length + PAGE_OVERHEAD, 2000);
      }

      const last = STEPS.length - 1;
      let chosen;
      if ((await estimate(0)) <= target) {
        chosen = 0;
      } else if ((await estimate(last)) > target) {
        chosen = last;
      } else {
        let lo = 0; // too big
        let hi = last; // fits
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if ((await estimate(mid)) <= target) hi = mid;
          else lo = mid;
        }
        chosen = hi;
      }

      say(section, 'Building the PDF...');
      await nextFrame();
      let blob = buildPdf(await pagesAt(chosen));
      while (blob.size > target && chosen < last) {
        chosen += 1;
        blob = buildPdf(await pagesAt(chosen));
      }

      // Compressing must never give back a bigger file than the one you started with
      if (blob.size >= file.size) {
        hideResult(section);
        say(section, `Compressing would not help this PDF. It is ${formatBytes(file.size)} now, and the smallest this tool can make is ${formatBytes(blob.size)}. It is probably mostly text, which is already small. Keep your original.`, true);
        return;
      }

      const reached = blob.size <= target;
      showFileResult(section, {
        blob,
        filename: `${baseName(file.name)}-compressed.pdf`,
        summary: `${formatBytes(file.size)} became ${formatBytes(blob.size)}, which is ${Math.round((1 - blob.size / file.size) * 100)}% smaller.`,
        openInTab: true
      });
      const notes = [];
      if (!reached) notes.push(`This is the smallest this PDF can get without becoming unreadable. Try a larger size than ${formatBytes(target)}.`);
      if (hadText) notes.push('The text in the new PDF is now part of the pictures, so it cannot be selected or searched. Keep your original if you need that.');
      say(section, notes.join(' '), !reached);
    })
  );
})();
