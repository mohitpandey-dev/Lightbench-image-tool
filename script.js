'use strict';

/* ==========================================================
   Lightbench: five image tools, all running in the browser.
   1. Resize   2. Compress   3. Convert   4. Crop   5. Base64

   The document and layout tools (Image to PDF, PDF to Image,
   Collage, Contact sheet, Sprite sheet...) live in docs.js and
   docs-core.js. They reuse the helpers defined in this file.
   ========================================================== */


/* ---------- Small helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// File extension for each image type we can create
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// "holiday.photo.jpg" -> "holiday.photo"
function baseName(filename) {
  return filename.replace(/\.[^.]+$/, '') || 'image';
}

// Keep the original format when we can (JPG, PNG, WebP). GIF becomes PNG.
function outputTypeFor(file) {
  return EXT[file.type] ? file.type : 'image/png';
}

// Reads a file and gives back the loaded <img> element
function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Choose an image file (JPG, PNG, WebP or GIF).'));
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      reject(new Error('This file is over 100 MB. Choose a smaller picture.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth * img.naturalHeight > 150e6) {
        URL.revokeObjectURL(url);
        reject(new Error('This picture is too large to open safely (over 150 megapixels). Make it smaller first.'));
        return;
      }
      if (!img.naturalWidth || !img.naturalHeight) {
        URL.revokeObjectURL(url);
        reject(new Error('This image has no readable size. Try a JPG, PNG or WebP file.'));
        return;
      }
      resolve({ img, url, file });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file could not be read as an image.'));
    };
    img.src = url;
  });
}

// Draws the image onto a new canvas at the given size
function drawToCanvas(img, width, height, type) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') {
    // JPG has no transparency, so paint white first
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

// Turns a canvas into a file (Blob) in the chosen format
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('The browser could not create this image. Try smaller dimensions.'));
      },
      type,
      quality
    );
  });
}

// Shows a message under the drop zone
function say(section, text, isError = false) {
  const box = $('.message', section);
  box.textContent = text;
  box.classList.toggle('is-error', isError);
}

// Disables a button while work is running, and shows errors in the tool
async function withBusy(button, section, work) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Working...';
  try {
    await work();
  } catch (error) {
    say(section, error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// Connects a range slider to the <output> that shows its value
function bindSlider(slider, output) {
  const update = () => { output.textContent = slider.value; };
  slider.addEventListener('input', update);
  update();
}




/* ---------- Drop zone + result panel (shared by every tool) ---------- */

// options.multiple    -> onFile receives an array of files instead of one file
// options.pasteFilter -> which pasted files to accept (default: images only)
function setupDropzone(section, onFile, options = {}) {
  const zone = $('.dropzone', section);
  const input = $('input[type="file"]', zone);
  const multiple = Boolean(options.multiple);
  const pasteFilter = options.pasteFilter || ((file) => file.type.startsWith('image/'));

  const deliver = (list) => {
    const files = Array.from(list || []);
    if (files.length) onFile(multiple ? files : files[0]);
  };

  input.addEventListener('change', () => {
    const picked = Array.from(input.files || []);
    input.value = ''; // lets you pick the same file again later
    deliver(picked);
  });

  ['dragenter', 'dragover'].forEach((name) =>
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add('is-over');
    })
  );

  ['dragleave', 'drop'].forEach((name) =>
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove('is-over');
    })
  );

  zone.addEventListener('drop', (event) => deliver(event.dataTransfer.files));

  // Paste an image from the clipboard (Ctrl+V or Cmd+V)
  document.addEventListener('paste', (event) => {
    if (section.hidden) return;
    const files = Array.from(event.clipboardData ? event.clipboardData.files : []).filter(pasteFilter);
    if (files.length) {
      event.preventDefault();
      deliver(files);
    }
  });

  // Drop a file anywhere on the page
  const carriesFiles = (event) =>
    event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
  let depth = 0;

  window.addEventListener('dragenter', (event) => {
    if (section.hidden || !carriesFiles(event)) return;
    depth++;
    document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragleave', (event) => {
    if (section.hidden || !carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove('is-dragging');
  });
  window.addEventListener('dragover', (event) => {
    if (section.hidden || !carriesFiles(event)) return;
    event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (section.hidden || !carriesFiles(event)) return;
    depth = 0;
    document.body.classList.remove('is-dragging');
    if (event.defaultPrevented) return; // the drop zone already handled it
    event.preventDefault();
    deliver(event.dataTransfer.files);
  });
}

