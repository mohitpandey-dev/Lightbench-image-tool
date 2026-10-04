'use strict';

/* ==========================================================
   Lightbench: Tools sidebar.

   A button in the header opens a panel on the left that lists every
   tool, grouped, with a search box. It replaces the old "All tools"
   dropdown on every page. Press Escape, tap the dark area or tap
   Close to shut it.

   To add or rename a tool, edit GROUPS below (one place for the
   whole site).
   ========================================================== */

(function initSidebar() {
  const GROUPS = [
  {
    "cls": "g-edit",
    "title": "Everyday edits",
    "items": [
      [
        "resize.html",
        "Resize"
      ],
      [
        "compress.html",
        "Compress"
      ],
      [
        "convert.html",
        "Convert"
      ],
      [
        "crop.html",
        "Crop"
      ],
      [
        "rotate.html",
        "Rotate"
      ],
      [
        "background-remover.html",
        "Remove Background"
      ],
      [
        "background-blur.html",
        "Blur Background"
      ],
      [
        "background-changer.html",
        "Change Background"
      ],
      [
        "base64.html",
        "To Base64"
      ]
    ]
  },
  {
    "cls": "g-docs",
    "title": "PDFs and layouts",
    "items": [
      [
        "image-to-pdf.html",
        "Image to PDF"
      ],
      [
        "pdf-to-image.html",
        "PDF to Image"
      ],
      [
        "compress-pdf.html",
        "Compress PDF"
      ],
      [
        "jpg-to-pdf.html",
        "JPG to PDF"
      ],
      [
        "png-to-pdf.html",
        "PNG to PDF"
      ],
      [
        "screenshot-to-pdf.html",
        "Screenshot to PDF"
      ],
      [
        "collage-maker.html",
        "Collage Maker"
      ],
      [
        "contact-sheet.html",
        "Contact Sheet"
      ],
      [
        "sprite-sheet.html",
        "Sprite Sheet"
      ]
    ]
  },
  {
    "cls": "g-social",
    "title": "Sizes for forms and social media",
    "items": [
      [
        "passport-photo-maker.html",
        "Passport Photo"
      ],
      [
        "id-photo-maker.html",
        "ID Photo"
      ],
      [
        "profile-picture-maker.html",
        "Profile Picture"
      ],
      [
        "instagram-image-resizer.html",
        "Instagram"
      ],
      [
        "youtube-thumbnail-maker.html",
        "YouTube Thumbnail"
      ],
      [
        "facebook-cover-resizer.html",
        "Facebook Cover"
      ],
      [
        "linkedin-image-resizer.html",
        "LinkedIn"
      ],
      [
        "twitter-image-resizer.html",
        "X / Twitter"
      ],
      [
        "whatsapp-dp-maker.html",
        "WhatsApp DP"
      ]
    ]
  },
  {
    "cls": "g-text",
    "title": "Text and photo details",
    "items": [
      [
        "image-to-text.html",
        "Image to Text"
      ],
      [
        "screenshot-to-text.html",
        "Screenshot to Text"
      ],
      [
        "handwriting-to-text.html",
        "Handwriting to Text"
      ],
      [
        "text-to-handwriting.html",
        "Text to Handwriting"
      ],
      [
        "image-metadata-viewer.html",
        "Metadata Viewer"
      ],
      [
        "exif-viewer.html",
        "EXIF Viewer"
      ],
      [
        "exif-remover.html",
        "EXIF Remover"
      ],
      [
        "image-color-picker.html",
        "Color Picker"
      ],
      [
        "image-palette-generator.html",
        "Palette Generator"
      ]
    ]
  },
  {
    "cls": "g-fun",
    "title": "Meme Tools",
    "items": [
      [
        "meme-generator.html",
        "Meme Generator"
      ],
      [
        "meme-maker.html",
        "Meme Maker"
      ],
      [
        "add-text-to-image.html",
        "Add Text to Image"
      ],
      [
        "meme-templates.html",
        "Meme Templates"
      ],
      [
        "reaction-meme-maker.html",
        "Reaction Meme Maker"
      ],
      [
        "gif-meme-maker.html",
        "GIF Meme Maker"
      ],
      [
        "caption-generator.html",
        "Caption Generator"
      ],
      [
        "image-to-meme.html",
        "Image to Meme"
      ],
      [
        "demotivational-meme-maker.html",
        "Demotivational Meme Maker"
      ],
      [
        "gif-maker.html",
        "GIF Maker"
      ]
    ]
  }
];

  const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  const el = (tag, attrs = {}, text) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text) node.textContent = text;
    return node;
  };

  /* ---------- The panel ---------- */

  const overlay = el('div', { class: 'sb-overlay', hidden: '' });
  const panel = el('aside', {
    class: 'sb-panel', id: 'sb-panel', role: 'dialog', 'aria-modal': 'true',
    'aria-label': 'All tools', hidden: '', tabindex: '-1'
  });

  const top = el('div', { class: 'sb-top' });
  top.append(el('p', { class: 'sb-heading' }, 'All tools'));
  const closeBtn = el('button', { class: 'sb-close', type: 'button', 'aria-label': 'Close the tools list' }, '\u00d7');
  top.append(closeBtn);

  const search = el('input', {
    class: 'sb-search', type: 'search', placeholder: 'Search tools',
    'aria-label': 'Search tools', autocomplete: 'off', spellcheck: 'false'
  });

  const nav = el('nav', { class: 'sb-nav', 'aria-label': 'Tools' });
  const empty = el('p', { class: 'sb-empty', hidden: '' }, 'No tool matches that.');

  const home = el('a', { class: 'sb-home', href: 'index.html' }, 'Home');
  if (here === 'index.html' || here === '') home.setAttribute('aria-current', 'page');
  nav.append(home);

  const sections = GROUPS.map((g) => {
    const section = el('section', { class: 'sb-group ' + g.cls });
    section.append(el('h2', { class: 'sb-title' }, g.title));
    const list = el('ul');
    const rows = g.items.map(([href, label]) => {
      const li = el('li');
      const a = el('a', { href }, label);
      if (href.toLowerCase() === here) a.setAttribute('aria-current', 'page');
      else { a.target = '_blank'; a.rel = 'noopener'; }   // like the old menu: keeps your work open here
      li.append(a);
      list.append(li);
      return { li, text: (label + ' ' + href.replace('.html', '').replace(/-/g, ' ')).toLowerCase() };
    });
    section.append(list);
    nav.append(section);
    return { section, rows };
  });

  panel.append(top, search, nav, empty);
  document.body.append(overlay, panel);

  /* ---------- Search ---------- */

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    sections.forEach(({ section, rows }) => {
      let any = 0;
      rows.forEach(({ li, text }) => {
        const ok = !q || text.includes(q);
        li.hidden = !ok;
        if (ok) any++;
      });
      section.hidden = any === 0;
      shown += any;
    });
    home.hidden = Boolean(q);
    empty.hidden = shown !== 0;
  });

  /* ---------- Opening and closing ---------- */

  let opener = null;
  const buttons = [];

  function open(from) {
    opener = from || buttons[0];
    overlay.hidden = false;
    panel.hidden = false;
    // next frame, so the slide-in animation runs
    requestAnimationFrame(() => {
      document.documentElement.classList.add('sb-open');
      panel.focus();
    });
    document.documentElement.classList.add('sb-lock');
    buttons.forEach((b) => b.setAttribute('aria-expanded', 'true'));
  }

  function close() {
    if (panel.hidden) return;
    document.documentElement.classList.remove('sb-open', 'sb-lock');
    buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    const finish = () => { overlay.hidden = true; panel.hidden = true; };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else setTimeout(finish, 200);
    if (opener) opener.focus();
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
  nav.addEventListener('click', (event) => {
    // choosing the page you are already on just closes the panel
    const a = event.target.closest('a');
    if (a && a.getAttribute('aria-current') === 'page') {
      event.preventDefault();
      close();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (panel.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    // keep Tab inside the panel while it is open
    const items = Array.from(panel.querySelectorAll('button, input, a[href]'))
      .filter((n) => !n.closest('[hidden]') && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  /* ---------- The button in the header ---------- */

  function makeButton() {
    const b = el('button', {
      class: 'sb-btn', type: 'button', 'aria-haspopup': 'dialog',
      'aria-controls': 'sb-panel', 'aria-expanded': 'false'
    });
    b.append(el('span', { class: 'sb-burger', 'aria-hidden': 'true' }), document.createTextNode('All tools'));
    b.addEventListener('click', () => open(b));
    buttons.push(b);
    return b;
  }

  const oldMenu = document.querySelector('.menu');
  const headInner = document.querySelector('.head-inner');
  const button = makeButton();
  if (oldMenu) oldMenu.replaceWith(button);                // swap the old dropdown for the sidebar button
  else if (headInner) {
    const brand = headInner.querySelector('.brand');
    if (brand) brand.after(button); else headInner.prepend(button);
  } else {
    button.classList.add('sb-floating');                   // pages without a header
    document.body.prepend(button);
  }

})();
