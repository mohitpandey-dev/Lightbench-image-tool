'use strict';

/* ==========================================================
   Lightbench: Text to Handwriting.

   Types your text onto a page in a handwriting font, entirely in
   the browser. Supports ruled, grid and plain paper, Hindi and
   English, simple LaTeX maths between $ signs, a "photo on a
   desk" look, several pages, and PNG / PDF downloads.
   ========================================================== */

(function () {
  const root = document.getElementById('tool-handwriting');
  if (!root) return;

  const $ = (selector, scope = root) => scope.querySelector(selector);
  const $$ = (selector, scope = root) => Array.from(scope.querySelectorAll(selector));

  /* ---------- Constants ---------- */

  const PW = 1240;               // page width in pixels (A4 at about 150 dpi)
  const PH = 1754;               // page height in pixels
  const DESK = 80;               // desk border around the page in "on a desk" mode

  const FONTS = {
    cursive:   { family: 'Homemade Apple', scale: 0.74, weight: 400, gap: 0.85 },
    ballpoint: { family: 'Caveat',         scale: 1.22, weight: 500, gap: 1.0 },
    hindi:     { family: 'Kalam',          scale: 0.95, weight: 400, gap: 1.0 },
    print:     { family: 'Indie Flower',   scale: 0.95, weight: 400, gap: 1.0 }
  };
  const FALLBACK = '"Kalam", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

  // Paper designs. `rules` draws horizontal lines, `grid` adds vertical ones.
  const PAPERS = {
    register: { bg: '#fcfbf6', rules: '#8fb1da', grid: false, marginX: 170, marginColor: '#d9534f', double: false, header: true,  left: 206, topRule: '#d9534f' },
    ruled:    { bg: '#fffefb', rules: '#9fbfe4', grid: false, marginX: 170, marginColor: '#e58a9a', double: false, header: true,  left: 206, topRule: null },
    legal:    { bg: '#fbf1a6', rules: '#7ea3cc', grid: false, marginX: 168, marginColor: '#d9534f', double: true,  header: true,  left: 206, topRule: '#d9534f' },
    grid:     { bg: '#fffffd', rules: '#b8d0e8', grid: true,  marginX: 0,   marginColor: null,      double: false, header: false, left: 110, topRule: null },
    plain:    { bg: '#fffffe', rules: null,      grid: false, marginX: 0,   marginColor: null,      double: false, header: false, left: 110, topRule: null }
  };

  const SYMBOLS = {
    pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ',
    mu: 'μ', sigma: 'σ', phi: 'φ', omega: 'ω', Delta: 'Δ', Omega: 'Ω', Sigma: 'Σ', Pi: 'Π', Theta: 'Θ',
    times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
    approx: '≈', infty: '∞', rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', circ: '°', degree: '°',
    sum: '∑', int: '∫', angle: '∠', therefore: '∴', because: '∵', ldots: '…', dots: '…', perp: '⊥',
    parallel: '∥', propto: '∝', partial: '∂', nabla: '∇', in: '∈', subset: '⊂', cup: '∪', cap: '∩'
  };
  const SPACES = { ',': ' ', ';': '  ', ':': ' ', ' ': ' ', quad: '    ', qquad: '        ', '!': '' };
  const SPACED_OPS = '=+<>×÷±≤≥≠≈→←⇒∈⊂';

  /* ---------- Elements and state ---------- */

  const els = {
    input: $('#tth-input'),
    size: $('#tth-size'),
    paper: $('#tth-paper'),
    look: $('#tth-look'),
    messy: $('#tth-messy'),
    wordGap: $('#tth-wordgap'),
    slant: $('#tth-slant'),
    lineGap: $('#tth-linegap'),
    vary: $('#tth-vary'),
    slips: $('#tth-slips'),
    canvas: $('#tth-canvas'),
    stage: $('#tth-stage'),
    label: $('#tth-page-label'),
    prev: $('#tth-prev'),
    next: $('#tth-next'),
    full: $('#tth-full'),
    msg: $('#tth-msg'),
    dl: $('#tth-dl'),
    dlAll: $('#tth-dl-all')
  };

  const state = { pages: [], current: 0, settings: null, run: 0, timer: 0 };
  const measureCtx = document.createElement('canvas').getContext('2d');

  /* ---------- Small helpers ---------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function say(text, isError) {
    els.msg.textContent = text || '';
    els.msg.classList.toggle('is-error', !!isError);
  }

  function chosen(name) {
    const picked = $(`input[name="${name}"]:checked`);
    return picked ? picked.value : '';
  }

  function readSettings() {
    const fontKey = $('.hw-opt[aria-checked="true"]')?.dataset.font || 'cursive';
    const font = FONTS[fontKey];
    const size = Number(els.size.value);
    return {
      fontKey,
      font,
      ink: chosen('tth-ink') || '#23419f',
      size,
      fontPx: Math.round(size * font.scale * 10) / 10,
      lineH: Math.round(size * 1.55 * (Number(els.lineGap.value) / 100)),
      paper: PAPERS[els.paper.value] || PAPERS.register,
      paperKey: els.paper.value,
      look: els.look.value,
      messy: Number(els.messy.value) / 100,
      wordGap: Number(els.wordGap.value) / 100,
      slant: Math.tan((Number(els.slant.value) * Math.PI) / 180),
      vary: els.vary.checked,
      slips: els.slips.checked,
      text: els.input.value
    };
  }

  const fontString = (px, s) => `${s.font.weight} ${px}px "${s.font.family}", ${FALLBACK}`;

  /* ==========================================================
     Maths: a small LaTeX subset drawn with the handwriting font.
     Handles \frac, \sqrt, ^ and _, Greek letters and common signs.
     ========================================================== */

  function makeMath(src, s) {
    const fs = (px) => fontString(px, s);

    function textBox(str, px) {
      measureCtx.font = fs(px);
      const w = measureCtx.measureText(str).width;
      return {
        w, asc: px * 0.8, desc: px * 0.25,
        draw(ctx, x, y) { ctx.font = fs(px); ctx.fillText(str, x, y); }
      };
    }

    function rowBox(items, px) {
      const w = items.reduce((sum, b) => sum + b.w, 0);
      return {
        w,
        asc: Math.max(px * 0.8, ...items.map((b) => b.asc)),
        desc: Math.max(px * 0.25, ...items.map((b) => b.desc)),
        draw(ctx, x, y) { let cx = x; items.forEach((b) => { b.draw(ctx, cx, y); cx += b.w; }); }
      };
    }

    function lineWidth(px) { return Math.max(1.6, px * 0.055); }

    function fracBox(n, d, px) {
      const w = Math.max(n.w, d.w) + px * 0.3;
      return {
        w, asc: px * 0.42 + n.asc, desc: px * 0.36 + d.desc,
        draw(ctx, x, y) {
          ctx.save();
          ctx.lineWidth = lineWidth(px);
          ctx.lineCap = 'round';
          ctx.strokeStyle = ctx.fillStyle;
          ctx.beginPath();
          ctx.moveTo(x + px * 0.06, y - px * 0.3);
          ctx.lineTo(x + w - px * 0.06, y - px * 0.3 + px * 0.01);
          ctx.stroke();
          ctx.restore();
          n.draw(ctx, x + (w - n.w) / 2, y - px * 0.42);
          d.draw(ctx, x + (w - d.w) / 2, y + px * 0.36);
        }
      };
    }

    function sqrtBox(inner, px) {
      const rw = px * 0.55;
      const w = rw + inner.w + px * 0.12;
      const top = Math.max(px * 0.95, inner.asc + px * 0.12);
      return {
        w, asc: top, desc: Math.max(inner.desc, px * 0.1),
        draw(ctx, x, y) {
          ctx.save();
          ctx.lineWidth = lineWidth(px);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = ctx.fillStyle;
          ctx.beginPath();
          ctx.moveTo(x + px * 0.02, y - px * 0.32);
          ctx.lineTo(x + px * 0.14, y - px * 0.38);
          ctx.lineTo(x + px * 0.29, y + px * 0.06);
          ctx.lineTo(x + rw - px * 0.03, y - top);
          ctx.lineTo(x + w - px * 0.02, y - top);
          ctx.stroke();
          ctx.restore();
          inner.draw(ctx, x + rw + px * 0.04, y);
        }
      };
    }

    function scriptBox(inner, sup, px) {
      const shift = sup ? -px * 0.42 : px * 0.2;
      return {
        w: inner.w + px * 0.04,
        asc: sup ? inner.asc - shift : px * 0.8,
        desc: sup ? px * 0.25 : inner.desc + shift,
        draw(ctx, x, y) { inner.draw(ctx, x, y + shift); }
      };
    }

    // Reads the next argument: {group}, a \command, or a single character
    function takeArg(str, at) {
      let i = at;
      while (i < str.length && /\s/.test(str[i])) i++;
      if (str[i] === '{') {
        let depth = 0;
        for (let j = i; j < str.length; j++) {
          if (str[j] === '{') depth++;
          else if (str[j] === '}' && --depth === 0) return { text: str.slice(i + 1, j), end: j + 1 };
        }
        return { text: str.slice(i + 1), end: str.length };
      }
      if (str[i] === '\\') {
        const m = /^\\([a-zA-Z]+|.)/.exec(str.slice(i));
        return { text: m[0], end: i + m[0].length };
      }
      return { text: str[i] || '', end: i + 1 };
    }

    function seq(str, px, depth) {
      if (depth > 6) return textBox(str, px);
      const items = [];
      let buf = '';
      let i = 0;
      const flush = () => { if (buf) { items.push(textBox(buf, px)); buf = ''; } };
      const addOp = (op) => {
        if (op === '-' && !buf && !items.length) buf += op;
        else buf += ' ' + op + ' ';
      };

      while (i < str.length) {
        const c = str[i];
        if (c === '\\') {
          const m = /^\\([a-zA-Z]+|.)/.exec(str.slice(i));
          const cmd = m[1];
          i += m[0].length;
          if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
            const a = takeArg(str, i); const b = takeArg(str, a.end);
            i = b.end; flush();
            items.push(fracBox(seq(a.text, px * 0.8, depth + 1), seq(b.text, px * 0.8, depth + 1), px));
          } else if (cmd === 'sqrt') {
            while (str[i] === ' ') i++;
            if (str[i] === '[') { const close = str.indexOf(']', i); i = close < 0 ? str.length : close + 1; }
            const a = takeArg(str, i);
            i = a.end; flush();
            items.push(sqrtBox(seq(a.text, px, depth + 1), px));
          } else if (cmd in SYMBOLS) {
            const sym = SYMBOLS[cmd];
            if (SPACED_OPS.includes(sym)) addOp(sym); else buf += sym;
          } else if (cmd in SPACES) {
            buf += SPACES[cmd];
          } else if (cmd === 'left' || cmd === 'right') {
            // brackets after \left and \right are kept, the command itself is dropped
          } else if (cmd === 'text' || cmd === 'mathrm' || cmd === 'mathbf') {
            const a = takeArg(str, i); i = a.end; buf += a.text;
          } else if (/^[{}%$&#_^\\]$/.test(cmd)) {
            buf += cmd === '\\' ? ' ' : cmd;
          } else {
            buf += cmd;
          }
        } else if (c === '^' || c === '_') {
          const a = takeArg(str, i + 1);
          i = a.end; flush();
          items.push(scriptBox(seq(a.text, px * 0.68, depth + 1), c === '^', px));
        } else if (c === '{') {
          const a = takeArg(str, i);
          i = a.end; flush();
          items.push(seq(a.text, px, depth + 1));
        } else if (/\s/.test(c)) {
          i++;
        } else if ('=+<>'.includes(c) || (c === '-' && (buf || items.length))) {
          addOp(c); i++;
        } else {
          buf += c; i++;
        }
      }
      flush();
      return items.length === 1 ? items[0] : rowBox(items, px);
    }

    return seq(src, s.fontPx, 0);
  }

  /* ==========================================================
     Layout: words -> lines -> pages
     ========================================================== */

  const graphemes = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? (text) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (p) => p.segment)
    : (text) => Array.from(text);

  // A made-up wrong spelling, used for the optional crossed-out slips
  function slipOf(word, rand) {
    const letters = word.split('');
    const at = 1 + Math.floor(rand() * (letters.length - 2));
    [letters[at], letters[at + 1]] = [letters[at + 1], letters[at]];
    const wrong = letters.join('');
    return wrong === word ? word.slice(0, -1) : wrong;
  }

  function tokenize(text, s, maxWidth) {
    measureCtx.font = fontString(s.fontPx, s);
    const spaceW = measureCtx.measureText(' ').width * s.font.gap * s.wordGap;
    const rand = mulberry32(4242);
    const tokens = [];

    const pushWord = (word) => {
      measureCtx.font = fontString(s.fontPx, s);
      const w = measureCtx.measureText(word).width;
      if (w <= maxWidth) {
        const token = { kind: 'word', text: word, w, slip: null, slipW: 0 };
        if (s.slips && /^[A-Za-z]{5,}$/.test(word) && rand() < 0.045) {
          token.slip = slipOf(word, rand);
          token.slipW = measureCtx.measureText(token.slip).width + spaceW * 0.35;
          token.w += token.slipW;
        }
        tokens.push(token);
        return;
      }
      // A very long word is cut so that it fits on a line
      let chunk = '';
      graphemes(word).forEach((g) => {
        if (chunk && measureCtx.measureText(chunk + g).width > maxWidth) {
          tokens.push({ kind: 'word', text: chunk, w: measureCtx.measureText(chunk).width, slip: null, slipW: 0 });
          chunk = '';
        }
        chunk += g;
      });
      if (chunk) tokens.push({ kind: 'word', text: chunk, w: measureCtx.measureText(chunk).width, slip: null, slipW: 0 });
    };

    let endedWithSpace = true;   // false when the previous piece touches the next one, e.g. "($x$)"
    text.split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/).forEach((part) => {
      if (!part) return;
      const display = /^\$\$[^$]+\$\$$/.test(part);
      if (display || /^\$[^$\n]+\$$/.test(part)) {
        const src = part.slice(display ? 2 : 1, display ? -2 : -1);
        const box = makeMath(src, s);
        tokens.push({ kind: 'math', box, w: box.w, glue: !endedWithSpace });
        endedWithSpace = false;
      } else {
        const before = tokens.length;
        part.split(/\s+/).forEach((word) => { if (word) pushWord(word); });
        if (tokens.length > before && !endedWithSpace && /^\S/.test(part)) tokens[before].glue = true;
        endedWithSpace = /\s$/.test(part);
      }
    });
    return { tokens, spaceW };
  }

  function layout(s) {
    const geo = geometry(s);
    const width = geo.right - geo.left;
    const lines = [];

    s.text.replace(/\r/g, '').split('\n').forEach((paragraph) => {
      if (!paragraph.trim()) { lines.push({ tokens: [], width: 0 }); return; }
      const { tokens, spaceW } = tokenize(paragraph, s, width);
      let current = { tokens: [], width: 0, spaceW };
      tokens.forEach((token) => {
        const gap = current.tokens.length && !token.glue ? spaceW : 0;
        if (current.tokens.length && !token.glue && current.width + gap + token.w > width) {
          lines.push(current);
          current = { tokens: [], width: 0, spaceW };
        }
        const add = current.tokens.length && !token.glue ? spaceW : 0;
        current.tokens.push(token);
        current.width += add + token.w;
      });
      if (current.tokens.length) lines.push(current);
    });

    const pages = [];
    for (let i = 0; i < lines.length; i += geo.capacity) pages.push(lines.slice(i, i + geo.capacity));
    return pages.length ? pages : [[]];
  }

  // Where the text sits on the page
  function geometry(s) {
    const p = s.paper;
    const lh = s.lineH;
    const y0 = p.header ? Math.round(lh * 1.9) : 110;     // first ruled line
    const bottom = 70;
    const capacity = Math.max(1, Math.floor((PH - bottom - y0) / lh) - 1);
    return { left: p.left, right: PW - 90, y0, lh, capacity };
  }

  /* ==========================================================
     Drawing
     ========================================================== */

  function drawPaper(ctx, s, geo) {
    const p = s.paper;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, PW, PH);

    ctx.lineWidth = 2;
    if (p.rules) {
      ctx.strokeStyle = p.rules;
      ctx.beginPath();
      for (let y = geo.y0; y < PH - 40; y += geo.lh) { ctx.moveTo(0, y + 0.5); ctx.lineTo(PW, y + 0.5); }
      if (p.grid) {
        for (let x = geo.lh * 0.5; x < PW; x += geo.lh) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, PH); }
        for (let y = geo.y0 - geo.lh; y > 0; y -= geo.lh) { ctx.moveTo(0, y + 0.5); ctx.lineTo(PW, y + 0.5); }
      }
      ctx.stroke();
    }
    if (p.topRule) {
      ctx.strokeStyle = p.topRule;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, geo.y0 + 0.5);
      ctx.lineTo(PW, geo.y0 + 0.5);
      ctx.stroke();
    }
    if (p.marginColor) {
      ctx.strokeStyle = p.marginColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.marginX + 0.5, 0);
      ctx.lineTo(p.marginX + 0.5, PH);
      if (p.double) { ctx.moveTo(p.marginX + 9.5, 0); ctx.lineTo(p.marginX + 9.5, PH); }
      ctx.stroke();
    }
  }

  function drawText(ctx, s, geo, lines, pageIndex) {
    ctx.textBaseline = 'alphabetic';
    const amp = s.messy;

    lines.forEach((line, li) => {
      if (!line.tokens.length) return;
      const rand = mulberry32(9000 + pageIndex * 977 + li * 131);
      const baseY = geo.y0 + (li + 1) * geo.lh - geo.lh * 0.15;
      const slope = (rand() - 0.5) * 0.006 * amp;
      let x = geo.left + (rand() - 0.5) * 8 * amp;

      line.tokens.forEach((token, ti) => {
        const wobbleY = (rand() - 0.5) * 5 * amp;
        const tilt = (rand() - 0.5) * 0.045 * amp;
        const alpha = s.vary ? 0.8 + rand() * 0.2 : 1;
        const y = baseY + (x - geo.left) * slope + wobbleY;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.ink;
        ctx.strokeStyle = s.ink;
        ctx.translate(x, y);
        ctx.rotate(tilt);
        if (s.slant) ctx.transform(1, 0, -s.slant, 1, 0, 0);

        if (token.kind === 'math') {
          token.box.draw(ctx, 0, 0);
        } else {
          ctx.font = fontString(s.fontPx, s);
          let cx = 0;
          if (token.slip) {
            ctx.fillText(token.slip, 0, 0);
            const sw = ctx.measureText(token.slip).width;
            ctx.lineWidth = Math.max(1.8, s.fontPx * 0.06);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-3, -s.fontPx * 0.26);
            ctx.lineTo(sw + 4, -s.fontPx * 0.34);
            ctx.stroke();
            cx = token.slipW;
          }
          ctx.fillText(token.text, cx, 0);
        }
        ctx.restore();

        const next = line.tokens[ti + 1];
        x += token.w + (next && !next.glue ? line.spaceW * (0.92 + rand() * 0.16) : 0);
      });
    });
  }

  let grain = null;
  function grainPattern(ctx) {
    if (!grain) {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const g = c.getContext('2d');
      const data = g.createImageData(160, 160);
      const rand = mulberry32(31337);
      for (let i = 0; i < data.data.length; i += 4) {
        const v = rand() < 0.5 ? 0 : 255;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
        data.data[i + 3] = Math.floor(rand() * 26);
      }
      g.putImageData(data, 0, 0);
      grain = ctx.createPattern(c, 'repeat');
    }
    return grain;
  }

  function shadePage(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, PW, PH);
    ctx.clip();
    // light falling from the top left
    const light = ctx.createLinearGradient(0, 0, PW, PH);
    light.addColorStop(0, 'rgba(255,255,255,0.10)');
    light.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, PW, PH);
    // the curve of the page near the spine
    const spine = ctx.createLinearGradient(0, 0, 150, 0);
    spine.addColorStop(0, 'rgba(0,0,0,0.22)');
    spine.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = spine;
    ctx.fillRect(0, 0, 150, PH);
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, PW, PH);
    ctx.restore();
  }

  function drawDesk(ctx, w, h) {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, '#6b4e36');
    base.addColorStop(1, '#3d2c1f');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const rand = mulberry32(555);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(${rand() < 0.5 ? '20,10,0' : '150,110,70'},${0.05 + rand() * 0.08})`;
      ctx.lineWidth = 1 + rand() * 2;
      const y = rand() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + (rand() - 0.5) * 14, w * 0.7, y + (rand() - 0.5) * 14, w, y + (rand() - 0.5) * 10);
      ctx.stroke();
    }
  }

  function outputSize(s) {
    return s.look === 'desk' ? [PW + DESK * 2, PH + DESK * 2] : [PW, PH];
  }

  function renderPage(index, target) {
    const s = state.settings;
    const geo = geometry(s);
    const [w, h] = outputSize(s);

    const page = document.createElement('canvas');
    page.width = PW; page.height = PH;
    const pctx = page.getContext('2d');
    drawPaper(pctx, s, geo);
    drawText(pctx, s, geo, state.pages[index] || [], index);

    target.width = w;
    target.height = h;
    const ctx = target.getContext('2d');

    if (s.look === 'desk') {
      drawDesk(ctx, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.006);
      ctx.translate(-PW / 2, -PH / 2);
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 40;
      ctx.shadowOffsetX = 8;
      ctx.shadowOffsetY = 14;
      ctx.drawImage(page, 0, 0);
      ctx.shadowColor = 'transparent';
      shadePage(ctx, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(page, 0, 0);
      if (s.look === 'scan') shadePage(ctx, 0, 0);
    }
  }

  /* ==========================================================
     Updating the preview
     ========================================================== */

  async function loadFonts(s) {
    const needs = [fontString(s.fontPx, s)];
    if (/[\u0900-\u097F]/.test(s.text)) needs.push('400 40px "Kalam"');
    const sample = s.text.slice(0, 600) + 'abcdefghijklmnopqrstuvwxyz';
    try {
      await Promise.all(needs.map((f) => document.fonts.load(f, sample)));
    } catch (e) { /* the fallback font is used instead */ }
  }

  async function update() {
    const run = ++state.run;
    const s = readSettings();
    await loadFonts(s);
    if (run !== state.run) return;

    state.settings = s;
    state.pages = layout(s);
    state.current = Math.min(state.current, state.pages.length - 1);
    show();
    const ok = !document.fonts || document.fonts.check(fontString(s.fontPx, s), 'abc');
    say(ok ? '' : 'The handwriting font could not be loaded, so a standard font is shown. Check your connection and try again.', !ok);
  }

  function show() {
    renderPage(state.current, els.canvas);
    const n = state.pages.length;
    els.label.textContent = `Page ${state.current + 1} of ${n}`;
    els.prev.disabled = state.current === 0;
    els.next.disabled = state.current >= n - 1;
    els.dlAll.textContent = n > 1 ? `Download all ${n} pages (PDF)` : 'Download as PDF';
  }

  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(update, 180);
  }

  /* ==========================================================
     Downloads
     ========================================================== */

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be created.'))), type, quality);
  });

  async function downloadPng() {
    try {
      const blob = await toBlob(els.canvas, 'image/png');
      saveBlob(blob, `handwriting-page-${state.current + 1}.png`);
    } catch (e) { say(e.message, true); }
  }

  async function downloadPdf() {
    if (!window.LBCore || !LBCore.PdfDocument) { say('The PDF writer did not load. Reload the page and try again.', true); return; }
    els.dlAll.disabled = true;
    say('Building your PDF...');
    try {
      const doc = new LBCore.PdfDocument();
      const work = document.createElement('canvas');
      for (let i = 0; i < state.pages.length; i++) {
        renderPage(i, work);
        const blob = await toBlob(work, 'image/jpeg', 0.92);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const id = doc.addJpeg(bytes, work.width, work.height, 3);
        const pw = 595.28;
        const ph = pw * work.height / work.width;
        doc.addPage(pw, ph, `q\n${LBCore.num(pw)} 0 0 ${LBCore.num(ph)} 0 0 cm\n/Im0 Do\nQ\n`, { Im0: id });
      }
      saveBlob(doc.finish('Handwritten pages'), 'handwriting.pdf');
      say('');
    } catch (e) {
      say('The PDF could not be built: ' + e.message, true);
    } finally {
      els.dlAll.disabled = false;
    }
  }

  /* ==========================================================
     Wiring
     ========================================================== */

  els.input.addEventListener('input', schedule);
  els.size.addEventListener('input', schedule);
  [els.paper, els.look, els.messy, els.wordGap, els.slant, els.lineGap, els.vary, els.slips].forEach((el) => {
    el.addEventListener('input', schedule);
    el.addEventListener('change', schedule);
  });
  $$('input[name="tth-ink"]').forEach((el) => el.addEventListener('change', schedule));

  $$('.hw-opt').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.hw-opt').forEach((b) => b.setAttribute('aria-checked', String(b === button)));
      schedule();
    });
  });

  els.prev.addEventListener('click', () => { if (state.current > 0) { state.current--; show(); } });
  els.next.addEventListener('click', () => { if (state.current < state.pages.length - 1) { state.current++; show(); } });

  els.full.addEventListener('click', () => {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (els.stage.requestFullscreen) els.stage.requestFullscreen().catch(() => els.stage.classList.toggle('is-zoom'));
    else els.stage.classList.toggle('is-zoom');
  });

  els.dl.addEventListener('click', downloadPng);
  els.dlAll.addEventListener('click', downloadPdf);

  update();
})();