// Creates a tool: wires up its drop zone and remembers the loaded image
function createTool(name, onImage) {
  const section = $('#tool-' + name);
  let current = null;

  setupDropzone(section, async (file) => {
    try {
      say(section, '');
      const loaded = await loadImage(file);
      if (current) URL.revokeObjectURL(current.url);
      current = loaded;
      $('.workspace', section).hidden = false;
      hideResult(section);
      onImage(loaded, section);
    } catch (error) {
      say(section, error.message, true);
    }
  });

  return {
    section,
    get image() { return current; }
  };
}

const resultUrls = new WeakMap(); // remembers each tool's download URL so we can free it later

function showResult(section, { original, blob, filename, width, height }) {
  const result = $('.result', section);

  const oldUrl = resultUrls.get(section);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  const url = URL.createObjectURL(blob);
  resultUrls.set(section, url);

  $('.img-result', result).src = url;
  const cap = $('.cap-result', result);
  cap.textContent = `Result: ${width} \u00d7 ${height} px, ${formatBytes(blob.size)}`;
  if (original && original.file && original.file.size > 0) {
    const change = Math.round((1 - blob.size / original.file.size) * 100);
    if (change !== 0) {
      const chip = document.createElement('span');
      chip.className = 'savings' + (change < 0 ? ' is-up' : '');
      chip.textContent = change > 0 ? `${change}% smaller` : `${-change}% larger`;
      cap.append(chip);
    }
  }

  const originalImg = $('.img-original', result);
  if (originalImg && original) {
    originalImg.src = original.url;
    $('.cap-original', result).textContent =
      `Original: ${original.img.naturalWidth} \u00d7 ${original.img.naturalHeight} px, ${formatBytes(original.file.size)}`;
  }

  const link = $('.download', result);
  link.href = url;
  link.download = filename;

  result.hidden = false;
}

function hideResult(section) {
  const result = $('.result', section);
  if (result) result.hidden = true;
}


/* ==========================================================
   1. RESIZE
   ========================================================== */

(function initResize() {
  if (!$('#tool-resize')) return; // this tool is not on the current page

  const widthInput = $('#rs-width');
  const heightInput = $('#rs-height');
  const lockBox = $('#rs-lock');
  const goButton = $('#rs-go');
  let ratio = 1; // width divided by height of the original

  const tool = createTool('resize', ({ img }) => {
    ratio = img.naturalWidth / img.naturalHeight;
    widthInput.value = img.naturalWidth;
    heightInput.value = img.naturalHeight;
  });
  const section = tool.section;

  // Keep the two numbers in step when "Keep aspect ratio" is on
  widthInput.addEventListener('input', () => {
    if (lockBox.checked && widthInput.value) {
      heightInput.value = Math.max(1, Math.round(widthInput.value / ratio));
    }
  });
  heightInput.addEventListener('input', () => {
    if (lockBox.checked && heightInput.value) {
      widthInput.value = Math.max(1, Math.round(heightInput.value * ratio));
    }
  });

  // 25% / 50% / 75% / original size buttons
  $$('.chip[data-scale]', section).forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!tool.image) return;
      const scale = Number(chip.dataset.scale) / 100;
      widthInput.value = Math.max(1, Math.round(tool.image.img.naturalWidth * scale));
      heightInput.value = Math.max(1, Math.round(tool.image.img.naturalHeight * scale));
    });
  });

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      const { img, file } = tool.image;
      const width = parseInt(widthInput.value, 10);
      const height = parseInt(heightInput.value, 10);

      if (!(width > 0 && height > 0) || width > 10000 || height > 10000) {
        say(section, 'Enter a width and height between 1 and 10,000 pixels.', true);
        return;
      }

      const type = outputTypeFor(file);
      const canvas = drawToCanvas(img, width, height, type);
      const blob = await canvasToBlob(canvas, type, 0.92);

      showResult(section, {
        original: tool.image,
        blob,
        width,
        height,
        filename: `${baseName(file.name)}-${width}x${height}.${EXT[blob.type] || 'png'}`
      });
    })
  );
})();


