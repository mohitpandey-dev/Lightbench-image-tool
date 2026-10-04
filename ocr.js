'use strict';

/* ==========================================================
   Lightbench: Image to Text, Screenshot to Text, Handwriting
   to Text. All three read text out of a picture using
   Tesseract.js, which is loaded from a CDN (tesseract.min.js,
   included on the page before this file). Recognition needs
   an internet connection the first time, to fetch the engine
   and the language data; after that the browser caches them.

   The three pages differ only in wording and in the starting
   layout mode (set with data-ocr-psm on the tool section), so
   one engine covers all of them.
   ========================================================== */

(function () {
  const section = $('[data-ocr-tool]');
  if (!section) return;

  const el = (id) => document.getElementById(id);
  const preview = el('ocr-preview');
  const langSelect = el('ocr-lang');
  const modeSelect = el('ocr-mode');
  const goButton = el('ocr-go');
  const resultPanel = el('ocr-result');
  const output = el('ocr-output');
  const statsEl = el('ocr-stats');
  const copyButton = el('ocr-copy');
  const downloadLink = el('ocr-download');

  const defaultPsm = section.dataset.ocrPsm || '3';
  if (modeSelect) modeSelect.value = defaultPsm;

  const STATUS = {
    'loading tesseract core': 'Loading the recognition engine',
    'initializing tesseract': 'Starting up',
    'loading language traineddata': 'Downloading language data',
    'initializing api': 'Getting ready',
    'recognizing text': 'Reading the image'
  };

  let worker = null;
  let workerLang = null;
  let fileRef = null;
  const urls = [];

  function freeUrls() {
    while (urls.length) URL.revokeObjectURL(urls.pop());
  }

  const tool = createTool(section.id.replace('tool-', ''), ({ img, file }) => {
    fileRef = file;
    preview.src = img.src;
    resultPanel.hidden = true;
    output.value = '';
  });

  // The engine comes from a CDN. If the first one is blocked, try a second one.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error('blocked'));
      document.head.append(tag);
    });
  }

  async function ensureEngine() {
    if (typeof Tesseract !== 'undefined') return;
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    } catch (error) { /* handled below */ }
    if (typeof Tesseract === 'undefined') {
      throw new Error('The text recognition engine could not load. It needs an internet connection the first time. Check your connection, turn off any ad blocker for this page, then reload and try again.');
    }
  }

  // Tesseract sometimes throws plain text or objects, not Error objects
  function explain(error) {
    const raw = (error && (error.message || error.toString())) || '';
    const text = String(raw === '[object Object]' ? '' : raw);
    if (!navigator.onLine) return 'You seem to be offline. The first time, the engine and language data are downloaded, so connect to the internet and try again.';
    if (/network|fetch|load|download|traineddata|importScripts/i.test(text)) {
      return 'The language data could not be downloaded. Check your internet connection and try again. ' + text;
    }
    return 'Text recognition failed. ' + (text || 'Try a smaller or clearer image, then reload the page.');
  }

  async function getWorker(lang) {
    await ensureEngine();
    if (worker && workerLang === lang) return worker;
    if (worker) {
      await worker.terminate();
      worker = null;
    }
    worker = await Tesseract.createWorker(lang, 1, {
      logger: (m) => {
        if (!m.status) return;
        const pct = typeof m.progress === 'number' ? Math.round(m.progress * 100) : null;
        say(section, (STATUS[m.status] || m.status) + (pct !== null ? `: ${pct}%` : '...'));
      }
    });
    workerLang = lang;
    return worker;
  }

  function updateStats() {
    const text = output.value;
    const words = (text.match(/\S+/g) || []).length;
    statsEl.textContent = text
      ? `${words} word${words === 1 ? '' : 's'}, ${text.length} character${text.length === 1 ? '' : 's'}`
      : 'No text found. Try a clearer or higher-resolution photo.';
  }

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      if (!fileRef) return;
      say(section, 'Starting...');
      const lang = langSelect.value;
      const psm = modeSelect ? modeSelect.value : defaultPsm;
      let data;
      try {
        const engine = await getWorker(lang);
        await engine.setParameters({ tessedit_pageseg_mode: psm });
        ({ data } = await engine.recognize(fileRef));
      } catch (error) {
        if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
        throw new Error(error && error.message && /could not load/.test(error.message) ? error.message : explain(error));
      }
      output.value = (data.text || '').trim();
      resultPanel.hidden = false;
      updateStats();
      const weak = !output.value || (typeof data.confidence === 'number' && data.confidence < 55);
      say(section, !output.value
        ? 'No text was found. This reader works best on printed or typed text. Handwriting and signatures are often not read.'
        : weak
          ? 'Done, but the reader is not confident. Handwriting and stylised writing are hard for it, so check the text carefully.'
          : 'Done. Recognition is not always perfect, so check the text below.');
    })
  );

  output.addEventListener('input', updateStats);

  copyButton.addEventListener('click', async () => {
    if (!output.value) return;
    try {
      await navigator.clipboard.writeText(output.value);
    } catch (error) {
      output.select();
      document.execCommand('copy');
    }
    say(section, 'Copied to the clipboard.');
  });

  if (downloadLink) {
    downloadLink.addEventListener('click', (event) => {
      event.preventDefault();
      if (!output.value) return;
      freeUrls();
      const blob = new Blob([output.value], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName(fileRef ? fileRef.name : 'text')}.txt`;
      document.body.append(a);
      a.click();
      a.remove();
    });
  }

  window.addEventListener('beforeunload', () => {
    if (worker) worker.terminate();
  });

  void tool;
})();
