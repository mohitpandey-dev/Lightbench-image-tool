'use strict';

/* ==========================================================
   Lightbench: core logic for the document and layout tools.

   Nothing in this file touches the page. It holds the parts that
   can be tested on their own:
     - a small PDF writer (JPEG files go in untouched, other images
       are stored losslessly, transparency is kept)
     - a ZIP writer
     - a JPEG header reader (size, colour type, EXIF rotation)
     - page, collage, contact sheet and sprite sheet layout maths
   ========================================================== */

(function (root) {
  const LBCore = {};

  /* ---------- Small utilities ---------- */

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // A number for a PDF file: at most 3 decimals, never in "1e-7" form
  function num(value) {
    return String(Number((Number.isFinite(value) ? value : 0).toFixed(3)));
  }

  // A JavaScript string of plain characters -> bytes (one byte each)
  function latin1(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
    return bytes;
  }

  // Text for a PDF info field: UTF-16 in hex, so any language works
  function pdfTextString(text) {
    let hex = 'FEFF';
    for (let i = 0; i < text.length; i++) {
      hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    }
    return '<' + hex + '>';
  }

  function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  // "Holiday Photo #3.JPG" -> "holiday-photo-3"
  function slug(text) {
    return String(text)
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }


  /* ==========================================================
     PDF writer
     ========================================================== */

  class PdfWriter {
    constructor() {
      this.parts = [];
      this.size = 0;
      this.offsets = [];
      this.nextId = 1;
      // The second line holds high bytes, which tells programs this file is binary
      this.write('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    }

    write(data) {
      const bytes = typeof data === 'string' ? latin1(data) : data;
      this.parts.push(bytes);
      this.size += bytes.length;
    }

    reserve() {
      return this.nextId++;
    }

    // Writes object number `id`. `dict` is the text between << and >>.
    object(id, dict, stream) {
      this.offsets[id] = this.size;
      if (stream === undefined) {
        this.write(`${id} 0 obj\n<< ${dict} >>\nendobj\n`);
        return;
      }
      const data = typeof stream === 'string' ? latin1(stream) : stream;
      this.write(`${id} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`);
      this.write(data);
      this.write('\nendstream\nendobj\n');
    }

    finish(rootId, infoId) {
      const xrefAt = this.size;
      let xref = `xref\n0 ${this.nextId}\n0000000000 65535 f \n`;
      for (let id = 1; id < this.nextId; id++) {
        if (this.offsets[id] === undefined) throw new Error('PDF object ' + id + ' was never written.');
        xref += String(this.offsets[id]).padStart(10, '0') + ' 00000 n \n';
      }
      xref += `trailer\n<< /Size ${this.nextId} /Root ${rootId} 0 R` +
        (infoId ? ` /Info ${infoId} 0 R` : '') +
        ` >>\nstartxref\n${xrefAt}\n%%EOF\n`;
      this.write(xref);
      return new Blob(this.parts, { type: 'application/pdf' });
    }
  }

  class PdfDocument {
    constructor() {
      this.w = new PdfWriter();
      this.catalogId = this.w.reserve();
      this.pagesId = this.w.reserve();
      this.pageIds = [];
    }

    get pageCount() {
      return this.pageIds.length;
    }

    // A JPEG file, stored as it is (no re-compression)
    addJpeg(bytes, width, height, components) {
      const id = this.w.reserve();
      const space = components === 1 ? '/DeviceGray' : '/DeviceRGB';
      this.w.object(
        id,
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode`,
        bytes
      );
      return id;
    }

    // Pixels that were filtered and deflated by encodeRaster()
    addRaster(width, height, rgb, alpha) {
      let maskId = 0;
      if (alpha) {
        maskId = this.w.reserve();
        this.w.object(
          maskId,
          `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          '/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode ' +
          `/DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${width} >>`,
          alpha
        );
      }
      const id = this.w.reserve();
      this.w.object(
        id,
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ' +
        `/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${width} >>` +
        (maskId ? ` /SMask ${maskId} 0 R` : ''),
        rgb
      );
      return id;
    }

    // `content` is the drawing commands, `images` maps a name to an image id
    addPage(width, height, content, images) {
      const contentId = this.w.reserve();
      this.w.object(contentId, '', content);
      const pageId = this.w.reserve();
      const xobjects = Object.keys(images).map((name) => `/${name} ${images[name]} 0 R`).join(' ');
      this.w.object(
        pageId,
        `/Type /Page /Parent ${this.pagesId} 0 R ` +
        `/MediaBox [0 0 ${num(width)} ${num(height)}] ` +
        `/Resources << /XObject << ${xobjects} >> >> /Contents ${contentId} 0 R`
      );
      this.pageIds.push(pageId);
      return pageId;
    }

    finish(title) {
      this.w.object(
        this.pagesId,
        `/Type /Pages /Kids [${this.pageIds.map((id) => id + ' 0 R').join(' ')}] /Count ${this.pageIds.length}`
      );
      this.w.object(this.catalogId, `/Type /Catalog /Pages ${this.pagesId} 0 R`);

      const now = new Date();
      const stamp = 'D:' + now.getUTCFullYear() +
        String(now.getUTCMonth() + 1).padStart(2, '0') +
        String(now.getUTCDate()).padStart(2, '0') +
        String(now.getUTCHours()).padStart(2, '0') +
        String(now.getUTCMinutes()).padStart(2, '0') +
        String(now.getUTCSeconds()).padStart(2, '0') + 'Z';
      const infoId = this.w.reserve();
      this.w.object(
        infoId,
        (title ? `/Title ${pdfTextString(title)} ` : '') +
        `/Producer (Lightbench) /Creator (Lightbench) /CreationDate (${stamp})`
      );
      return this.w.finish(this.catalogId, infoId);
    }
  }


  /* ==========================================================
     Images inside a PDF
     ========================================================== */

  // Reads a JPEG's header without decoding it
  function parseJpeg(b) {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    const info = { width: 0, height: 0, components: 0, precision: 0, sof: 0, orientation: 1 };
    let i = 2;

    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }                        // padding
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;                                                       // markers with no length
        continue;
      }
      if (marker === 0xd9) break;

      const length = (b[i + 2] << 8) | b[i + 3];
      const start = i + 4;

      const isFrame = marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) {
        info.sof = marker;
        info.precision = b[start];
        info.height = (b[start + 1] << 8) | b[start + 2];
        info.width = (b[start + 3] << 8) | b[start + 4];
        info.components = b[start + 5];
        break;
      }
      if (marker === 0xe1) info.orientation = readExifOrientation(b, start, length - 2) || info.orientation;

      i += 2 + length;
    }
    return info.width > 0 && info.height > 0 ? info : null;
  }

  function readExifOrientation(b, start, length) {
    const end = Math.min(b.length, start + length);
    // "Exif" followed by two zero bytes
    if (end - start < 14 || b[start] !== 0x45 || b[start + 1] !== 0x78 ||
        b[start + 2] !== 0x69 || b[start + 3] !== 0x66) return 0;

    const tiff = start + 6;
    const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
    const big = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
    if (!little && !big) return 0;

    const u16 = (p) => (p + 2 > end ? 0 : little ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
    const u32 = (p) => (p + 4 > end ? 0 : little
      ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
      : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);

    if (u16(tiff + 2) !== 42) return 0;
    const ifd = tiff + u32(tiff + 4);
    const entries = u16(ifd);
    for (let n = 0; n < entries; n++) {
      const entry = ifd + 2 + n * 12;
      if (u16(entry) === 0x0112) return u16(entry + 8);
    }
    return 0;
  }

  // Can this JPEG go into a PDF byte for byte?
  // Needs 8-bit gray or colour data, in a format PDF readers understand,
  // that is not rotated by an EXIF tag (a PDF would ignore that tag).
  function canEmbedJpeg(info) {
    return Boolean(info) &&
      (info.sof === 0xc0 || info.sof === 0xc1 || info.sof === 0xc2) &&
      info.precision === 8 &&
      (info.components === 1 || info.components === 3) &&
      info.orientation <= 1;
  }

  function canDeflate() {
    return typeof CompressionStream === 'function' && typeof Response === 'function';
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // PNG-style row filters. They make screenshots and graphics compress
  // far better, and every PDF reader knows how to undo them.
  function filterRows(data, width, height, bpp) {
    const stride = width * bpp;
    const out = new Uint8Array((stride + 1) * height);
    const zero = new Uint8Array(stride);
    const sub = new Uint8Array(stride);
    const up = new Uint8Array(stride);
    const paeth = new Uint8Array(stride);
    const usePaeth = width * height <= 24e6; // skip the slowest filter on huge images

    for (let y = 0; y < height; y++) {
      const row = data.subarray(y * stride, (y + 1) * stride);
      const prev = y ? data.subarray((y - 1) * stride, y * stride) : zero;
      let scoreNone = 0, scoreSub = 0, scoreUp = 0, scorePaeth = 0;

      for (let i = 0; i < stride; i++) {
        const x = row[i];
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;

        const vSub = (x - a) & 255;
        const vUp = (x - b) & 255;
        sub[i] = vSub;
        up[i] = vUp;
        scoreNone += x < 128 ? x : 256 - x;
        scoreSub += vSub < 128 ? vSub : 256 - vSub;
        scoreUp += vUp < 128 ? vUp : 256 - vUp;

        if (usePaeth) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const guess = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          const vPaeth = (x - guess) & 255;
          paeth[i] = vPaeth;
          scorePaeth += vPaeth < 128 ? vPaeth : 256 - vPaeth;
        }
      }

      let type = 0;
      let best = scoreNone;
      let chosen = row;
      if (scoreSub < best) { best = scoreSub; type = 1; chosen = sub; }
      if (scoreUp < best) { best = scoreUp; type = 2; chosen = up; }
      if (usePaeth && scorePaeth < best) { type = 4; chosen = paeth; }

      const at = y * (stride + 1);
      out[at] = type;
      out.set(chosen, at + 1);
    }
    return out;
  }

  // RGBA pixels (from a canvas) -> compressed colour data and, if the
  // picture has see-through parts, compressed transparency data
  async function encodeRaster(rgba, width, height) {
    const count = width * height;
    const rgb = new Uint8Array(count * 3);
    const alpha = new Uint8Array(count);
    let seeThrough = false;

    for (let i = 0, p = 0, q = 0; i < count; i++, p += 4, q += 3) {
      rgb[q] = rgba[p];
      rgb[q + 1] = rgba[p + 1];
      rgb[q + 2] = rgba[p + 2];
      const a = rgba[p + 3];
      alpha[i] = a;
      if (a !== 255) seeThrough = true;
    }

    return {
      rgb: await deflate(filterRows(rgb, width, height, 3)),
      alpha: seeThrough ? await deflate(filterRows(alpha, width, height, 1)) : null
    };
  }


  /* ==========================================================
     Where an image goes on the PDF page(s)
     ========================================================== */

  const PAGE_SIZES = {
    a4: [595.28, 841.89],
    a5: [419.53, 595.28],
    letter: [612, 792],
    legal: [612, 1008]
  };
  const PX_TO_PT = 0.75;   // 96 pixels per inch on screen, 72 points per inch in a PDF
  const MAX_PAGE_PT = 14400; // PDF readers stop at 200 inches

  // Returns one entry per PDF page: { width, height, place, clip }
  // `place` is where the image is drawn, `clip` is the area that stays visible.
  // All numbers are in points, measured from the bottom left corner.
  function planPages(imgW, imgH, o) {
    const margin = Math.max(0, o.margin || 0);

    if (o.size === 'match') {
      let w = imgW * PX_TO_PT;
      let h = imgH * PX_TO_PT;
      const shrink = Math.min(1, (MAX_PAGE_PT - 2 * margin) / Math.max(w, h));
      w *= shrink;
      h *= shrink;
      return [{
        width: w + 2 * margin,
        height: h + 2 * margin,
        place: { x: margin, y: margin, w, h },
        clip: null
      }];
    }

    let [pw, ph] = PAGE_SIZES[o.size] || PAGE_SIZES.a4;
    const landscape = o.orient === 'landscape' ||
      (o.orient === 'auto' && o.fit !== 'split' && imgW > imgH);
    if (landscape) [pw, ph] = [ph, pw];

    const m = Math.min(margin, Math.min(pw, ph) * 0.3);
    const cw = pw - 2 * m;
    const ch = ph - 2 * m;
    const clip = { x: m, y: m, w: cw, h: ch };

    if (o.fit === 'cover') {
      const scale = Math.max(cw / imgW, ch / imgH);
      const w = imgW * scale;
      const h = imgH * scale;
      return [{ width: pw, height: ph, place: { x: m + (cw - w) / 2, y: m + (ch - h) / 2, w, h }, clip }];
    }

    if (o.fit === 'split') {
      const w = cw;
      const h = imgH * (cw / imgW);
      const count = Math.max(1, Math.ceil(h / ch - 1e-6));
      const pages = [];
      for (let i = 0; i < count; i++) {
        pages.push({
          width: pw,
          height: ph,
          // Each page slides the picture up by one page height
          place: { x: m, y: ph - m + i * ch - h, w, h },
          clip
        });
      }
      return pages;
    }

    const scale = Math.min(cw / imgW, ch / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    return [{ width: pw, height: ph, place: { x: m + (cw - w) / 2, y: m + (ch - h) / 2, w, h }, clip: null }];
  }

  // The drawing commands for one page
  function pageContent(plan, name) {
    const p = plan.place;
    let out = 'q\n';
    if (plan.clip) {
      out += `${num(plan.clip.x)} ${num(plan.clip.y)} ${num(plan.clip.w)} ${num(plan.clip.h)} re W n\n`;
    }
    out += `${num(p.w)} 0 0 ${num(p.h)} ${num(p.x)} ${num(p.y)} cm\n/${name} Do\nQ\n`;
    return out;
  }


  /* ==========================================================
     Page ranges such as "1-3, 5, 8-"
     ========================================================== */

  function parsePageRange(text, total) {
    const source = String(text || '').trim();
    if (!source) return Array.from({ length: total }, (_, i) => i + 1);

    const chosen = new Set();
    for (const part of source.split(/[,;\s]+/).filter(Boolean)) {
      const match = /^(\d*)(-?)(\d*)$/.exec(part);
      if (!match || (!match[1] && !match[3])) {
        throw new Error(`"${part}" is not a page number. Try something like 1-3, 5.`);
      }
      let from;
      let to;
      if (!match[2]) {
        from = to = parseInt(match[1], 10);
      } else {
        from = match[1] ? parseInt(match[1], 10) : 1;
        to = match[3] ? parseInt(match[3], 10) : total;
      }
      if (from < 1 || to < 1 || from > total || to > total) {
        throw new Error(`Page ${from > total || from < 1 ? from : to} is outside this PDF, which has ${total} page${total === 1 ? '' : 's'}.`);
      }
      if (from > to) throw new Error(`"${part}" counts backwards. Write the smaller page number first.`);
      for (let p = from; p <= to; p++) chosen.add(p);
    }
    return Array.from(chosen).sort((a, b) => a - b);
  }


  /* ==========================================================
     ZIP writer (files are stored, not compressed)
     ========================================================== */

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // files: [{ name, data: Blob | Uint8Array }]
  async function makeZip(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const chunks = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(await file.data.arrayBuffer());
      const name = encoder.encode(file.name);
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);      // file names are UTF-8
      lv.setUint16(8, 0, true);           // stored
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);

      const entry = new Uint8Array(46 + name.length);
      const ev = new DataView(entry.buffer);
      ev.setUint32(0, 0x02014b50, true);
      ev.setUint16(4, 20, true);
      ev.setUint16(6, 20, true);
      ev.setUint16(8, 0x0800, true);
      ev.setUint16(10, 0, true);
      ev.setUint16(12, dosTime, true);
      ev.setUint16(14, dosDate, true);
      ev.setUint32(16, crc, true);
      ev.setUint32(20, data.length, true);
      ev.setUint32(24, data.length, true);
      ev.setUint16(28, name.length, true);
      ev.setUint32(42, offset, true);
      entry.set(name, 46);

      chunks.push(local, data);
      central.push(entry);
      offset += local.length + data.length;
    }

    const centralSize = central.reduce((sum, e) => sum + e.length, 0);
    const end = new Uint8Array(22);
    const dv = new DataView(end.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(8, files.length, true);
    dv.setUint16(10, files.length, true);
    dv.setUint32(12, centralSize, true);
    dv.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }


  /* ==========================================================
     Collage layout
     aspects: width / height of every photo
     o: { layout: 'grid' | 'rows', cols, aspect (0 = fit to photos),
          gap, margin }   gap and margin are per 1000 px of width
     ========================================================== */

  function collageLayout(aspects, o, W) {
    const n = aspects.length;
    const scale = W / 1000;
    const gap = o.gap * scale;
    const margin = o.margin * scale;
    const innerW = W - 2 * margin;
    const cols = clamp(Math.round(o.cols) || 1, 1, n);
    const mean = aspects.reduce((a, b) => a + b, 0) / n;
    const cells = [];
    let height;

    if (o.layout === 'rows') {
      // Rows of photos that keep their shape and stretch to the same width
      const target = (innerW - gap * (cols - 1)) / (cols * mean);
      const rows = [];
      let row = [];
      let sum = 0;
      aspects.forEach((a, i) => {
        row.push(i);
        sum += a;
        if (sum * target + gap * (row.length - 1) >= innerW) {
          rows.push({ idx: row, sum, full: true });
          row = [];
          sum = 0;
        }
      });
      if (row.length) rows.push({ idx: row, sum, full: false });

      let y = margin;
      rows.forEach((r) => {
        const k = r.idx.length;
        let h = (innerW - gap * (k - 1)) / r.sum;
        if (!r.full) h = Math.min(h, target); // a short last row is centred, not stretched
        const rowW = r.sum * h + gap * (k - 1);
        let x = margin + (innerW - rowW) / 2;
        r.idx.forEach((i) => {
          const w = aspects[i] * h;
          cells.push({ i, x, y, w, h });
          x += w + gap;
        });
        y += h + gap;
      });
      height = y - gap + margin;
    } else {
      const rowCount = Math.ceil(n / cols);
      const cw = (innerW - gap * (cols - 1)) / cols;
      let ch;
      if (o.aspect > 0) {
        height = W / o.aspect;
        ch = Math.max(4, (height - 2 * margin - gap * (rowCount - 1)) / rowCount);
      } else {
        ch = cw / mean;
        height = 2 * margin + rowCount * ch + gap * (rowCount - 1);
      }
      for (let r = 0; r < rowCount; r++) {
        const inRow = Math.min(cols, n - r * cols);
        const rowW = inRow * cw + (inRow - 1) * gap;
        const x0 = margin + (innerW - rowW) / 2; // a short last row is centred
        for (let c = 0; c < inRow; c++) {
          cells.push({ i: r * cols + c, x: x0 + c * (cw + gap), y: margin + r * (ch + gap), w: cw, h: ch });
        }
      }
    }
    return { width: Math.round(W), height: Math.round(height), cells };
  }


  /* ==========================================================
     Contact sheet layout (one page). Sizes are in points.
     ========================================================== */

  function contactSheetLayout(o) {
    const header = o.title ? 34 : 0;
    const footer = o.pageNumbers ? 22 : 0;
    const x0 = o.margin;
    const y0 = o.margin + header;
    const areaW = o.pageW - 2 * o.margin;
    const areaH = o.pageH - 2 * o.margin - header - footer;
    const cellW = (areaW - o.gap * (o.cols - 1)) / o.cols;
    const cellH = (areaH - o.gap * (o.rows - 1)) / o.rows;
    const captionH = o.captions ? Math.min(16, cellH * 0.3) : 0;
    const boxH = Math.max(4, cellH - captionH - (captionH ? 3 : 0));

    const cells = [];
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        const x = x0 + c * (cellW + o.gap);
        const y = y0 + r * (cellH + o.gap);
        cells.push({ x, y, w: cellW, h: boxH, captionY: y + boxH + 3, captionH });
      }
    }
    return { cells, perPage: o.cols * o.rows, titleY: o.margin, footerY: o.pageH - o.margin - footer };
  }


  /* ==========================================================
     Sprite sheet packing
     sizes: [{ w, h }]   o: { mode: 'packed' | 'grid', pad, maxWidth,
                              pow2, cols }
     ========================================================== */

  function nextPow2(value) {
    let p = 1;
    while (p < value) p *= 2;
    return p;
  }

  function packSprites(sizes, o) {
    const pad = o.pad || 0;
    const n = sizes.length;

    if (o.mode === 'grid') {
      const cols = clamp(Math.round(o.cols) || Math.ceil(Math.sqrt(n)), 1, n);
      const cellW = Math.max(...sizes.map((s) => s.w));
      const cellH = Math.max(...sizes.map((s) => s.h));
      const rows = Math.ceil(n / cols);
      let width = cols * cellW + (cols - 1) * pad;
      let height = rows * cellH + (rows - 1) * pad;
      const positions = sizes.map((s, i) => ({
        // Each sprite sits in the middle of its cell
        x: (i % cols) * (cellW + pad) + Math.floor((cellW - s.w) / 2),
        y: Math.floor(i / cols) * (cellH + pad) + Math.floor((cellH - s.h) / 2)
      }));
      if (o.pow2) { width = nextPow2(width); height = nextPow2(height); }
      return { width, height, positions };
    }

    // Packed: fill rows from the tallest sprite down, and try several
    // sheet widths to find the smallest sheet
    const widest = Math.max(...sizes.map((s) => s.w));
    if (widest > o.maxWidth) {
      throw new Error(`One image is ${widest}px wide, which does not fit a ${o.maxWidth}px sheet. Choose a wider sheet.`);
    }
    const order = sizes.map((_, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w);
    const area = sizes.reduce((sum, s) => sum + (s.w + pad) * (s.h + pad), 0);

    const candidates = new Set();
    if (o.pow2) {
      for (let w = nextPow2(widest); w <= o.maxWidth; w *= 2) candidates.add(w);
    } else {
      const start = Math.min(o.maxWidth, Math.max(widest, Math.ceil(Math.sqrt(area))));
      for (let k = 0; k < 40; k++) {
        const w = Math.round(start * (1 + k * 0.05));
        if (w > o.maxWidth) break;
        candidates.add(w);
      }
      candidates.add(o.maxWidth);
    }

    let best = null;
    candidates.forEach((limit) => {
      const positions = new Array(n);
      let x = 0, y = 0, rowH = 0, usedW = 0;
      order.forEach((i) => {
        const w = sizes[i].w + pad;
        const h = sizes[i].h + pad;
        if (x > 0 && x + w > limit + pad) { y += rowH; x = 0; rowH = 0; }
        positions[i] = { x, y };
        x += w;
        rowH = Math.max(rowH, h);
        usedW = Math.max(usedW, x);
      });
      let width = usedW - pad;
      let height = y + rowH - pad;
      if (o.pow2) { width = nextPow2(width); height = nextPow2(height); }
      const score = width * height;
      if (!best || score < best.score || (score === best.score && Math.max(width, height) < Math.max(best.width, best.height))) {
        best = { width, height, positions, score };
      }
    });
    return best;
  }

  // Class names that are safe in CSS and never repeat
  function spriteNames(filenames) {
    const seen = new Map();
    return filenames.map((file) => {
      const base = slug(file) || 'image';
      const count = (seen.get(base) || 0) + 1;
      seen.set(base, count);
      return count === 1 ? base : `${base}-${count}`;
    });
  }


  Object.assign(LBCore, {
    clamp, num, slug, naturalCompare,
    PdfWriter, PdfDocument,
    parseJpeg, canEmbedJpeg, canDeflate, deflate, filterRows, encodeRaster,
    planPages, pageContent, PAGE_SIZES,
    parsePageRange, crc32, makeZip,
    collageLayout, contactSheetLayout, packSprites, spriteNames, nextPow2
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = LBCore;
  else root.LBCore = LBCore;
})(typeof window !== 'undefined' ? window : globalThis);