/* ==========================================================
   2. COMPRESS
   ========================================================== */

(function initCompress() {
  if (!$('#tool-compress')) return; // this tool is not on the current page

  const formatSelect = $('#cp-format');
  const qualitySlider = $('#cp-quality');
  const targetInput = $('#cp-target');
  const goButton = $('#cp-go');

  const tool = createTool('compress', () => runCompress().catch((error) => say(section, error.message, true)));
  const section = tool.section;

  bindSlider(qualitySlider, $('#cp-quality-out'));

  // The slider is ignored when a target size is typed in
  targetInput.addEventListener('input', () => {
    qualitySlider.disabled = targetInput.value !== '';
  });

  // Tries lower and lower quality (and finally smaller dimensions)
  // until the file fits under the target size.
  async function compressToTarget(img, type, targetBytes) {
    let scale = 1;

    for (let attempt = 0; attempt < 8; attempt++) {
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = drawToCanvas(img, width, height, type);

      let low = 0.05;
      let high = 0.95;
      const smallest = await canvasToBlob(canvas, type, low);

      if (smallest.size <= targetBytes) {
        // It fits. Now search for the highest quality that still fits.
        let best = smallest;
        for (let i = 0; i < 7; i++) {
          const middle = (low + high) / 2;
          const blob = await canvasToBlob(canvas, type, middle);
          if (blob.size <= targetBytes) {
            best = blob;
            low = middle;
          } else {
            high = middle;
          }
        }
        return { blob: best, width, height, scale };
      }

      scale *= 0.85; // still too big, so shrink the picture and try again
    }
    return null;
  }

  // Runs the compression. Also used for the live preview, so an older run
  // that finishes late must never replace a newer one.
  let runId = 0;

  async function runCompress() {
    if (!tool.image) return;
    const myRun = ++runId;
    {
      say(section, '');
      const { img, file } = tool.image;
      const type = formatSelect.value;

      let blob;
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      let scaledDown = false;

      if (targetInput.value !== '') {
        const targetKB = parseFloat(targetInput.value);
        if (!(targetKB >= 5)) {
          say(section, 'Enter a target size of at least 5 KB, or clear the box to use the slider.', true);
          return;
        }
        const found = await compressToTarget(img, type, targetKB * 1024);
        if (!found) {
          say(section, `Could not reach ${targetKB} KB. Try a larger target or choose WebP.`, true);
          return;
        }
        ({ blob, width, height } = found);
        scaledDown = found.scale < 1;
      } else {
        const canvas = drawToCanvas(img, width, height, type);
        blob = await canvasToBlob(canvas, type, qualitySlider.value / 100);
      }

      if (myRun !== runId) return; // a newer run has started
      showResult(section, {
        original: tool.image,
        blob,
        width,
        height,
        filename: `${baseName(file.name)}-compressed.${EXT[blob.type] || 'png'}`
      });

      // Tell the person how it went
      if (blob.type !== type) {
        say(section, 'This browser cannot create that format, so it saved a PNG instead.', true);
      } else if (blob.size >= file.size) {
        say(section, 'The result is larger than the original. Lower the quality or set a target size.');
      } else {
        const saved = Math.round((1 - blob.size / file.size) * 100);
        say(section, `Saved ${saved}% of the file size.` +
          (scaledDown ? ' The image was scaled down to reach your target.' : ''));
      }
    }
  }

  goButton.addEventListener('click', () => withBusy(goButton, section, runCompress));

  // Live preview: the result updates while you move the slider
  let liveTimer = null;
  const live = () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      runCompress().catch((error) => say(section, error.message, true));
    }, 150);
  };
  qualitySlider.addEventListener('input', live);
  formatSelect.addEventListener('change', live);
})();


