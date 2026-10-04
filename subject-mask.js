'use strict';

/* ==========================================================
   Lightbench: Subject detection (shared).

   Finds the person in a photo with a small AI model that runs in
   your browser (MODNet, Apache 2.0, through transformers.js).
   The photo is never uploaded. Only the model files are downloaded
   the first time (about 25 MB) and the browser keeps them after that.

   window.SubjectMask.detectCanvas(source, onStatus)
       -> Promise<HTMLCanvasElement>  same shape as the source, the
          alpha channel holds the cut-out (255 = person, 0 = background)

   window.SubjectMask.detect(source, w, h, onStatus)
       -> Promise<Float32Array>  w * h values from 0 to 1

   `source` can be a canvas or an image. Works best on people.
   ========================================================== */

(function initSubjectMask() {
  const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
  const MODEL = 'Xenova/modnet';
  const MAX_SIDE = 1024;   // the model works at about 512 px, so more is wasted

  let loading = null;      // Promise of { lib, model, processor }

  function load(onStatus) {
    if (loading) return loading;
    loading = (async () => {
      const say = (t) => { if (onStatus) onStatus(t); };
      say('Loading the detection model\u2026');
      const lib = await import(LIB);
      lib.env.allowLocalModels = false;
      let lastPct = -1;
      const progress = (p) => {
        if (p && p.status === 'progress' && typeof p.progress === 'number') {
          const pct = Math.round(p.progress);
          if (pct !== lastPct) { lastPct = pct; say(`Downloading the model: ${pct}% (first time only)`); }
        }
      };
      const [model, processor] = await Promise.all([
        lib.AutoModel.from_pretrained(MODEL, { dtype: 'fp32', progress_callback: progress }),
        lib.AutoProcessor.from_pretrained(MODEL)
      ]);
      return { lib, model, processor };
    })();
    // If loading fails (offline, blocked), let the next click try again
    loading.catch(() => { loading = null; });
    return loading;
  }

  function toBlobCanvas(source) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';              // see-through pixels count as white
    x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  const canvasBlob = (c) => new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the picture.'))), 'image/png'));

  async function detectCanvas(source, onStatus) {
    const { lib, model, processor } = await load(onStatus);
    if (onStatus) onStatus('Finding the person\u2026');

    const input = toBlobCanvas(source);
    const image = await lib.RawImage.fromBlob(await canvasBlob(input));
    const { pixel_values } = await processor(image);
    const { output } = await model({ input: pixel_values });

    const matte = await lib.RawImage.fromTensor(output[0].mul(255).to('uint8'))
      .resize(input.width, input.height);

    // One channel of 0-255 values -> the alpha channel of a canvas
    const ch = matte.channels || 1;
    const out = document.createElement('canvas');
    out.width = input.width;
    out.height = input.height;
    const octx = out.getContext('2d');
    const data = octx.createImageData(out.width, out.height);
    for (let p = 0, n = out.width * out.height; p < n; p++) {
      const i = p * 4;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = 0;
      data.data[i + 3] = matte.data[p * ch];
    }
    octx.putImageData(data, 0, 0);
    return out;
  }

  async function detect(source, w, h, onStatus) {
    const small = await detectCanvas(source, onStatus);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(small, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data;
    const a = new Float32Array(w * h);
    for (let p = 0; p < a.length; p++) {
      // A gentle S-curve: removes faint haze in the background and
      // firms up the inside of the person without hardening the edge
      const v = px[p * 4 + 3] / 255;
      const t = Math.min(1, Math.max(0, (v - 0.12) / 0.76));
      a[p] = t * t * (3 - 2 * t);
    }
    return a;
  }

  window.SubjectMask = { detectCanvas, detect };
})();
