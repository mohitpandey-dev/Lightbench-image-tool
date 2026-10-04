'use strict';

/* ==========================================================
   Lightbench: size and social media tools.

   1. Passport photo     2. ID photo          3. Profile picture
   4. Instagram          5. YouTube thumbnail 6. Facebook cover
   7. LinkedIn           8. X / Twitter       9. WhatsApp DP

   All nine share one "frame" engine. You drag and zoom the photo
   under a frame that has the exact shape of the finished image.
   What each tool offers (its sizes, guides and extra options) is
   listed in the TOOLS table below, so a new size is one new line.

   Needs script.js (shared helpers) and docs-core.js (ZIP and PDF
   writers). Every page has one tool, and it starts when its page
   is the current one.
   ========================================================== */

(function () {
  const section = $('[data-frame-tool]');
  if (!section) return;


  /* ==========================================================
     WHAT EACH TOOL OFFERS
     Sizes are in pixels (w, h) or millimetres (wmm, hmm).
     "guides" are drawings on the preview only. They are never
     part of the finished image. Positions are fractions (0 to 1)
     of the frame's width and height.
     ========================================================== */

  const CIRCLE = { type: 'circle', label: 'Shown as a circle' };
  const GRID_34 = { type: 'ratio', r: 3 / 4, label: 'Profile grid (3:4)' };
  const STORY = { type: 'bands', top: 0.14, bottom: 0.2, label: 'Keep text out of the shaded areas' };
  const LOGO_ZONE = { type: 'zone', x: 0, y: 0.37, w: 0.27, h: 0.63, label: 'Logo covers this (approx.)' };

  const TOOLS = {
    passport: {
      file: 'passport',
      photo: true,
      physical: true,
      sheet: true,
      format: 'image/jpeg',
      fit: 'fill',
      bg: '#ffffff',
      bgs: ['#ffffff', '#e6e8ea', '#c8dff5'],
      kb: [50, 100, 200, 300],
      defaultPreset: 'us',
      presets: [
        { id: 'us', label: 'USA', sub: '2 × 2 in', wmm: 50.8, hmm: 50.8, head: [0.49, 0.69],
          note: 'The head should be 1 to 1⅜ in (25 to 35 mm) from chin to top. Plain white or off-white background. For online forms the photo is usually 600 × 600 to 1200 × 1200 px.' },
        { id: 'uk', label: 'UK', sub: '35 × 45 mm', wmm: 35, hmm: 45, head: [0.64, 0.76],
          note: 'The head should be about 29 to 34 mm from chin to crown. Plain light background.' },
        { id: 'eu', label: 'EU, Schengen, Australia', sub: '35 × 45 mm', wmm: 35, hmm: 45, head: [0.71, 0.8],
          note: 'The head should be about 32 to 36 mm from chin to crown (70 to 80% of the height).' },
        { id: 'india', label: 'India', sub: '2 × 2 in', wmm: 50.8, hmm: 50.8, head: [0.5, 0.8],
          note: 'Indian offices describe the head size in more than one way, so the guide is wide. Some online forms want a small JPG, for example under 100 KB. Use the file size box below for that.' },
        { id: 'canada', label: 'Canada', sub: '50 × 70 mm', wmm: 50, hmm: 70, head: [0.44, 0.51],
          note: 'The head should be about 31 to 36 mm from chin to crown.' },
        { id: 'china', label: 'China', sub: '33 × 48 mm', wmm: 33, hmm: 48, head: [0.58, 0.69],
          note: 'The head should be about 28 to 33 mm from chin to crown.' },
        { id: 'custom', label: 'Custom size', custom: true, wmm: 35, hmm: 45, head: [0.55, 0.75],
          note: 'Type the size your form asks for.' }
      ]
    },

    id: {
      file: 'id-photo',
      photo: true,
      physical: true,
      sheet: true,
      format: 'image/jpeg',
      fit: 'fill',
      bg: '#ffffff',
      bgs: ['#ffffff', '#e6e8ea', '#c8dff5', '#d9483b'],
      kb: [50, 100, 200, 300],
      defaultPreset: 'std',
      presets: [
        { id: 'stamp', label: 'Stamp size', sub: '20 × 25 mm', wmm: 20, hmm: 25, head: [0.55, 0.72], suggest: true,
          note: 'Very small. Used on some cards and forms.' },
        { id: 'small', label: '1 inch', sub: '25 × 35 mm', wmm: 25, hmm: 35, head: [0.55, 0.72], suggest: true,
          note: 'A common size for ID cards, resumes and forms.' },
        { id: 'compact', label: 'Compact', sub: '30 × 40 mm', wmm: 30, hmm: 40, head: [0.55, 0.72], suggest: true,
          note: 'Used for student cards, work badges and some licences.' },
        { id: 'std', label: 'Standard', sub: '35 × 45 mm', wmm: 35, hmm: 45, head: [0.55, 0.72], suggest: true,
          note: 'The most common ID size in many countries.' },
        { id: 'two', label: '2 inch', sub: '35 × 49 mm', wmm: 35, hmm: 49, head: [0.55, 0.72], suggest: true,
          note: 'A slightly taller size used for certificates and applications.' },
        { id: 'large', label: 'Large', sub: '40 × 60 mm', wmm: 40, hmm: 60, head: [0.5, 0.68], suggest: true,
          note: 'A larger portrait size for badges and records.' },
        { id: 'square', label: 'Square', sub: '2 × 2 in', wmm: 50.8, hmm: 50.8, head: [0.5, 0.68], suggest: true,
          note: 'A square size used on many forms in the US.' },
        { id: 'custom', label: 'Custom size', custom: true, wmm: 35, hmm: 45, head: [0.55, 0.72], suggest: true,
          note: 'Type the size your form asks for.' }
      ]
    },

    profile: {
      file: 'profile-picture',
      photo: true,
      shapes: true,
      minis: true,
      format: 'image/png',
      fit: 'fill',
      bg: '#ffffff',
      bgs: ['blur', '#ffffff', '#14181b', 'clear'],
      defaultPreset: 's512',
      presets: [
        { id: 's256', label: 'Small', w: 256, h: 256, note: 'Good for comment avatars and forums.' },
        { id: 's400', label: 'Medium', w: 400, h: 400, note: 'Works for X, LinkedIn and many other sites.' },
        { id: 's512', label: 'Standard', w: 512, h: 512, note: 'A safe size for most apps and websites.' },
        { id: 's800', label: 'Large', w: 800, h: 800, note: 'Sharp on big screens. Works for Facebook and YouTube.' },
        { id: 's1080', label: 'Extra large', w: 1080, h: 1080, note: 'The most detail. Apps shrink it as needed.' },
        { id: 'custom', label: 'Custom size', custom: true, w: 512, h: 512, note: 'Type any size in pixels.' }
      ]
    },

    instagram: {
      file: 'instagram',
      minis: true,
      zip: true,
      format: 'image/jpeg',
      fit: 'fill',
      bg: 'blur',
      bgs: ['blur', '#ffffff', '#14181b'],
      defaultPreset: 'portrait',
      presets: [
        { id: 'square', label: 'Square post', w: 1080, h: 1080, guides: [GRID_34],
          note: 'Classic 1:1. The profile grid shows the middle 3:4 of the picture, so keep the subject centred.' },
        { id: 'portrait', label: 'Portrait post 4:5', w: 1080, h: 1350, guides: [GRID_34],
          note: 'Takes the most room in the feed. The profile grid trims the sides a little.' },
        { id: 'grid', label: 'Portrait post 3:4', w: 1080, h: 1440,
          note: 'Matches the 3:4 profile grid, so nothing is trimmed there.' },
        { id: 'landscape', label: 'Landscape post', w: 1080, h: 566,
          note: 'For wide shots. This is Instagram\'s 1.91:1 shape.' },
        { id: 'story', label: 'Story and Reel', w: 1080, h: 1920, guides: [STORY],
          note: 'Full screen 9:16. Instagram covers the top and bottom with the profile bar and the reply box.' },
        { id: 'profile', label: 'Profile photo', w: 320, h: 320, guides: [CIRCLE],
          note: 'Instagram shows it as a circle, so the corners are cut off.' },
        { id: 'custom', label: 'Custom size', custom: true, w: 1080, h: 1080, note: 'Type any size in pixels.' }
      ]
    },

    youtube: {
      file: 'youtube',
      text: true,
      minis: true,
      format: 'image/jpeg',
      fit: 'fill',
      bg: 'blur',
      bgs: ['blur', '#ffffff', '#14181b'],
      kbValue: 1900,
      kb: [500, 1000, 1900],
      defaultPreset: 'thumb',
      presets: [
        { id: 'thumb', label: 'Thumbnail', w: 1280, h: 720,
          guides: [{ type: 'zone', x: 0.8, y: 0.84, w: 0.19, h: 0.14, label: 'Video length badge' }],
          note: 'YouTube recommends 1280 × 720 px, 16:9, and a file under 2 MB. The video length covers the bottom right corner.' },
        { id: 'small', label: 'Small thumbnail', w: 640, h: 360,
          guides: [{ type: 'zone', x: 0.8, y: 0.84, w: 0.19, h: 0.14, label: 'Video length badge' }],
          note: 'The smallest width YouTube accepts is 640 px.' },
        { id: 'banner', label: 'Channel banner', w: 2560, h: 1440,
          guides: [{ type: 'rect', x: 0.198, y: 0.353, w: 0.604, h: 0.294, label: 'Visible on every screen' }],
          note: 'Keep the logo and text inside the marked area. Phones and TVs show different amounts of the rest.' },
        { id: 'icon', label: 'Channel icon', w: 800, h: 800, guides: [CIRCLE],
          note: 'Shown as a circle.' },
        { id: 'custom', label: 'Custom size', custom: true, w: 1280, h: 720, note: 'Type any size in pixels.' }
      ]
    },

    facebook: {
      file: 'facebook',
      minis: true,
      zip: true,
      format: 'image/jpeg',
      fit: 'fill',
      bg: 'blur',
      bgs: ['blur', '#ffffff', '#14181b'],
      defaultPreset: 'cover',
      presets: [
        { id: 'cover', label: 'Cover photo', w: 851, h: 315,
          guides: [{ type: 'rect', x: 0.125, y: 0, w: 0.75, h: 1, label: 'Safe on phones' }],
          note: 'Facebook shows about 820 × 312 px on a computer and crops the sides on a phone. Keep text and faces in the marked area.' },
        { id: 'cover-mobile', label: 'Cover, phone and computer', w: 820, h: 360,
          guides: [{ type: 'rect', x: 0.11, y: 0.067, w: 0.78, h: 0.866, label: 'Safe everywhere' }],
          note: 'A little taller, so nothing important is lost on phones or computers.' },
        { id: 'cover-hd', label: 'Cover, sharp', w: 1640, h: 720,
          guides: [{ type: 'rect', x: 0.11, y: 0.067, w: 0.78, h: 0.866, label: 'Safe everywhere' }],
          note: 'Double size, so it stays sharp on high resolution screens.' },
        { id: 'group', label: 'Group cover', w: 1640, h: 856,
          guides: [{ type: 'rect', x: 0, y: 0.113, w: 1, h: 0.774, label: 'Safe on computers and phones' }],
          note: 'Computers trim the top and bottom. Phones trim the sides.' },
        { id: 'event', label: 'Event cover', w: 1920, h: 1005,
          guides: [{ type: 'bands', top: 0, bottom: 0.33, label: 'Buttons cover the bottom on phones' }],
          note: 'Keep the important part in the upper two thirds.' },
        { id: 'profile', label: 'Profile picture', w: 800, h: 800, guides: [CIRCLE],
          note: 'Facebook shows it as a circle.' },
        { id: 'post', label: 'Post image', w: 1200, h: 630, note: 'Also used for shared link previews.' },
        { id: 'story', label: 'Story', w: 1080, h: 1920, guides: [STORY], note: 'Full screen 9:16.' },
        { id: 'custom', label: 'Custom size', custom: true, w: 1200, h: 630, note: 'Type any size in pixels.' }
      ]
    },

    linkedin: {
      file: 'linkedin',
      minis: true,
      zip: true,
      format: 'image/jpeg',
      fit: 'fill',
      bg: 'blur',
      bgs: ['blur', '#ffffff', '#14181b'],
      defaultPreset: 'profile',
      presets: [
        { id: 'profile', label: 'Profile photo', w: 400, h: 400, guides: [CIRCLE],
          note: 'LinkedIn shows it as a circle. Faces work best when they fill about 60% of the frame.' },
        { id: 'banner', label: 'Profile banner', w: 1584, h: 396,
          guides: [{ type: 'avatar', d: 0.57, x: 0.03, cy: 1, label: 'Your photo covers this (approx.)' }],
          note: 'Your profile photo sits over the bottom left, and phones crop the sides. Keep the message in the centre or on the right.' },
        { id: 'company', label: 'Company cover', w: 4200, h: 700, guides: [LOGO_ZONE],
          note: 'LinkedIn\'s current size for company page covers (6:1). The logo sits over the bottom left.' },
        { id: 'company-old', label: 'Company cover, older size', w: 1128, h: 191, guides: [LOGO_ZONE],
          note: 'The older company cover size. It still works, at the same 6:1 shape.' },
        { id: 'post', label: 'Post image', w: 1200, h: 627, note: 'The standard landscape shape for posts and link previews.' },
        { id: 'portrait', label: 'Portrait post', w: 1080, h: 1350, note: 'Takes more room in the phone feed.' },
        { id: 'square', label: 'Square post', w: 1080, h: 1080, note: 'Also used for carousel and document slides.' },
        { id: 'logo', label: 'Company logo', w: 300, h: 300, note: 'The smallest size LinkedIn asks for.' },
        { id: 'custom', label: 'Custom size', custom: true, w: 1200, h: 627, note: 'Type any size in pixels.' }
      ]
    },

    x: {
      file: 'x',
      minis: true,
      zip: true,
      format: 'image/jpeg',
      fit: 'fill',
      bg: 'blur',
      bgs: ['blur', '#ffffff', '#14181b'],
      defaultPreset: 'header',
      presets: [
        { id: 'profile', label: 'Profile picture', w: 400, h: 400, guides: [CIRCLE],
          note: 'Shown as a circle, and very small in the timeline. Keep the subject large and centred.' },
        { id: 'header', label: 'Header', w: 1500, h: 500,
          guides: [{ type: 'avatar', d: 0.66, x: 0.03, cy: 1, label: 'Your photo covers this (approx.)' }],
          note: 'Your profile picture sits over the bottom left, and phones trim the top and bottom a little.' },
        { id: 'post-wide', label: 'Post image 16:9', w: 1600, h: 900, note: 'Shows in full in the timeline on computers and phones.' },
        { id: 'post-square', label: 'Post image 1:1', w: 1080, h: 1080, note: 'A square post image.' },
        { id: 'post-tall', label: 'Post image 4:5', w: 1080, h: 1350, note: 'A tall post image that takes more room on phones.' },
        { id: 'card', label: 'Link card image', w: 1200, h: 628, note: 'For the large image on a shared link.' },
        { id: 'custom', label: 'Custom size', custom: true, w: 1600, h: 900, note: 'Type any size in pixels.' }
      ]
    },

    whatsapp: {
      file: 'whatsapp',
      photo: true,
      minis: true,
      format: 'image/jpeg',
      fit: 'fill',
      bg: 'blur',
      bgs: ['blur', '#ffffff', '#14181b'],
      defaultPreset: 'dp',
      presets: [
        { id: 'dp', label: 'Profile photo', w: 640, h: 640, guides: [CIRCLE],
          note: 'WhatsApp shows it as a circle, so the corners are cut off.' },
        { id: 'dp-min', label: 'Small', w: 500, h: 500, guides: [CIRCLE],
          note: 'The lowest size that still looks sharp.' },
        { id: 'dp-hd', label: 'Sharper', w: 1080, h: 1080, guides: [CIRCLE],
          note: 'A bigger file gives WhatsApp more detail to work with.' },
        { id: 'status', label: 'Status', w: 1080, h: 1920,
          guides: [{ type: 'bands', top: 0.15, bottom: 0.15, label: 'Keep key content in the middle' }],
          note: 'Full screen 9:16.' },
        { id: 'custom', label: 'Custom size', custom: true, w: 640, h: 640, note: 'Type any size in pixels.' }
      ]
    }
  };

  const FONTS = {
    site: '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    impact: 'Impact, Haettenschweiller, "Arial Narrow Bold", sans-serif',
    black: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif'
  };

  const PAPERS = {
    '4x6': { label: '4 × 6 in', mm: [101.6, 152.4] },
    '5x7': { label: '5 × 7 in', mm: [127, 177.8] },
    a4: { label: 'A4', mm: [210, 297] },
    letter: { label: 'Letter', mm: [215.9, 279.4] }
  };

  const cfg = TOOLS[section.dataset.frameTool];
  if (!cfg) return;

  const SHEET_DPI = 300;
  const MAX_SIDE = 8000;
  const MAX_AREA = 24e6;
  const FILM = '#f2b705';
  const INK = 'rgba(20, 24, 27, 0.6)';


  /* ==========================================================
     PAGE ELEMENTS
     ========================================================== */

  const el = (id) => document.getElementById(id);
  const presetBox = el('fx-presets');
  const customBox = el('fx-custom');
  const customW = el('fx-cw');
  const customH = el('fx-ch');
  const customUnit = el('fx-cunit');
  const dpiSelect = el('fx-dpi');
  const noteEl = el('fx-note');
  const canvas = el('fx-canvas');
  const caption = el('fx-cap');
  const stage = canvas.closest('.stage');
  const zoomInput = el('fx-zoom');
  const zoomOut = el('fx-zoom-out');
  const guidesBox = el('fx-guides');
  const fitBox = el('fx-fit');
  const bgBox = el('fx-bg');
  const bgColor = el('fx-bgcolor');
  const brightInput = el('fx-bright');
  const contrastInput = el('fx-contrast');
  const formatSelect = el('fx-format');
  const qualityInput = el('fx-quality');
  const qualityOut = el('fx-quality-out');
  const qualityField = el('fx-quality-field');
  const maxKbInput = el('fx-maxkb');
  const kbBox = el('fx-kb-chips');
  const goButton = el('fx-go');
  const allButton = el('fx-all');
  const zipOut = el('fx-zip-out');
  const minisBox = el('fx-minis');
  const shapeBox = el('fx-shapes');
  const ringInput = el('fx-ring');
  const ringOut = el('fx-ring-out');
  const ringColor = el('fx-ringcolor');
  const textInput = el('fx-text');
  const dragBox = el('fx-drag');
  const guideBody = el('fx-guide-body');

  const ctx = canvas.getContext('2d');
  const comp = document.createElement('canvas'); // the picture without guides
  const compCtx = comp.getContext('2d');
  const layer = document.createElement('canvas'); // the picture alone, for brightness and contrast
  const tiny = document.createElement('canvas');
  const mid = document.createElement('canvas');


  /* ==========================================================
     STATE
     "u" and "v" are the spot on the photo (0 to 1) that sits in
     the middle of the frame. That one idea covers moving, zooming
     and rotating, and it keeps the subject in view when you switch
     to a different size.
     ========================================================== */

  const state = {
    src: null,        // the photo, on a canvas (rotated and flipped as needed)
    prev: null,       // a smaller copy, for quick drawing while you drag
    file: null,
    preset: null,
    out: { w: 1, h: 1 },
    zoom: 1,
    u: 0.5,
    v: 0.5,
    fit: cfg.fit,
    bg: { mode: cfg.bg === 'blur' ? 'blur' : cfg.bg === 'clear' ? 'clear' : 'color', color: cfg.bg.startsWith('#') ? cfg.bg : '#ffffff' },
    guides: true,
    shape: 'circle',
    drag: 'photo',
    tx: 0.5,
    ty: 0.5,
    dpi: 300,
    dpr: 1,
    css: { w: 1, h: 1 },
    sheet: null       // the print sheet plan
  };


  /* ==========================================================
     SMALL HELPERS
     ========================================================== */

  function px(n) {
    return n * state.dpr;
  }

  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function gcd(a, b) {
    return b ? gcd(b, a % b) : a;
  }

  function ratioText(w, h) {
    const d = gcd(w, h);
    const a = w / d;
    const b = h / d;
    if (a <= 32 && b <= 32) return `${a}:${b}`;
    return (w / h).toFixed(2) + ':1';
  }

  function mmToPx(mm, dpi) {
    return Math.max(1, Math.round((mm / 25.4) * dpi));
  }

  function fmtMm(mm) {
    return String(Number(mm.toFixed(1)));
  }

  function fileSuffix(type) {
    return EXT[type] || 'png';
  }

  // "#c8dff5" is a light colour when this is above 0.6
  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
  }

  // Draws an image smaller in steps, which looks smoother than one big jump
  function drawSmooth(target, source, dx, dy, dw, dh) {
    let cur = source;
    let cw = source.naturalWidth || source.width;
    let ch = source.naturalHeight || source.height;
    while (cw / 2 >= dw && ch / 2 >= dh) {
      const next = newCanvas(Math.floor(cw / 2), Math.floor(ch / 2));
      const nctx = next.getContext('2d');
      nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(cur, 0, 0, next.width, next.height);
      cur = next;
      cw = next.width;
      ch = next.height;
    }
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'high';
    target.drawImage(cur, dx, dy, dw, dh);
  }

  function roundedPath(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // The outline of the picked shape (circle, rounded square or square)
  function shapePath(c, W, H, shape, inset = 0) {
    const s = Math.min(W, H);
    if (shape === 'circle') {
      c.moveTo(W / 2 + s / 2 - inset, H / 2);
      c.arc(W / 2, H / 2, Math.max(0, s / 2 - inset), 0, Math.PI * 2);
    } else if (shape === 'rounded') {
      roundedPath(c, inset, inset, W - 2 * inset, H - 2 * inset, Math.max(0, s * 0.22 - inset));
    } else {
      c.rect(inset, inset, W - 2 * inset, H - 2 * inset);
    }
  }


  /* ==========================================================
     THE PHOTO AND ITS POSITION
     ========================================================== */

  // Where the photo lands inside a frame of fw by fh (in frame pixels)
  function geometry(fw, fh, zoom, u, v) {
    const sw = state.src.width;
    const sh = state.src.height;
    const base = state.fit === 'fill' ? Math.max(fw / sw, fh / sh) : Math.min(fw / sw, fh / sh);
    const scale = base * zoom;
    const dw = sw * scale;
    const dh = sh * scale;

    // The photo may not leave a gap. If it is smaller than the frame it stays centred.
    if (dw > fw) {
      const half = fw / (2 * dw);
      u = clamp(u, half, 1 - half);
    } else {
      u = 0.5;
    }
    if (dh > fh) {
      const half = fh / (2 * dh);
      v = clamp(v, half, 1 - half);
    } else {
      v = 0.5;
    }
    return { scale, dw, dh, dx: fw / 2 - u * dw, dy: fh / 2 - v * dh, u, v };
  }

  function normalise() {
    const g = geometry(state.out.w, state.out.h, state.zoom, state.u, state.v);
    state.u = g.u;
    state.v = g.v;
  }

  // Changes the zoom. If a point in the frame is given, that point stays where it is.
  function setZoom(value, fx, fy) {
    const z = clamp(value, 1, 4);
    const { w: fw, h: fh } = state.out;
    if (fx === undefined) {
      state.zoom = z;
    } else {
      const g0 = geometry(fw, fh, state.zoom, state.u, state.v);
      const su = (fx - g0.dx) / g0.dw;
      const sv = (fy - g0.dy) / g0.dh;
      state.zoom = z;
      const g1 = geometry(fw, fh, z, g0.u, g0.v);
      state.u = (fw / 2 - (fx - su * g1.dw)) / g1.dw;
      state.v = (fh / 2 - (fy - sv * g1.dh)) / g1.dh;
    }
    normalise();
    zoomInput.value = Math.round(state.zoom * 100);
    zoomOut.textContent = zoomInput.value;
    requestRender();
  }

  function resetPosition() {
    state.zoom = 1;
    state.u = 0.5;
    state.v = cfg.photo ? 0.42 : 0.5; // faces are usually in the upper half
    state.tx = 0.5;
    state.ty = 0.5;
    normalise();
    zoomInput.value = 100;
    zoomOut.textContent = '100';
    requestRender();
  }

  // Rotate or flip the photo. The focus point turns with it.
  function transform(op) {
    if (!state.src) return;
    const turn = (source) => {
      const w = source.width;
      const h = source.height;
      const swap = op !== 'flip';
      const out = newCanvas(swap ? h : w, swap ? w : h);
      const c = out.getContext('2d');
      if (op === 'cw') { c.translate(h, 0); c.rotate(Math.PI / 2); }
      else if (op === 'ccw') { c.translate(0, w); c.rotate(-Math.PI / 2); }
      else { c.translate(w, 0); c.scale(-1, 1); }
      c.drawImage(source, 0, 0);
      return out;
    };
    const wasSame = state.prev === state.src;
    const src = turn(state.src);
    state.prev = wasSame ? src : turn(state.prev);
    state.src = src;

    const { u, v } = state;
    if (op === 'cw') { state.u = 1 - v; state.v = u; }
    else if (op === 'ccw') { state.u = v; state.v = 1 - u; }
    else { state.u = 1 - u; }
    normalise();
    requestRender();
  }


  /* ==========================================================
     SIZES
     ========================================================== */

  function presetById(id) {
    return cfg.presets.find((p) => p.id === id);
  }

  // The pixel size of the finished image
  function sizeOfPreset(p) {
    if (p.custom) return customSize(p);
    if (p.wmm) return { w: mmToPx(p.wmm, state.dpi), h: mmToPx(p.hmm, state.dpi) };
    return { w: p.w, h: p.h };
  }

  function customSize(p) {
    let w = parseFloat(customW.value);
    let h = parseFloat(customH.value);
    if (!(w > 0) || !(h > 0)) {
      w = p.wmm || p.w;
      h = p.hmm || p.h;
      if (p.wmm && customUnit) return { w: mmToPx(w, state.dpi), h: mmToPx(h, state.dpi) };
      return { w: Math.round(w), h: Math.round(h) };
    }
    if (customUnit && customUnit.value !== 'px') {
      const perUnit = { mm: 1, cm: 10, in: 25.4 }[customUnit.value];
      return { w: mmToPx(w * perUnit, state.dpi), h: mmToPx(h * perUnit, state.dpi) };
    }
    return { w: Math.round(w), h: Math.round(h) };
  }

  // Sizes that are too big or too small are pulled back to something the browser can make
  function limitSize(size) {
    let w = clamp(size.w, 16, MAX_SIDE);
    let h = clamp(size.h, 16, MAX_SIDE);
    if (w * h > MAX_AREA) {
      const k = Math.sqrt(MAX_AREA / (w * h));
      w = Math.floor(w * k);
      h = Math.floor(h * k);
    }
    return { w: Math.round(w), h: Math.round(h) };
  }

  function chipText(p) {
    if (p.custom) return p.label;
    if (p.wmm) return `${p.label} · ${p.sub}`;
    return `${p.label} · ${p.w} × ${p.h}`;
  }

  function buildPresetChips() {
    cfg.presets.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.dataset.preset = p.id;
      b.setAttribute('aria-pressed', 'false');
      b.textContent = chipText(p);
      presetBox.append(b);
    });
    presetBox.addEventListener('click', (event) => {
      const b = event.target.closest('[data-preset]');
      if (b) selectPreset(b.dataset.preset);
    });
  }

  function selectPreset(id) {
    const p = presetById(id) || cfg.presets[0];
    state.preset = p;
    showMinis();
    $$('[data-preset]', presetBox).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === p.id)));
    if (customBox) {
      customBox.hidden = !p.custom;
      if (p.custom && !customW.value) {
        customW.value = p.wmm ? fmtMm(p.wmm) : p.w;
        customH.value = p.hmm ? fmtMm(p.hmm) : p.h;
        if (customUnit) customUnit.value = p.wmm ? 'mm' : 'px';
      }
    }
    applySize();
  }

  function applySize() {
    const p = state.preset;
    state.out = limitSize(sizeOfPreset(p));
    describeSize();
    if (state.src) {
      normalise();
      layout();
      updateSheetOptions();
    }
    requestRender();
  }

  function describeSize() {
    const p = state.preset;
    const { w, h } = state.out;
    let line = `${w} × ${h} px`;
    if (cfg.physical) {
      const wmm = p.custom ? (w / state.dpi) * 25.4 : p.wmm;
      const hmm = p.custom ? (h / state.dpi) * 25.4 : p.hmm;
      line = `${w} × ${h} px at ${state.dpi} dpi (${fmtMm(wmm)} × ${fmtMm(hmm)} mm)`;
    } else {
      line += `, shape ${ratioText(w, h)}`;
    }
    noteEl.textContent = `${line}. ${p.note || ''}`.trim();
  }


  /* ==========================================================
     DRAWING THE PICTURE
     ========================================================== */

  // Fills the frame with a blurred, enlarged copy of the photo
  function drawBlur(c, W, H, source) {
    const tw = Math.max(6, Math.round(W / 48));
    const th = Math.max(6, Math.round(H / 48));
    const mw = Math.max(tw, Math.round(W / 8));
    const mh = Math.max(th, Math.round(H / 8));
    tiny.width = tw; tiny.height = th;
    mid.width = mw; mid.height = mh;

    const cover = (cw, ch) => {
      const k = Math.max(cw / source.width, ch / source.height);
      return [(cw - source.width * k) / 2, (ch - source.height * k) / 2, source.width * k, source.height * k];
    };
    const tctx = tiny.getContext('2d');
    tctx.clearRect(0, 0, tw, th);
    const t = cover(tw, th);
    drawSmooth(tctx, source, t[0], t[1], t[2], t[3]);

    const mctx = mid.getContext('2d');
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(tiny, 0, 0, mw, mh);

    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(mid, 0, 0, W, H);
    c.fillStyle = 'rgba(0, 0, 0, 0.16)';
    c.fillRect(0, 0, W, H);
  }

  // Brightness and contrast, for the photo only (not the background)
  function adjustLayer(c, W, H, bright, contrast) {
    const data = c.getImageData(0, 0, W, H);
    const px8 = data.data;
    const lut = new Uint8ClampedArray(256);
    const gain = 1 + contrast / 100;
    for (let i = 0; i < 256; i++) {
      lut[i] = ((i / 255 - 0.5) * gain + 0.5 + bright / 200) * 255;
    }
    for (let i = 0; i < px8.length; i += 4) {
      px8[i] = lut[px8[i]];
      px8[i + 1] = lut[px8[i + 1]];
      px8[i + 2] = lut[px8[i + 2]];
    }
    c.putImageData(data, 0, 0);
  }

  function drawPhoto(c, W, H, source, g, k, exporting) {
    const bright = brightInput ? Number(brightInput.value) : 0;
    const contrast = contrastInput ? Number(contrastInput.value) : 0;
    const dx = g.dx * k;
    const dy = g.dy * k;
    const dw = g.dw * k;
    const dh = g.dh * k;

    if (!bright && !contrast) {
      if (exporting) drawSmooth(c, source, dx, dy, dw, dh);
      else {
        c.imageSmoothingQuality = 'high';
        c.drawImage(source, dx, dy, dw, dh);
      }
      return;
    }
    if (layer.width !== W || layer.height !== H) {
      layer.width = W;
      layer.height = H;
    }
    const lctx = layer.getContext('2d', { willReadFrequently: true });
    lctx.clearRect(0, 0, W, H);
    if (exporting) drawSmooth(lctx, source, dx, dy, dw, dh);
    else {
      lctx.imageSmoothingQuality = 'high';
      lctx.drawImage(source, dx, dy, dw, dh);
    }
    adjustLayer(lctx, W, H, bright, contrast);
    c.drawImage(layer, 0, 0);
  }

  // The finished picture: background, photo, dimming and text. No guides.
  function paintPicture(c, W, H, source, exporting) {
    const { w: fw, h: fh } = state.out;
    const k = W / fw;
    const g = geometry(fw, fh, state.zoom, state.u, state.v);
    c.clearRect(0, 0, W, H);

    const covers = g.dw >= fw - 0.5 && g.dh >= fh - 0.5;
    if (state.bg.mode === 'color') {
      c.fillStyle = state.bg.color;
      c.fillRect(0, 0, W, H);
    } else if (state.bg.mode === 'blur' && !covers) {
      drawBlur(c, W, H, source);
    }
    drawPhoto(c, W, H, source, g, k, exporting);

    if (cfg.text) {
      const dim = Number(el('fx-dim').value) / 100;
      if (dim > 0) {
        c.fillStyle = `rgba(0, 0, 0, ${dim})`;
        c.fillRect(0, 0, W, H);
      }
      paintText(c, W, H);
    }
  }

  function paintText(c, W, H) {
    const raw = textInput.value.replace(/\r/g, '');
    if (!raw.trim()) return;
    const lines = (el('fx-caps').checked ? raw.toUpperCase() : raw).split('\n').slice(0, 4);
    const family = FONTS[el('fx-font').value] || FONTS.site;
    const weight = el('fx-font').value === 'serif' ? 700 : 800;
    let size = (H * Number(el('fx-tsize').value)) / 100;

    c.font = `${weight} ${size}px ${family}`;
    const widest = Math.max(...lines.map((line) => c.measureText(line).width));
    if (widest > W * 0.94) {
      size *= (W * 0.94) / widest;
      c.font = `${weight} ${size}px ${family}`;
    }

    const lineHeight = size * 1.08;
    const top = state.ty * H - (lines.length * lineHeight) / 2 + lineHeight / 2;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.miterLimit = 2;
    c.lineWidth = (size * Number(el('fx-sw').value)) / 100;
    c.strokeStyle = el('fx-scolor').value;
    c.fillStyle = el('fx-tcolor').value;
    lines.forEach((line, i) => {
      const y = top + i * lineHeight;
      if (c.lineWidth > 0) c.strokeText(line, state.tx * W, y);
      c.fillText(line, state.tx * W, y);
    });
  }

  // Cut the picture to a shape (profile pictures) and add the ring
  function finishShape(c, W, H, type) {
    if (cfg.shapes && state.shape !== 'square') {
      c.save();
      c.globalCompositeOperation = 'destination-in';
      c.beginPath();
      shapePath(c, W, H, state.shape);
      c.fillStyle = '#000';
      c.fill();
      c.restore();
    }
    if (type === 'image/jpeg') {
      // JPG cannot be see-through, so anything empty is filled first
      c.save();
      c.globalCompositeOperation = 'destination-over';
      c.fillStyle = state.bg.mode === 'color' ? state.bg.color : '#ffffff';
      c.fillRect(0, 0, W, H);
      c.restore();
    }
    if (cfg.shapes) drawRing(c, W, H);
  }

  function ringWidth(W, H) {
    return ringInput ? (Math.min(W, H) * Number(ringInput.value)) / 100 : 0;
  }

  function drawRing(c, W, H) {
    const width = ringWidth(W, H);
    if (!(width > 0)) return;
    c.save();
    c.beginPath();
    shapePath(c, W, H, state.shape, width / 2);
    c.lineWidth = width;
    c.strokeStyle = ringColor.value;
    c.stroke();
    c.restore();
  }

  // The full-size image that gets saved
  function renderExport(w, h, type, params) {
    const keep = { zoom: state.zoom, u: state.u, v: state.v, out: state.out };
    if (params) {
      state.zoom = params.zoom;
      state.u = params.u;
      state.v = params.v;
    }
    state.out = { w, h };
    try {
      const c = newCanvas(w, h);
      const x = c.getContext('2d');
      paintPicture(x, w, h, state.src, true);
      finishShape(x, w, h, type);
      return c;
    } finally {
      state.zoom = keep.zoom;
      state.u = keep.u;
      state.v = keep.v;
      state.out = keep.out;
    }
  }


  /* ==========================================================
     GUIDES (preview only)
     ========================================================== */

  function pill(c, text, x, y) {
    c.save();
    c.font = `700 ${px(11)}px ${FONTS.site}`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    const pad = px(6);
    const w = c.measureText(text).width + pad * 2;
    const h = px(18);
    const left = clamp(x, px(4), Math.max(px(4), canvas.width - w - px(4)));
    const top = clamp(y, px(4), Math.max(px(4), canvas.height - h - px(4)));
    c.fillStyle = 'rgba(20, 24, 27, 0.86)';
    c.beginPath();
    roundedPath(c, left, top, w, h, px(5));
    c.fill();
    c.fillStyle = FILM;
    c.fillText(text, left + pad, top + h / 2 + 0.5);
    c.restore();
  }

  function dashed(c) {
    c.setLineDash([px(6), px(5)]);
    c.lineWidth = px(2);
    c.strokeStyle = FILM;
  }

  // Darkens everything outside a shape
  function dimOutside(c, W, H, add, alpha) {
    c.save();
    c.beginPath();
    c.rect(0, 0, W, H);
    add(c);
    c.fillStyle = `rgba(20, 24, 27, ${alpha})`;
    c.fill('evenodd');
    c.restore();
  }

  function drawGuide(c, g, W, H) {
    if (g.type === 'circle') {
      const r = Math.min(W, H) / 2;
      dimOutside(c, W, H, (p) => { p.moveTo(W / 2 + r, H / 2); p.arc(W / 2, H / 2, r, 0, Math.PI * 2); }, 0.55);
      c.save(); dashed(c);
      c.beginPath(); c.arc(W / 2, H / 2, r - px(1), 0, Math.PI * 2); c.stroke();
      c.restore();
      if (g.label) pill(c, g.label, W / 2 - px(50), H - px(26));
    } else if (g.type === 'rect' || g.type === 'ratio') {
      let x, y, w, h;
      if (g.type === 'rect') {
        x = g.x * W; y = g.y * H; w = g.w * W; h = g.h * H;
      } else if (W / H > g.r) {
        h = H; w = H * g.r; x = (W - w) / 2; y = 0;
      } else {
        w = W; h = W / g.r; x = 0; y = (H - h) / 2;
      }
      dimOutside(c, W, H, (p) => p.rect(x, y, w, h), 0.4);
      c.save(); dashed(c); c.strokeRect(x + px(1), y + px(1), w - px(2), h - px(2)); c.restore();
      if (g.label) pill(c, g.label, x + px(6), y + px(6));
    } else if (g.type === 'bands') {
      c.save();
      c.fillStyle = INK;
      c.fillRect(0, 0, W, g.top * H);
      c.fillRect(0, H - g.bottom * H, W, g.bottom * H);
      c.restore();
      c.save(); dashed(c);
      c.beginPath();
      if (g.top) { c.moveTo(0, g.top * H); c.lineTo(W, g.top * H); }
      if (g.bottom) { c.moveTo(0, H - g.bottom * H); c.lineTo(W, H - g.bottom * H); }
      c.stroke(); c.restore();
      if (g.label) pill(c, g.label, W / 2 - px(90), (g.top ? g.top * H : H - g.bottom * H) + px(8));
    } else if (g.type === 'zone') {
      const x = g.x * W; const y = g.y * H; const w = g.w * W; const h = g.h * H;
      c.save();
      c.fillStyle = INK;
      c.fillRect(x, y, w, h);
      dashed(c);
      c.strokeRect(x + px(1), y + px(1), w - px(2), h - px(2));
      c.restore();
      if (g.label) pill(c, g.label, x + px(4), y + px(4));
    } else if (g.type === 'avatar') {
      const r = (g.d * H) / 2;
      const cx = g.x * W + r;
      const cy = g.cy * H;
      c.save();
      c.beginPath(); c.rect(0, 0, W, H); c.clip();
      c.fillStyle = INK;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      dashed(c);
      c.beginPath(); c.arc(cx, cy, r - px(1), 0, Math.PI * 2); c.stroke();
      c.restore();
      if (g.label) pill(c, g.label, cx + r + px(8), H - px(26));
    } else if (g.type === 'face') {
      drawFaceGuide(c, g, W, H);
    }
  }

  // An oval for the head, and a band showing where the top of the head should be
  function drawFaceGuide(c, g, W, H) {
    const [lo, hi] = g.head;
    const headH = ((lo + hi) / 2) * H;
    const cy = 0.46 * H;
    const ry = headH / 2;
    const rx = ry * 0.74;
    const chin = cy + ry;
    const topMax = chin - hi * H;
    const topMin = chin - lo * H;

    c.save();
    c.fillStyle = 'rgba(242, 183, 5, 0.16)';
    c.fillRect(0, topMax, W, topMin - topMax);
    dashed(c);
    c.beginPath();
    c.moveTo(0, topMax); c.lineTo(W, topMax);
    c.moveTo(0, topMin); c.lineTo(W, topMin);
    c.stroke();

    c.setLineDash([px(6), px(5)]);
    c.beginPath(); c.ellipse(W / 2, cy, rx, ry, 0, 0, Math.PI * 2); c.stroke();

    c.setLineDash([px(2), px(6)]);
    c.lineWidth = px(1.5);
    c.beginPath();
    c.moveTo(W / 2, 0); c.lineTo(W / 2, H);
    c.moveTo(0, chin); c.lineTo(W, chin);
    c.stroke();
    c.restore();

    pill(c, g.suggest ? 'Suggested top of head' : 'Top of head', px(6), topMax - px(20));
    pill(c, 'Chin', px(6), chin + px(3));
  }

  function currentGuides() {
    const p = state.preset;
    let list = (p.guides || []).slice();
    if (cfg.photo && cfg.physical) {
      list = [{ type: 'face', head: p.head || [0.55, 0.75], suggest: p.suggest }];
    }
    return list;
  }

  function drawOverlay(c, W, H) {
    if (cfg.shapes) {
      // Show what will be cut off, and the ring
      if (state.shape !== 'square') dimOutside(c, W, H, (p) => shapePath(p, W, H, state.shape), 0.6);
      drawRing(c, W, H);
      if (state.guides) {
        c.save(); dashed(c);
        c.beginPath(); shapePath(c, W, H, state.shape, px(1)); c.stroke();
        c.restore();
      }
      return;
    }
    if (!state.guides) return;
    currentGuides().forEach((g) => drawGuide(c, g, W, H));
  }


  /* ==========================================================
     THE PREVIEW
     ========================================================== */

  let frame = 0;

  function requestRender() {
    if (frame) return;
    frame = requestAnimationFrame(render);
  }

  function render() {
    frame = 0;
    if (!state.src) return;
    const W = canvas.width;
    const H = canvas.height;
    if (comp.width !== W || comp.height !== H) {
      comp.width = W;
      comp.height = H;
    }
    paintPicture(compCtx, W, H, state.prev, false);

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(comp, 0, 0);
    drawOverlay(ctx, W, H);

    updateMinis();
    updateSheetPreview();
  }

  // Sizes the preview so the whole frame fits on screen
  function layout() {
    if (!state.src) return;
    const avail = stage.clientWidth - 56;
    if (avail < 40) return;
    const { w, h } = state.out;
    const ratio = w / h;
    const maxH = clamp(window.innerHeight * 0.66, 260, 620);
    // Show small sizes at their real size, so Small, Medium and Large look different.
    // (Never below 240 px wide, so the photo is still easy to move.)
    const cw = Math.max(80, Math.min(avail, maxH * ratio, 760, Math.max(240, w)));
    const ch = cw / ratio;

    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.css = { w: cw, h: ch };
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = Math.round(cw * state.dpr);
    canvas.height = Math.round(ch * state.dpr);
    requestRender();
  }

  // Small copies of the finished picture, to check it is still clear when tiny
  function updateMinis() {
    if (!minisBox || minisBox.hidden) return;
    const shape = cfg.shapes ? state.shape : 'circle';
    $$('canvas', minisBox).forEach((mini) => {
      const size = Number(mini.dataset.size);
      const s = Math.round(size * state.dpr);
      if (mini.width !== s) { mini.width = s; mini.height = s; }
      mini.style.width = `${size}px`;
      mini.style.height = `${size}px`;
      const m = mini.getContext('2d');
      m.clearRect(0, 0, s, s);
      m.save();
      m.beginPath();
      shapePath(m, s, s, shape);
      m.clip();
      // Show the middle square of the picture, as the apps do
      const W = comp.width;
      const H = comp.height;
      const side = Math.min(W, H);
      m.imageSmoothingQuality = 'high';
      m.drawImage(comp, (W - side) / 2, (H - side) / 2, side, side, 0, 0, s, s);
      m.restore();
      if (cfg.shapes) drawRing(m, s, s);
    });
  }

  function showMinis() {
    if (!minisBox) return;
    const round = cfg.shapes || (state.preset.guides || []).some((g) => g.type === 'circle');
    minisBox.hidden = !round;
  }


  /* ==========================================================
     MOUSE, FINGERS AND KEYBOARD
     ========================================================== */

  const pointers = new Map();
  let gesture = null;

  function framePoint(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    return {
      x: ((clientX - box.left) / box.width) * state.out.w,
      y: ((clientY - box.top) / box.height) * state.out.h
    };
  }

  function pan(dx, dy) {
    const box = canvas.getBoundingClientRect();
    if (!box.width) return;
    if (state.drag === 'text' && cfg.text) {
      state.tx = clamp(state.tx + dx / box.width, 0, 1);
      state.ty = clamp(state.ty + dy / box.height, 0, 1);
      requestRender();
      return;
    }
    const { w: fw, h: fh } = state.out;
    const g = geometry(fw, fh, state.zoom, state.u, state.v);
    const k = fw / box.width;
    state.u -= (dx * k) / g.dw;
    state.v -= (dy * k) / g.dh;
    normalise();
    requestRender();
  }

  function pinchState() {
    const [a, b] = Array.from(pointers.values());
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!state.src) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) gesture = pinchState();
    canvas.classList.add('is-grabbing');
  });

  canvas.addEventListener('pointermove', (event) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      const dx = event.clientX - p.x;
      const dy = event.clientY - p.y;
      p.x = event.clientX;
      p.y = event.clientY;
      pan(dx, dy);
    } else if (pointers.size === 2 && gesture) {
      p.x = event.clientX;
      p.y = event.clientY;
      const now = pinchState();
      const at = framePoint(now.x, now.y);
      setZoom(state.zoom * (now.dist / gesture.dist), at.x, at.y);
      pan(now.x - gesture.x, now.y - gesture.y);
      gesture = now;
    }
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) gesture = null;
    if (!pointers.size) canvas.classList.remove('is-grabbing');
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // Ctrl or Cmd with the wheel (or a trackpad pinch) zooms. The plain wheel still scrolls the page.
  canvas.addEventListener('wheel', (event) => {
    if (!state.src || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const at = framePoint(event.clientX, event.clientY);
    setZoom(state.zoom * Math.exp(-event.deltaY * 0.01), at.x, at.y);
  }, { passive: false });

  canvas.addEventListener('keydown', (event) => {
    if (!state.src) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = arrows[event.key];
    if (move) {
      event.preventDefault();
      const step = (event.shiftKey ? 5 : 1) * 4;
      const box = canvas.getBoundingClientRect();
      pan(move[0] * step * (box.width / 100), move[1] * step * (box.width / 100));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(state.zoom * 1.08);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setZoom(state.zoom / 1.08);
    }
  });


  /* ==========================================================
     THE CONTROLS
     ========================================================== */

  // A row of chips where one is pressed
  function chipGroup(box, attr, onPick) {
    if (!box) return;
    box.addEventListener('click', (event) => {
      const b = event.target.closest(`[data-${attr}]`);
      if (!b || b.disabled) return;
      onPick(b.dataset[attr], b);
    });
  }

  function pressChip(box, attr, value) {
    if (!box) return;
    $$(`[data-${attr}]`, box).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
  }

  zoomInput.addEventListener('input', () => setZoom(Number(zoomInput.value) / 100));

  el('fx-rot-l').addEventListener('click', () => transform('ccw'));
  el('fx-rot-r').addEventListener('click', () => transform('cw'));
  el('fx-flip').addEventListener('click', () => transform('flip'));
  el('fx-reset').addEventListener('click', resetPosition);

  guidesBox.addEventListener('change', () => {
    state.guides = guidesBox.checked;
    requestRender();
  });

  chipGroup(fitBox, 'fit', (value) => {
    state.fit = value;
    pressChip(fitBox, 'fit', value);
    state.zoom = 1;
    zoomInput.value = 100;
    zoomOut.textContent = '100';
    normalise();
    requestRender();
  });

  // Background: blurred photo, a colour, or see-through
  function setBackground(mode, color) {
    state.bg.mode = mode;
    if (color) state.bg.color = color;
    if (bgBox) {
      $$('[data-bg]', bgBox).forEach((b) => {
        const on = mode === 'color' ? b.dataset.bg === state.bg.color : b.dataset.bg === mode;
        b.setAttribute('aria-pressed', String(on));
      });
    }
    if (bgColor && mode === 'color') bgColor.value = state.bg.color;
    requestRender();
  }

  chipGroup(bgBox, 'bg', (value) => {
    if (value === 'blur' || value === 'clear') setBackground(value);
    else setBackground('color', value);
  });

  if (bgColor) bgColor.addEventListener('input', () => setBackground('color', bgColor.value));

  // Remove the background with the AI person finder (passport and ID photos)
  const cutButton = el('fx-cutout');
  let cutOriginal = null;   // { src, prev } before the background was removed
  const cutLabel = cutButton ? cutButton.textContent : '';

  function resetCutout() {
    cutOriginal = null;
    if (cutButton) cutButton.textContent = cutLabel;
  }

  function cutOut(canvasIn, mask) {
    const c = newCanvas(canvasIn.width, canvasIn.height);
    const x = c.getContext('2d');
    x.drawImage(canvasIn, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.imageSmoothingQuality = 'high';
    x.drawImage(mask, 0, 0, c.width, c.height);
    return c;
  }

  if (cutButton) {
    cutButton.addEventListener('click', () => {
      if (!state.src) { say(section, 'Add a photo first.', true); return; }
      if (cutOriginal) {   // second click: bring the background back
        state.src = cutOriginal.src;
        state.prev = cutOriginal.prev;
        resetCutout();
        requestRender();
        return;
      }
      (async () => {
        cutButton.disabled = true;
        cutButton.textContent = 'Working...';
        try {
          if (!window.SubjectMask) throw new Error('The person finder could not load. Check your connection and reload the page.');
          // Find the person on the smaller copy (fast), then apply it to both copies
          const mask = await window.SubjectMask.detectCanvas(state.prev, (t) => say(section, t));
          const original = { src: state.src, prev: state.prev };
          state.src = cutOut(original.src, mask);
          state.prev = original.src === original.prev ? state.src : cutOut(original.prev, mask);
          cutOriginal = original;
          if (state.bg.mode !== 'color') setBackground('color', '#ffffff');
          say(section, 'Background removed. Pick a background colour below. Your country may require plain white or off-white.');
          requestRender();
        } catch (err) {
          console.error(err);
          say(section, 'Could not run the person finder. It needs a connection the first time to download its model.', true);
        } finally {
          cutButton.disabled = false;
          cutButton.textContent = cutOriginal ? 'Bring the background back' : cutLabel;
        }
      })();
    });
  }

  [brightInput, contrastInput].forEach((input) => {
    if (!input) return;
    const out = el(input.id + '-out');
    input.addEventListener('input', () => {
      if (out) out.textContent = input.value;
      requestRender();
    });
  });

  if (dpiSelect) {
    dpiSelect.addEventListener('change', () => {
      state.dpi = Number(dpiSelect.value);
      applySize();
    });
  }

  [customW, customH, customUnit].forEach((input) => {
    if (input) input.addEventListener('input', applySize);
  });

  // Shapes and ring (profile pictures)
  chipGroup(shapeBox, 'shape', (value) => {
    state.shape = value;
    pressChip(shapeBox, 'shape', value);
    requestRender();
  });
  if (ringInput) {
    ringInput.addEventListener('input', () => {
      ringOut.textContent = ringInput.value;
      requestRender();
    });
    ringColor.addEventListener('input', requestRender);
  }

  // Text on the picture (YouTube)
  if (cfg.text) {
    ['fx-text', 'fx-font', 'fx-tsize', 'fx-tcolor', 'fx-scolor', 'fx-sw', 'fx-dim', 'fx-caps'].forEach((id) => {
      const input = el(id);
      input.addEventListener('input', () => {
        const out = el(id + '-out');
        if (out) out.textContent = input.value;
        if (id === 'fx-text') syncDragButtons();
        requestRender();
      });
      input.addEventListener('change', requestRender);
    });
    chipGroup(dragBox, 'drag', (value) => {
      state.drag = value;
      pressChip(dragBox, 'drag', value);
      canvas.classList.toggle('is-text', value === 'text');
      caption.textContent = value === 'text'
        ? 'Drag on the picture to move the title.'
        : 'Drag to move the photo. Pinch or use the zoom slider.';
    });
    if (document.fonts && document.fonts.load) {
      document.fonts.load('800 40px "Bricolage Grotesque"').then(requestRender).catch(() => {});
    }
  }

  function syncDragButtons() {
    if (!dragBox) return;
    const has = Boolean(textInput.value.trim());
    const textButton = $('[data-drag="text"]', dragBox);
    textButton.disabled = !has;
    if (!has && state.drag === 'text') {
      state.drag = 'photo';
      pressChip(dragBox, 'drag', 'photo');
      canvas.classList.remove('is-text');
      caption.textContent = 'Drag to move the photo. Pinch or use the zoom slider.';
    }
  }

  // Output: format, quality and file size limit
  function syncFormat() {
    const jpg = formatSelect.value === 'image/jpeg';
    const png = formatSelect.value === 'image/png';
    qualityField.hidden = png;
    qualityOut.textContent = qualityInput.value;
    // Transparent backgrounds do not work in JPG
    if (bgBox) {
      const clear = $('[data-bg="clear"]', bgBox);
      if (clear) clear.title = jpg ? 'JPG cannot be see-through. Choose PNG or WebP.' : '';
    }
  }
  formatSelect.addEventListener('change', syncFormat);
  qualityInput.addEventListener('input', () => { qualityOut.textContent = qualityInput.value; });

  if (kbBox) {
    kbBox.addEventListener('click', (event) => {
      const b = event.target.closest('[data-kb]');
      if (!b) return;
      maxKbInput.value = b.dataset.kb === '0' ? '' : b.dataset.kb;
      syncKbChips();
    });
    maxKbInput.addEventListener('input', syncKbChips);
  }

  function syncKbChips() {
    if (!kbBox) return;
    const now = maxKbInput.value.trim() || '0';
    $$('[data-kb]', kbBox).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kb === now)));
  }


  /* ==========================================================
     SAVING
     ========================================================== */

  // Saves a canvas. With a size limit, the quality is lowered until the file fits.
  async function encode(canvasToSave, type, quality, maxKb) {
    if (type === 'image/png' || !maxKb) {
      const blob = await canvasToBlob(canvasToSave, type, quality);
      return { blob, fits: true };
    }
    const limit = maxKb * 1000;
    let best = await canvasToBlob(canvasToSave, type, quality);
    if (best.size <= limit) return { blob: best, fits: true };

    let low = 0.05;
    let high = quality;
    let found = null;
    for (let i = 0; i < 8; i++) {
      const q = (low + high) / 2;
      const blob = await canvasToBlob(canvasToSave, type, q);
      if (blob.size <= limit) { found = blob; low = q; }
      else { best = blob; high = q; }
    }
    if (found) return { blob: found, fits: true };
    const smallest = await canvasToBlob(canvasToSave, type, 0.05);
    return { blob: smallest, fits: smallest.size <= limit };
  }

  function chosenFormat() {
    let type = formatSelect.value;
    let note = '';
    const maxKb = Number(maxKbInput.value) || 0;
    if (maxKb && type === 'image/png') {
      type = 'image/jpeg';
      note = 'PNG files cannot be squeezed to a size limit, so this one was saved as a JPG.';
    }
    return { type, note, maxKb };
  }

  function outputName(preset, w, h, type, blob) {
    const ext = fileSuffix(blob ? blob.type : type);
    const name = baseName(state.file.name);
    return `${name}-${cfg.file}-${preset.id}-${w}x${h}.${ext}`;
  }

  async function makeOne() {
    const { w, h } = state.out;
    const { type, note, maxKb } = chosenFormat();
    const canvasToSave = renderExport(w, h, type);
    const { blob, fits } = await encode(canvasToSave, type, Number(qualityInput.value) / 100, maxKb);
    canvasToSave.width = canvasToSave.height = 0;

    const notes = [note];
    let warn = false;
    if (blob.type !== type) {
      notes.push(`This browser cannot save that format, so it saved a ${fileSuffix(blob.type).toUpperCase()} instead.`);
    }
    if (maxKb && fits) notes.push(`The file is ${formatBytes(blob.size)}, under your limit of ${maxKb} KB.`);
    if (maxKb && !fits) {
      warn = true;
      notes.push(`Even at the lowest quality the file is ${formatBytes(blob.size)}, which is over ${maxKb} KB. Try a smaller size or a plainer photo.`);
    }
    return { blob, w, h, filename: outputName(state.preset, w, h, type, blob), note: notes.filter(Boolean).join(' '), warn };
  }

  goButton.addEventListener('click', () =>
    withBusy(goButton, section, async () => {
      say(section, '');
      const made = await makeOne();
      showResult(section, { blob: made.blob, filename: made.filename, width: made.w, height: made.h });
      if (made.note) say(section, made.note, made.warn);
    })
  );

  const zipUrls = [];

  function freeUrls(list) {
    while (list.length) URL.revokeObjectURL(list.pop());
  }

  // Every size in the list, in one ZIP file
  if (allButton) {
    allButton.addEventListener('click', () =>
      withBusy(allButton, section, async () => {
        say(section, '');
        const { type, note, maxKb } = chosenFormat();
        const quality = Number(qualityInput.value) / 100;
        const files = [];
        const list = cfg.presets.filter((p) => !p.custom);

        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          say(section, `Making size ${i + 1} of ${list.length}: ${p.label}...`);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const c = renderExport(p.w, p.h, type, { zoom: 1, u: state.u, v: state.v });
          const { blob } = await encode(c, type, quality, maxKb);
          files.push({ name: outputName(p, p.w, p.h, type, blob), data: blob });
          c.width = c.height = 0;
        }

        const zip = await LBCore.makeZip(files);
        freeUrls(zipUrls);
        const url = URL.createObjectURL(zip);
        zipUrls.push(url);
        const link = $('a', zipOut);
        link.href = url;
        link.download = `${baseName(state.file.name)}-${cfg.file}-sizes.zip`;
        $('.result-summary', zipOut).textContent = `${files.length} sizes, ${formatBytes(zip.size)} in a ZIP file`;
        zipOut.hidden = false;
        say(section, note || 'Each size keeps the spot you framed and fills its own shape. Use the single size above to fine tune one.');
      })
    );
  }


  /* ==========================================================
     PRINT SHEET (passport and ID photos)
     ========================================================== */

  const sheetBox = el('fx-sheet');
  let sheetUrls = [];

  function planSheet() {
    const paper = PAPERS[el('fx-sheet-paper').value].mm;
    const gap = Number(el('fx-sheet-gap').value);
    const margin = Number(el('fx-sheet-margin').value);
    const p = state.preset;
    const w = p.custom ? (state.out.w / state.dpi) * 25.4 : p.wmm;
    const h = p.custom ? (state.out.h / state.dpi) * 25.4 : p.hmm;

    const fitOn = (pw, ph) => ({
      pw, ph,
      cols: Math.max(0, Math.floor((pw - 2 * margin + gap + 1e-6) / (w + gap))),
      rows: Math.max(0, Math.floor((ph - 2 * margin + gap + 1e-6) / (h + gap)))
    });
    const upright = fitOn(paper[0], paper[1]);
    const sideways = fitOn(paper[1], paper[0]);
    const best = sideways.cols * sideways.rows > upright.cols * upright.rows ? sideways : upright;

    const max = best.cols * best.rows;
    const wanted = el('fx-sheet-copies').value;
    const count = wanted === 'auto' ? max : Math.min(max, Number(wanted));
    const cols = Math.min(best.cols, Math.max(1, count));
    const rows = Math.ceil(count / cols);
    const blockW = cols * w + (cols - 1) * gap;
    const blockH = rows * h + (rows - 1) * gap;
    return {
      pw: best.pw, ph: best.ph, w, h, gap, count, max, cols, rows,
      x0: (best.pw - blockW) / 2, y0: (best.ph - blockH) / 2,
      sideways: best === sideways && best !== upright
    };
  }

  function drawSheet(c, W, tile, plan, cut) {
    const s = W / plan.pw;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, plan.ph * s);
    c.imageSmoothingQuality = 'high';
    for (let i = 0; i < plan.count; i++) {
      const col = i % plan.cols;
      const row = Math.floor(i / plan.cols);
      const x = (plan.x0 + col * (plan.w + plan.gap)) * s;
      const y = (plan.y0 + row * (plan.h + plan.gap)) * s;
      c.drawImage(tile, x, y, plan.w * s, plan.h * s);
      if (cut) {
        c.strokeStyle = '#9aa4ab';
        c.lineWidth = Math.max(1, s * 0.15);
        c.strokeRect(x, y, plan.w * s, plan.h * s);
      }
    }
  }

  // Keeps the "how many copies" list in step with what fits
  function updateSheetOptions() {
    if (!sheetBox || !state.src) return;
    el('fx-sheet-out').hidden = true; // the finished sheet no longer matches the options
    const plan = planSheet();
    const select = el('fx-sheet-copies');
    const keep = select.value;
    select.innerHTML = '';
    const auto = new Option(plan.max ? `Fill the sheet (${plan.max})` : 'Does not fit', 'auto');
    select.add(auto);
    for (let n = 1; n <= plan.max; n++) select.add(new Option(String(n), String(n)));
    select.value = Array.from(select.options).some((o) => o.value === keep) ? keep : 'auto';
    requestRender();
  }

  function updateSheetPreview() {
    if (!sheetBox || !state.src) return;
    const sheetCanvas = el('fx-sheet-canvas');
    const plan = planSheet();
    state.sheet = plan;
    const info = el('fx-sheet-info');
    if (!plan.max) {
      info.textContent = 'This photo is bigger than the paper. Pick a bigger sheet or a smaller margin.';
      sheetCanvas.width = sheetCanvas.height = 1;
      el('fx-sheet-go').disabled = true;
      return;
    }
    el('fx-sheet-go').disabled = false;
    const cssW = 220;
    const W = Math.round(cssW * state.dpr);
    const H = Math.round(W * (plan.ph / plan.pw));
    if (sheetCanvas.width !== W || sheetCanvas.height !== H) {
      sheetCanvas.width = W;
      sheetCanvas.height = H;
      sheetCanvas.style.width = `${cssW}px`;
      sheetCanvas.style.height = `${(cssW * plan.ph) / plan.pw}px`;
    }
    drawSheet(sheetCanvas.getContext('2d'), W, comp, plan, el('fx-sheet-cut').checked);
    const paper = PAPERS[el('fx-sheet-paper').value].label;
    info.textContent = `${plan.count} ${plan.count === 1 ? 'copy' : 'copies'} on ${paper}${plan.sideways ? ' (turned sideways)' : ''}. Print at 100% or "actual size", with no scaling.`;
  }

  if (sheetBox) {
    ['fx-sheet-paper', 'fx-sheet-gap', 'fx-sheet-margin', 'fx-sheet-copies', 'fx-sheet-cut'].forEach((id) =>
      el(id).addEventListener('change', () => {
        el('fx-sheet-out').hidden = true;
        if (id !== 'fx-sheet-copies') updateSheetOptions();
        requestRender();
      })
    );

    const sheetGo = el('fx-sheet-go');
    sheetGo.addEventListener('click', () =>
      withBusy(sheetGo, section, async () => {
        say(section, '');
        const plan = planSheet();
        if (!plan.max) return;

        // One photo at print quality, then repeated on the sheet
        const tileW = mmToPx(plan.w, SHEET_DPI);
        const tileH = mmToPx(plan.h, SHEET_DPI);
        const tile = renderExport(tileW, tileH, 'image/jpeg');

        const W = mmToPx(plan.pw, SHEET_DPI);
        const H = mmToPx(plan.ph, SHEET_DPI);
        const sheet = newCanvas(W, H);
        drawSheet(sheet.getContext('2d'), W, tile, plan, el('fx-sheet-cut').checked);

        const jpg = await canvasToBlob(sheet, 'image/jpeg', 0.95);
        const jpgBytes = new Uint8Array(await jpg.arrayBuffer());
        const doc = new LBCore.PdfDocument();
        const id = doc.addJpeg(jpgBytes, W, H, 3);
        const ptW = (plan.pw / 25.4) * 72;
        const ptH = (plan.ph / 25.4) * 72;
        doc.addPage(ptW, ptH, `q\n${ptW.toFixed(3)} 0 0 ${ptH.toFixed(3)} 0 0 cm\n/Im0 Do\nQ\n`, { Im0: id });
        const pdf = doc.finish('Print sheet');

        freeUrls(sheetUrls);
        const base = `${baseName(state.file.name)}-${cfg.file}-${state.preset.id}-sheet-${el('fx-sheet-paper').value}`;
        const links = $$('a', el('fx-sheet-out'));
        [[jpg, `${base}.jpg`], [pdf, `${base}.pdf`]].forEach(([blob, name], i) => {
          const url = URL.createObjectURL(blob);
          sheetUrls.push(url);
          links[i].href = url;
          links[i].download = name;
        });
        $('.result-summary', el('fx-sheet-out')).textContent =
          `${plan.count} ${plan.count === 1 ? 'copy' : 'copies'} on ${PAPERS[el('fx-sheet-paper').value].label}, ready to print`;
        el('fx-sheet-out').hidden = false;
        tile.width = tile.height = 0;
        sheet.width = sheet.height = 0;
      })
    );
  }


  /* ==========================================================
     STARTING UP
     ========================================================== */

  // The photo is copied to a canvas, no bigger than a browser can handle safely
  function toCanvas(img, maxSide, maxArea) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const k = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxArea / (w * h)));
    const c = newCanvas(w * k, h * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    drawSmooth(x, img, 0, 0, c.width, c.height);
    return c;
  }

  const tool = createTool(section.id.replace('tool-', ''), ({ img, file }) => {
    state.file = file;
    resetCutout();
    state.src = toCanvas(img, 4096, 16e6);
    state.prev = Math.max(state.src.width, state.src.height) > 1600
      ? toCanvas(img, 1600, 4e6)
      : state.src;
    if (zipOut) zipOut.hidden = true;
    if (sheetBox) el('fx-sheet-out').hidden = true;
    freeUrls(zipUrls);
    freeUrls(sheetUrls);

    resetPosition();
    layout();
    showMinis();
    syncDragButtons();
    updateSheetOptions();
    requestRender();
  });

  buildPresetChips();

  // The list of sizes under the tool
  function buildSizeGuide() {
    if (!guideBody) return;
    cfg.presets.filter((p) => !p.custom).forEach((p) => {
      const row = document.createElement('tr');
      const size = p.wmm
        ? `${fmtMm(p.wmm)} × ${fmtMm(p.hmm)} mm`
        : `${p.w} × ${p.h} px`;
      const shape = p.wmm ? `${mmToPx(p.wmm, 300)} × ${mmToPx(p.hmm, 300)} px at 300 dpi` : ratioText(p.w, p.h);
      [p.label, size, shape].forEach((text) => {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      });
      guideBody.append(row);
    });
  }

  // Set up the controls to match this tool
  function initControls() {
    if (cfg.text) syncDragButtons();

    // Background chips
    if (bgBox) {
      bgBox.innerHTML = '';
      cfg.bgs.forEach((value) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.dataset.bg = value;
        b.textContent = { blur: 'Blurred photo', clear: 'See-through' }[value] ||
          { '#ffffff': 'White', '#14181b': 'Black', '#e6e8ea': 'Light grey', '#c8dff5': 'Light blue', '#d9483b': 'Red' }[value] || value;
        if (value.startsWith('#')) b.style.setProperty('--dot', value);
        b.setAttribute('aria-pressed', 'false');
        bgBox.append(b);
      });
      setBackground(state.bg.mode, state.bg.color);
    }

    // Format
    formatSelect.value = cfg.format;
    syncFormat();

    // File size limit chips
    if (kbBox) {
      kbBox.innerHTML = '<button class="chip" type="button" data-kb="0">No limit</button>';
      (cfg.kb || []).forEach((n) => {
        kbBox.insertAdjacentHTML('beforeend',
          `<button class="chip" type="button" data-kb="${n}">${n >= 1000 ? (n / 1000) + ' MB' : n + ' KB'}</button>`);
      });
      maxKbInput.value = cfg.kbValue || '';
      syncKbChips();
    }

    if (shapeBox) pressChip(shapeBox, 'shape', state.shape);
    pressChip(fitBox, 'fit', state.fit);
    if (dragBox) pressChip(dragBox, 'drag', 'photo');
    if (ringInput) ringOut.textContent = ringInput.value;
    guidesBox.checked = true;

    selectPreset(cfg.defaultPreset);
    buildSizeGuide();
  }

  initControls();

  // The preview follows the width of the page (phones turning, windows resizing)
  if (window.ResizeObserver) {
    let last = 0;
    new ResizeObserver(() => {
      const width = stage.clientWidth;
      if (Math.abs(width - last) > 1) {
        last = width;
        layout();
      }
    }).observe(stage);
  } else {
    window.addEventListener('resize', layout);
  }

})();