/* ==========================================================
   3. CONVERT
   ========================================================== */

(function initConvert() {
  if (!$('#tool-convert')) return; // this tool is not on the current page

  const formatSelect = $('#cv-format');
  const qualityField = $('#cv-quality-field');
  const qualitySlider = $('#cv-quality');
  const goButton = $('#cv-go');

  const tool = createTool('convert', () => {});
  const section = tool.section;

  bindSlider(qualitySlider, $('#cv-quality-out'));

  // PNG has no quality setting, so hide the slider for it
  function updateQualityVisibility() {
    qualityField.hidden = formatSelect.value === 'image/png';
  }
  formatSelect.addEventListener('change', updateQualityVisibility);
  updateQualityVisibility();

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      const { img, file } = tool.image;
      const type = formatSelect.value;
      const quality = type === 'image/png' ? undefined : qualitySlider.value / 100;

      const canvas = drawToCanvas(img, img.naturalWidth, img.naturalHeight, type);
      const blob = await canvasToBlob(canvas, type, quality);

      showResult(section, {
        original: tool.image,
        blob,
        width: img.naturalWidth,
        height: img.naturalHeight,
        filename: `${baseName(file.name)}-converted.${EXT[blob.type] || 'png'}`
      });

      if (blob.type !== type) {
        say(section, 'This browser cannot create that format, so it saved a PNG instead.', true);
      }
    })
  );
})();


/* ==========================================================
   4. CROP
   ========================================================== */

(function initCrop() {
  if (!$('#tool-crop')) return; // this tool is not on the current page

  const canvas = $('#cr-canvas');
  const ctx = canvas.getContext('2d');
  const shapeButtons = $$('#cr-shapes .chip[data-ratio]');
  const flipButton = $('#cr-flip');
  const fields = { x: $('#cr-x'), y: $('#cr-y'), w: $('#cr-w'), h: $('#cr-h') };
  const info = $('#cr-info');
  const goButton = $('#cr-go');
  const allButton = $('#cr-all');
  const resetButton = $('#cr-reset');

  const MAX_PREVIEW_WIDTH = 1000; // the preview canvas is never wider than this
  const MIN_SIZE = 8;             // smallest selection, in real image pixels

  let W = 0;            // real image size
  let H = 0;
  let scale = 1;        // real pixels -> preview pixels
  let sel = null;       // { x, y, w, h } in real image pixels
  let ratio = 0;        // width divided by height, or 0 for a free shape
  let mode = 'free';    // 'free', 'original' or 'fixed'
  let drag = null;      // what the pointer is doing right now

  const tool = createTool('crop', ({ img }) => {
    W = img.naturalWidth;
    H = img.naturalHeight;
    scale = Math.min(1, MAX_PREVIEW_WIDTH / W);
    canvas.width = Math.max(1, Math.round(W * scale));
    canvas.height = Math.max(1, Math.round(H * scale));
    scale = canvas.width / W;
    fields.x.max = W; fields.y.max = H; fields.w.max = W; fields.h.max = H;
    if (mode === 'original') ratio = W / H;
    sel = defaultSelection();
    refresh();
  });
  const section = tool.section;

  /* ---------- Selection maths (everything in real image pixels) ---------- */

  // A centred box covering most of the image, in the chosen shape
  function defaultSelection() {
    let w = W * 0.8;
    let h = H * 0.8;
    if (ratio) {
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
    }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  // Changes the box to a new shape, keeping its centre and staying inside the image
  function refit() {
    if (!sel || !ratio) return;
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    let w = sel.w;
    let h = sel.h;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    if (w > W) { w = W; h = w / ratio; }
    if (h > H) { h = H; w = h * ratio; }
    sel = {
      x: clamp(cx - w / 2, 0, W - w),
      y: clamp(cy - h / 2, 0, H - h),
      w,
      h
    };
  }

  // Draws a new box from a fixed corner to the pointer
  function newSelection(anchor, point) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    let w = Math.abs(dx);
    let h = Math.abs(dy);
    const maxW = dx >= 0 ? W - anchor.x : anchor.x;
    const maxH = dy >= 0 ? H - anchor.y : anchor.y;

    if (ratio) {
      if (w / Math.max(h, 0.0001) > ratio) w = h * ratio;
      else h = w / ratio;
      if (w > maxW) { w = maxW; h = w / ratio; }
      if (h > maxH) { h = maxH; w = h * ratio; }
    }
    return {
      x: dx >= 0 ? anchor.x : anchor.x - w,
      y: dy >= 0 ? anchor.y : anchor.y - h,
      w,
      h
    };
  }

  // Pulls one handle of an existing box. "start" is the box when the drag began.
  function resizeBox(handle, start, point) {
    const west = handle.includes('w');
    const east = handle.includes('e');
    const north = handle.includes('n');
    const south = handle.includes('s');

    if (!ratio) {
      let l = start.x;
      let t = start.y;
      let r = start.x + start.w;
      let b = start.y + start.h;
      if (west) l = clamp(point.x, 0, r - MIN_SIZE);
      if (east) r = clamp(point.x, l + MIN_SIZE, W);
      if (north) t = clamp(point.y, 0, b - MIN_SIZE);
      if (south) b = clamp(point.y, t + MIN_SIZE, H);
      return { x: l, y: t, w: r - l, h: b - t };
    }

    // A fixed shape: the opposite corner or edge stays where it is
    const sx = west ? -1 : 1;
    const sy = north ? -1 : 1;
    const ax = west ? start.x + start.w : start.x;
    const ay = north ? start.y + start.h : start.y;
    const availW = sx > 0 ? W - ax : ax;
    const availH = sy > 0 ? H - ay : ay;
    let w;
    let h;

    if ((west || east) && (north || south)) {
      // Corner handle
      w = Math.max(0, (point.x - ax) * sx);
      h = Math.max(0, (point.y - ay) * sy);
      if (w / Math.max(h, 0.0001) > ratio) w = h * ratio;
      else h = w / ratio;
      const maxW = Math.min(availW, availH * ratio);
      if (w > maxW) { w = maxW; h = w / ratio; }
      if (w < MIN_SIZE) { w = MIN_SIZE; h = w / ratio; }
      return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
    }

    if (west || east) {
      // Side handle: the box stays centred on its old vertical middle
      const cy = start.y + start.h / 2;
      w = clamp((point.x - ax) * sx, MIN_SIZE, availW);
      h = w / ratio;
      const maxH = 2 * Math.min(cy, H - cy);
      if (h > maxH) { h = maxH; w = h * ratio; }
      return { x: sx > 0 ? ax : ax - w, y: cy - h / 2, w, h };
    }

    // Top or bottom handle
    const cx = start.x + start.w / 2;
    h = clamp((point.y - ay) * sy, MIN_SIZE, availH);
    w = h * ratio;
    const maxW = 2 * Math.min(cx, W - cx);
    if (w > maxW) { w = maxW; h = w / ratio; }
    return { x: cx - w / 2, y: sy > 0 ? ay : ay - h, w, h };
  }

  /* ---------- Drawing ---------- */

  // How many preview pixels one on-screen pixel covers (the canvas is scaled by CSS)
  function unit() {
    const box = canvas.getBoundingClientRect();
    return box.width ? canvas.width / box.width : 1;
  }

  function handlePoints() {
    const l = sel.x * scale;
    const t = sel.y * scale;
    const r = (sel.x + sel.w) * scale;
    const b = (sel.y + sel.h) * scale;
    const mx = (l + r) / 2;
    const my = (t + b) / 2;
    return {
      nw: [l, t], n: [mx, t], ne: [r, t],
      e: [r, my], se: [r, b], s: [mx, b],
      sw: [l, b], w: [l, my]
    };
  }

  function draw() {
    if (!tool.image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tool.image.img, 0, 0, canvas.width, canvas.height);
    if (!sel) return;

    const u = unit();
    const l = sel.x * scale;
    const t = sel.y * scale;
    const w = sel.w * scale;
    const h = sel.h * scale;

    // Darken everything outside the box
    ctx.fillStyle = 'rgba(20, 24, 27, 0.62)';
    ctx.fillRect(0, 0, canvas.width, t);
    ctx.fillRect(0, t + h, canvas.width, canvas.height - t - h);
    ctx.fillRect(0, t, l, h);
    ctx.fillRect(l + w, t, canvas.width - l - w, h);

    // Rule-of-thirds guides, while you are adjusting the box
    if (drag) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = u;
      ctx.beginPath();
      for (let i = 1; i <= 2; i++) {
        ctx.moveTo(l + (w * i) / 3, t);
        ctx.lineTo(l + (w * i) / 3, t + h);
        ctx.moveTo(l, t + (h * i) / 3);
        ctx.lineTo(l + w, t + (h * i) / 3);
      }
      ctx.stroke();
    }

    // The box itself
    ctx.strokeStyle = '#f2b705';
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(l, t, w, h);

    // Handles: about 12 on-screen pixels wide, whatever the picture size
    const size = 12 * u;
    Object.values(handlePoints()).forEach(([hx, hy]) => {
      ctx.fillStyle = '#f2b705';
      ctx.fillRect(hx - size / 2, hy - size / 2, size, size);
      ctx.strokeStyle = '#1d2022';
      ctx.lineWidth = u;
      ctx.strokeRect(hx - size / 2, hy - size / 2, size, size);
    });
  }

  /* ---------- Keeping the numbers, hint and buttons in step ---------- */

  function syncFields(except) {
    if (!sel) {
      Object.values(fields).forEach((input) => { input.value = ''; });
      return;
    }
    const values = {
      x: Math.round(sel.x),
      y: Math.round(sel.y),
      w: Math.round(sel.w),
      h: Math.round(sel.h)
    };
    Object.keys(fields).forEach((key) => {
      if (fields[key] !== except) fields[key].value = values[key];
    });
  }

  function updateInfo() {
    goButton.disabled = !sel;
    flipButton.disabled = !ratio;
    if (!sel) {
      info.textContent = 'Drag on the image to select an area.';
      return;
    }
    const w = Math.round(sel.w);
    const h = Math.round(sel.h);
    const share = Math.round(((w * h) / (W * H)) * 100);
    info.textContent = `Cropping to ${w} \u00d7 ${h} px, which is ${share}% of the image.`;
  }

  function refresh(except) {
    syncFields(except);
    updateInfo();
    draw();
  }

  /* ---------- Mouse, finger and pen ---------- */

  // Pointer position in real image pixels
  function pointerPosition(event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - box.left) / box.width) * W, 0, W),
      y: clamp(((event.clientY - box.top) / box.height) * H, 0, H)
    };
  }

  // What is under the pointer: a handle name, 'move', or 'new'
  function hitTest(event) {
    if (!sel) return 'new';
    const box = canvas.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * canvas.width;
    const py = ((event.clientY - box.top) / box.height) * canvas.height;
    const reach = (event.pointerType === 'touch' ? 24 : 14) * unit();

    let best = null;
    let bestDistance = reach;
    Object.entries(handlePoints()).forEach(([name, [hx, hy]]) => {
      const distance = Math.hypot(px - hx, py - hy);
      if (distance <= bestDistance) {
        best = name;
        bestDistance = distance;
      }
    });
    if (best) return best;

    const inside = px >= sel.x * scale && px <= (sel.x + sel.w) * scale &&
                   py >= sel.y * scale && py <= (sel.y + sel.h) * scale;
    return inside ? 'move' : 'new';
  }

  const CURSORS = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    move: 'move', new: 'crosshair'
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (!tool.image) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);

    const point = pointerPosition(event);
    const kind = hitTest(event);
    drag = { kind, start: point, box: sel ? { ...sel } : null };
    if (kind === 'new') sel = null;
    refresh();
  });

  canvas.addEventListener('pointermove', (event) => {
    const point = pointerPosition(event);

    if (!drag) {
      canvas.style.cursor = CURSORS[hitTest(event)];
      return;
    }

    if (drag.kind === 'new') {
      sel = newSelection(drag.start, point);
    } else if (drag.kind === 'move') {
      sel = {
        x: clamp(drag.box.x + (point.x - drag.start.x), 0, W - drag.box.w),
        y: clamp(drag.box.y + (point.y - drag.start.y), 0, H - drag.box.h),
        w: drag.box.w,
        h: drag.box.h
      };
    } else {
      sel = resizeBox(drag.kind, drag.box, point);
    }
    refresh();
  });

  function endDrag() {
    if (!drag) return;
    drag = null;
    if (sel && (sel.w < MIN_SIZE || sel.h < MIN_SIZE)) sel = null; // ignore tiny clicks
    refresh();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Arrow keys move the box. With Shift they resize it.
  canvas.addEventListener('keydown', (event) => {
    if (!sel) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = arrows[event.key];
    if (!move) return;
    event.preventDefault();

    const step = event.altKey ? 10 : 1;
    if (event.shiftKey) {
      const point = { x: sel.x + sel.w + move[0] * step, y: sel.y + sel.h + move[1] * step };
      sel = resizeBox('se', { ...sel }, point);
    } else {
      sel = {
        ...sel,
        x: clamp(sel.x + move[0] * step, 0, W - sel.w),
        y: clamp(sel.y + move[1] * step, 0, H - sel.h)
      };
    }
    refresh();
  });

  /* ---------- Shape buttons ---------- */

  function setShape(value) {
    mode = value === 'original' ? 'original' : value === '0' ? 'free' : 'fixed';
    if (mode === 'original') ratio = H ? W / H : 0;
    else if (mode === 'free') ratio = 0;
    else ratio = parseFloat(value);

    shapeButtons.forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.ratio === value))
    );

    if (!tool.image) return;
    if (!sel) sel = defaultSelection();
    else refit();
    refresh();
  }
  shapeButtons.forEach((button) =>
    button.addEventListener('click', () => setShape(button.dataset.ratio))
  );

  // Turns a landscape shape into a portrait one, and back
  flipButton.addEventListener('click', () => {
    if (!ratio) return;
    ratio = 1 / ratio;
    mode = 'fixed';
    shapeButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
    refit();
    refresh();
  });

  /* ---------- Typing exact numbers ---------- */

  Object.entries(fields).forEach(([key, input]) => {
    input.addEventListener('input', () => {
      if (!sel || input.value === '') return;
      const value = Math.round(Number(input.value));
      if (!Number.isFinite(value)) return;

      if (key === 'x') sel.x = clamp(value, 0, W - sel.w);
      if (key === 'y') sel.y = clamp(value, 0, H - sel.h);

      if (key === 'w') {
        sel.w = clamp(value, 1, W - sel.x);
        if (ratio) {
          sel.h = sel.w / ratio;
          if (sel.y + sel.h > H) { sel.h = H - sel.y; sel.w = sel.h * ratio; }
        }
      }
      if (key === 'h') {
        sel.h = clamp(value, 1, H - sel.y);
        if (ratio) {
          sel.w = sel.h * ratio;
          if (sel.x + sel.w > W) { sel.w = W - sel.x; sel.h = sel.w / ratio; }
        }
      }
      refresh(input); // leave the box being typed in alone
    });

    // When you leave a box, tidy it to the value that was actually used
    input.addEventListener('change', () => refresh());
  });

  /* ---------- Buttons ---------- */

  allButton.addEventListener('click', () => {
    if (!tool.image) return;
    sel = { x: 0, y: 0, w: W, h: H };
    if (ratio) refit();
    refresh();
  });

  resetButton.addEventListener('click', () => {
    sel = null;
    refresh();
  });

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      if (!sel) return;
      const { img, file } = tool.image;

      const sx = clamp(Math.round(sel.x), 0, W - 1);
      const sy = clamp(Math.round(sel.y), 0, H - 1);
      const sw = clamp(Math.round(sel.w), 1, W - sx);
      const sh = clamp(Math.round(sel.h), 1, H - sy);

      const type = outputTypeFor(file);
      const out = document.createElement('canvas');
      out.width = sw;
      out.height = sh;
      const outCtx = out.getContext('2d');
      if (type === 'image/jpeg') {
        outCtx.fillStyle = '#ffffff';
        outCtx.fillRect(0, 0, sw, sh);
      }
      outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const blob = await canvasToBlob(out, type, 0.92);

      showResult(section, {
        original: null,
        blob,
        width: sw,
        height: sh,
        filename: `${baseName(file.name)}-cropped.${EXT[blob.type] || 'png'}`
      });
    })
  );
})();


/* ==========================================================
   5. IMAGE TO BASE64
   ========================================================== */

(function initBase64() {
  if (!$('#tool-base64')) return; // this tool is not on the current page

  const formatSelect = $('#b64-format');
  const output = $('#b64-out');
  const info = $('#b64-info');
  const preview = $('#b64-preview');
  const copyButton = $('#b64-copy');
  let dataUri = '';

  const tool = createTool('base64', ({ file, url }) => {
    preview.src = url;
    dataUri = '';
    output.value = '';

    const reader = new FileReader();
    reader.onload = () => {
      dataUri = reader.result;
      render();
    };
    reader.onerror = () => say(tool.section, 'This file could not be read.', true);
    reader.readAsDataURL(file);
  });

  // Builds the text in the format the person chose
  function render() {
    if (!dataUri) return;
    const raw = dataUri.split(',')[1] || '';
    let text = '';

    switch (formatSelect.value) {
      case 'raw':
        text = raw;
        break;
      case 'img':
        text = `<img src="${dataUri}" alt="">`;
        break;
      case 'css':
        text = `background-image: url("${dataUri}");`;
        break;
      default:
        text = dataUri;
    }

    output.value = text;
    info.textContent =
      `${text.length.toLocaleString()} characters. Base64 text is about a third larger than the original file.`;
  }

  formatSelect.addEventListener('change', render);

  copyButton.addEventListener('click', async () => {
    if (!output.value) return;
    try {
      await navigator.clipboard.writeText(output.value);
    } catch (error) {
      // Older browsers: select the text and use the old copy command
      output.select();
      document.execCommand('copy');
    }
    copyButton.textContent = 'Copied';
    setTimeout(() => { copyButton.textContent = 'Copy text'; }, 1500);
  });
})();


/* ==========================================================
   MENU AND HOME PAGE SEARCH
   ========================================================== */

(function menu() {
  const menu = $('.menu');
  if (!menu) return;
  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      $('summary', menu).focus();
    }
  });
})();

(function finder() {
  const input = $('#finder');
  if (!input) return;
  const cards = [...document.querySelectorAll('.card[data-search]')];
  const groups = [...document.querySelectorAll('.group')];
  const status = $('#finder-status');
  const none = $('#no-match');

  function filter() {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    cards.forEach((card) => {
      const text = card.dataset.search;
      const match = words.every((word) => text.includes(word));
      card.hidden = !match;
      if (match) shown += 1;
    });
    groups.forEach((group) => {
      group.hidden = !group.querySelector('.card:not([hidden])');
    });
    none.hidden = shown > 0;
    status.textContent = words.length && shown
      ? shown + (shown === 1 ? ' tool found' : ' tools found')
      : '';
  }

  input.addEventListener('input', filter);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = cards.find((card) => !card.hidden);
      // Tools open in a new tab, the same as clicking a card
      if (first && input.value.trim()) window.open(first.href, '_blank', 'noopener');
    }
  });
  $('#finder-clear').addEventListener('click', () => {
    input.value = '';
    filter();
    input.focus();
  });
})();
