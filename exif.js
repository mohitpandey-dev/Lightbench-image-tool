'use strict';

/* ==========================================================
   Lightbench: Image Metadata Viewer, EXIF Viewer, EXIF Remover.

   LBExif (below) reads the EXIF, GPS and text metadata out of
   a JPEG, PNG or WebP file, entirely by walking the file's own
   binary structure. It never draws the image or asks a server,
   so it also works on files a browser cannot display.

   LBExif.strip removes the metadata blocks from a JPEG or PNG
   without re-encoding the picture, so the pixels are untouched.
   ========================================================== */

(function (root) {
  const LBExif = {};


  /* ---------- Tag dictionaries ---------- */

  const IFD0_TAGS = {
    0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Orientation',
    0x011a: 'XResolution', 0x011b: 'YResolution', 0x0128: 'ResolutionUnit',
    0x0131: 'Software', 0x0132: 'DateTime', 0x013b: 'Artist', 0x0213: 'YCbCrPositioning',
    0x8298: 'Copyright', 0x8769: 'ExifIFD', 0x8825: 'GPSIFD'
  };

  const EXIF_TAGS = {
    0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram',
    0x8827: 'ISOSpeedRatings', 0x8830: 'SensitivityType', 0x9000: 'ExifVersion',
    0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized', 0x9101: 'ComponentsConfiguration',
    0x9201: 'ShutterSpeedValue', 0x9202: 'ApertureValue', 0x9203: 'BrightnessValue',
    0x9204: 'ExposureBiasValue', 0x9205: 'MaxApertureValue', 0x9206: 'SubjectDistance',
    0x9207: 'MeteringMode', 0x9208: 'LightSource', 0x9209: 'Flash', 0x920a: 'FocalLength',
    0x927c: 'MakerNote', 0x9286: 'UserComment', 0xa000: 'FlashpixVersion',
    0xa001: 'ColorSpace', 0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension',
    0xa20e: 'FocalPlaneXResolution', 0xa20f: 'FocalPlaneYResolution',
    0xa215: 'ExposureIndex', 0xa217: 'SensingMethod', 0xa300: 'FileSource',
    0xa301: 'SceneType', 0xa401: 'CustomRendered', 0xa402: 'ExposureMode',
    0xa403: 'WhiteBalance', 0xa404: 'DigitalZoomRatio', 0xa405: 'FocalLengthIn35mmFilm',
    0xa406: 'SceneCaptureType', 0xa407: 'GainControl', 0xa408: 'Contrast',
    0xa409: 'Saturation', 0xa40a: 'Sharpness', 0xa432: 'LensSpecification',
    0xa433: 'LensMake', 0xa434: 'LensModel'
  };

  const GPS_TAGS = {
    0x0000: 'GPSVersionID', 0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef',
    0x0006: 'GPSAltitude', 0x0007: 'GPSTimeStamp', 0x0008: 'GPSSatellites',
    0x000b: 'GPSDOP', 0x000c: 'GPSSpeedRef', 0x000d: 'GPSSpeed',
    0x0010: 'GPSImgDirectionRef', 0x0011: 'GPSImgDirection', 0x0012: 'GPSMapDatum',
    0x001d: 'GPSDateStamp'
  };

  const LABELS = {
    ImageDescription: 'Description', Make: 'Camera make', Model: 'Camera model',
    Orientation: 'Orientation', XResolution: 'Horizontal resolution', YResolution: 'Vertical resolution',
    ResolutionUnit: 'Resolution unit', Software: 'Software', DateTime: 'File changed',
    Artist: 'Artist', Copyright: 'Copyright', ExposureTime: 'Exposure time', FNumber: 'Aperture',
    ExposureProgram: 'Exposure program', ISOSpeedRatings: 'ISO speed', ExifVersion: 'Exif version',
    DateTimeOriginal: 'Date taken', DateTimeDigitized: 'Date digitised',
    ShutterSpeedValue: 'Shutter speed', ApertureValue: 'Aperture value', BrightnessValue: 'Brightness',
    ExposureBiasValue: 'Exposure bias', MaxApertureValue: 'Max aperture', SubjectDistance: 'Subject distance',
    MeteringMode: 'Metering mode', LightSource: 'Light source', Flash: 'Flash', FocalLength: 'Focal length',
    UserComment: 'Comment', ColorSpace: 'Colour space', PixelXDimension: 'Pixel width',
    PixelYDimension: 'Pixel height', SensingMethod: 'Sensing method', FileSource: 'File source',
    CustomRendered: 'Custom rendered', ExposureMode: 'Exposure mode', WhiteBalance: 'White balance',
    DigitalZoomRatio: 'Digital zoom', FocalLengthIn35mmFilm: 'Focal length (35 mm equivalent)',
    SceneCaptureType: 'Scene type', Contrast: 'Contrast', Saturation: 'Saturation', Sharpness: 'Sharpness',
    LensMake: 'Lens make', LensModel: 'Lens model', LensSpecification: 'Lens',
    GPSLatitude: 'Latitude', GPSLongitude: 'Longitude', GPSAltitude: 'Altitude',
    GPSTimeStamp: 'Time (UTC)', GPSDateStamp: 'Date (UTC)', GPSSpeed: 'Speed',
    GPSImgDirection: 'Direction facing', GPSMapDatum: 'Map datum'
  };


  /* ---------- Reading TIFF/Exif data ---------- */

  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function readRational(view, pos, little, signed) {
    const num = signed ? view.getInt32(pos, little) : view.getUint32(pos, little);
    const den = signed ? view.getInt32(pos + 4, little) : view.getUint32(pos + 4, little);
    return { num, den, value: den ? num / den : 0 };
  }

  function readValues(view, tiffStart, type, count, fieldPos, little) {
    const size = TYPE_SIZE[type] || 1;
    const total = size * count;
    const pos = total <= 4 ? fieldPos : tiffStart + view.getUint32(fieldPos, little);
    if (pos < 0 || pos + total > view.byteLength) return null;

    if (type === 2) { // ASCII
      const bytes = new Uint8Array(view.buffer, view.byteOffset + pos, count);
      let end = bytes.indexOf(0);
      if (end === -1) end = bytes.length;
      return new TextDecoder('latin1').decode(bytes.subarray(0, end));
    }
    if (type === 7) { // UNDEFINED: raw bytes
      return new Uint8Array(view.buffer, view.byteOffset + pos, count).slice();
    }

    const out = [];
    for (let i = 0; i < count; i++) {
      const p = pos + i * size;
      if (type === 1) out.push(view.getUint8(p));
      else if (type === 3) out.push(view.getUint16(p, little));
      else if (type === 4) out.push(view.getUint32(p, little));
      else if (type === 5) out.push(readRational(view, p, little, false));
      else if (type === 6) out.push(view.getInt8(p));
      else if (type === 8) out.push(view.getInt16(p, little));
      else if (type === 9) out.push(view.getInt32(p, little));
      else if (type === 10) out.push(readRational(view, p, little, true));
      else if (type === 11) out.push(view.getFloat32(p, little));
      else if (type === 12) out.push(view.getFloat64(p, little));
      else out.push(null);
    }
    return count === 1 ? out[0] : out;
  }

  // Reads one IFD (a flat list of tags). Returns {tags: Map<number, value>, next: offset}
  function readIFD(view, tiffStart, offset, little) {
    const tags = new Map();
    if (offset <= 0 || tiffStart + offset + 2 > view.byteLength) return { tags, next: 0 };
    const n = view.getUint16(tiffStart + offset, little);
    let pos = tiffStart + offset + 2;
    for (let i = 0; i < n && pos + 12 <= view.byteLength; i++, pos += 12) {
      const tag = view.getUint16(pos, little);
      const type = view.getUint16(pos + 2, little);
      const count = view.getUint32(pos + 4, little);
      if (!TYPE_SIZE[type] || count > 200000) continue;
      try {
        tags.set(tag, readValues(view, tiffStart, type, count, pos + 8, little));
      } catch (error) { /* a malformed tag should not stop the rest of the photo */ }
    }
    const nextPos = tiffStart + offset + 2 + n * 12;
    const next = nextPos + 4 <= view.byteLength ? view.getUint32(nextPos, little) : 0;
    return { tags, next };
  }

  // Parses a whole TIFF/Exif block (the bytes after "Exif\0\0", or a PNG eXIf / WebP EXIF chunk)
  function parseTiff(view, tiffStart) {
    if (tiffStart + 8 > view.byteLength) return null;
    const b0 = view.getUint8(tiffStart);
    const b1 = view.getUint8(tiffStart + 1);
    let little;
    if (b0 === 0x49 && b1 === 0x49) little = true;
    else if (b0 === 0x4d && b1 === 0x4d) little = false;
    else return null;
    if (view.getUint16(tiffStart + 2, little) !== 42) return null;

    const ifd0Offset = view.getUint32(tiffStart + 4, little);
    const ifd0 = readIFD(view, tiffStart, ifd0Offset, little).tags;
    let exifIFD = new Map();
    let gpsIFD = new Map();
    if (ifd0.has(0x8769)) exifIFD = readIFD(view, tiffStart, ifd0.get(0x8769), little).tags;
    if (ifd0.has(0x8825)) gpsIFD = readIFD(view, tiffStart, ifd0.get(0x8825), little).tags;
    return { ifd0, exifIFD, gpsIFD, little };
  }


  /* ---------- Turning raw tags into readable rows ---------- */

  function toDecimal(v) {
    if (v && typeof v === 'object' && 'value' in v) return v.value;
    return v;
  }

  function formatExposureTime(v) {
    const n = toDecimal(v);
    if (!n) return null;
    return n >= 1 ? `${n.toFixed(n % 1 ? 1 : 0)} s` : `1/${Math.round(1 / n)} s`;
  }

  function formatOrientation(n) {
    const map = {
      1: 'Normal', 2: 'Flipped left-right', 3: 'Rotated 180\u00b0', 4: 'Flipped top-bottom',
      5: 'Flipped and rotated 90\u00b0 CW', 6: 'Rotated 90\u00b0 CW',
      7: 'Flipped and rotated 90\u00b0 CCW', 8: 'Rotated 90\u00b0 CCW'
    };
    return map[n] || `Value ${n}`;
  }

  function formatFlash(n) {
    if (n == null) return null;
    if ((n & 0x1) === 0) return 'Did not fire';
    if (n & 0x40) return 'Fired (auto)';
    return 'Fired';
  }

  const LOOKUPS = {
    Orientation: formatOrientation,
    ResolutionUnit: (n) => ({ 1: 'None', 2: 'Inches', 3: 'Centimetres' }[n] || n),
    ExposureProgram: (n) => ({
      0: 'Not defined', 1: 'Manual', 2: 'Normal', 3: 'Aperture priority', 4: 'Shutter priority',
      5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape'
    }[n] || n),
    MeteringMode: (n) => ({
      0: 'Unknown', 1: 'Average', 2: 'Centre-weighted', 3: 'Spot', 4: 'Multi-spot',
      5: 'Pattern', 6: 'Partial', 255: 'Other'
    }[n] || n),
    LightSource: (n) => ({ 0: 'Unknown', 1: 'Daylight', 2: 'Fluorescent', 3: 'Tungsten', 4: 'Flash', 9: 'Fine weather', 10: 'Cloudy', 11: 'Shade' }[n] || n),
    Flash: formatFlash,
    ColorSpace: (n) => (n === 1 ? 'sRGB' : n === 0xffff ? 'Uncalibrated' : n),
    ExposureMode: (n) => ({ 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' }[n] || n),
    WhiteBalance: (n) => ({ 0: 'Auto', 1: 'Manual' }[n] || n),
    SceneCaptureType: (n) => ({ 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night scene' }[n] || n),
    Contrast: (n) => ({ 0: 'Normal', 1: 'Soft', 2: 'Hard' }[n] || n),
    Saturation: (n) => ({ 0: 'Normal', 1: 'Low', 2: 'High' }[n] || n),
    Sharpness: (n) => ({ 0: 'Normal', 1: 'Soft', 2: 'Hard' }[n] || n),
    ExposureTime: formatExposureTime,
    FNumber: (v) => { const n = toDecimal(v); return n ? `f/${n.toFixed(n % 1 ? 1 : 0)}` : null; },
    ApertureValue: (v) => { const n = toDecimal(v); return n ? `f/${Math.pow(2, n / 2).toFixed(1)}` : null; },
    MaxApertureValue: (v) => { const n = toDecimal(v); return n ? `f/${Math.pow(2, n / 2).toFixed(1)}` : null; },
    FocalLength: (v) => { const n = toDecimal(v); return n != null ? `${n.toFixed(n % 1 ? 1 : 0)} mm` : null; },
    FocalLengthIn35mmFilm: (n) => (n ? `${n} mm` : null),
    DigitalZoomRatio: (v) => { const n = toDecimal(v); return n ? `${n.toFixed(1)}\u00d7` : 'None'; },
    ISOSpeedRatings: (v) => (Array.isArray(v) ? v.join(', ') : v),
    LensSpecification: (v) => (Array.isArray(v)
      ? `${toDecimal(v[0]).toFixed(0)}\u2013${toDecimal(v[1]).toFixed(0)} mm`
      : v),
    UserComment: (v) => decodeUserComment(v),
    ExifVersion: (v) => decodeVersionBytes(v),
    FlashpixVersion: (v) => decodeVersionBytes(v),
    GPSSpeed: (v) => { const n = toDecimal(v); return n != null ? n.toFixed(1) : null; }
  };

  function decodeVersionBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) return bytes;
    return Array.from(bytes).map((b) => String.fromCharCode(b)).join('').replace(/^0*/, '') || '0';
  }

  function decodeUserComment(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
    const header = Array.from(bytes.subarray(0, 8)).map((b) => String.fromCharCode(b)).join('');
    const rest = bytes.subarray(8);
    try {
      if (header.startsWith('ASCII')) return new TextDecoder('latin1').decode(rest).replace(/\0+$/, '');
      if (header.startsWith('UNICODE')) return new TextDecoder('utf-16le').decode(rest).replace(/\0+$/, '');
      return new TextDecoder('utf-8').decode(rest).replace(/\0+$/, '') || null;
    } catch (error) {
      return null;
    }
  }

  function dmsToDecimal(dms, ref) {
    if (!Array.isArray(dms) || dms.length < 3) return null;
    const [d, m, s] = dms.map(toDecimal);
    let value = d + m / 60 + s / 3600;
    if (ref === 'S' || ref === 'W') value = -value;
    return value;
  }

  function formatCoord(value, isLat) {
    const dir = value >= 0 ? (isLat ? 'N' : 'E') : (isLat ? 'S' : 'W');
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = (minFloat - min) * 60;
    return `${abs.toFixed(6)}\u00b0 (${deg}\u00b0 ${min}\u2032 ${sec.toFixed(1)}\u2033 ${dir})`;
  }

  // Turns a Map of raw tags into an array of {tag, label, text} rows, skipping unreadable ones
  function rowsFromTags(tags, dict) {
    const rows = [];
    tags.forEach((value, tagId) => {
      const name = dict[tagId];
      if (!name || value == null) return;
      if (name === 'ExifIFD' || name === 'GPSIFD' || name === 'MakerNote') return;
      let text;
      try {
        text = LOOKUPS[name] ? LOOKUPS[name](value) : (Array.isArray(value)
          ? value.map(toDecimal).join(', ')
          : toDecimal(value));
      } catch (error) {
        text = null;
      }
      if (text == null || text === '') return;
      rows.push({ tag: name, label: LABELS[name] || name, text: String(text) });
    });
    return rows;
  }

  function gpsSummary(gpsIFD) {
    if (!gpsIFD || !gpsIFD.size) return null;
    const lat = dmsToDecimal(gpsIFD.get(0x0002), gpsIFD.get(0x0001));
    const lon = dmsToDecimal(gpsIFD.get(0x0004), gpsIFD.get(0x0003));
    if (lat == null || lon == null) return null;
    let altitude = null;
    if (gpsIFD.has(0x0006)) {
      const alt = toDecimal(gpsIFD.get(0x0006));
      altitude = gpsIFD.get(0x0005) === 1 ? -alt : alt;
    }
    return {
      lat, lon, altitude,
      latText: formatCoord(lat, true),
      lonText: formatCoord(lon, false),
      mapUrl: `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=15/${lat.toFixed(6)}/${lon.toFixed(6)}`
    };
  }

  function summarise(tiff) {
    if (!tiff) return { camera: [], exposure: [], other: [], gps: null, rows: [] };
    const camera = rowsFromTags(tiff.ifd0, IFD0_TAGS);
    const exposure = rowsFromTags(tiff.exifIFD, EXIF_TAGS);
    const gps = gpsSummary(tiff.gpsIFD);
    return { camera, exposure, gps, rows: camera.concat(exposure) };
  }


  /* ---------- JPEG ---------- */

  const METADATA_MARKERS_DEFAULT = new Set([0xe1, 0xed, 0xfe]); // Exif/XMP, Photoshop/IPTC, comment
  const ICC_MARKER = 0xe2;

  function jpegSegments(view) {
    if (view.getUint16(0, false) !== 0xffd8) throw new Error('This does not look like a JPEG file.');
    const segments = [];
    let pos = 2;
    while (pos + 4 <= view.byteLength) {
      if (view.getUint8(pos) !== 0xff) throw new Error('This JPEG file is not structured the way Lightbench expects.');
      const marker = view.getUint8(pos + 1);
      const start = pos;
      pos += 2;
      if (marker === 0xd9) { segments.push({ marker, start, end: pos, kind: 'eoi' }); break; }
      if (marker === 0xda) { segments.push({ marker, start, end: view.byteLength, kind: 'scan' }); break; }
      if (marker >= 0xd0 && marker <= 0xd7) { segments.push({ marker, start, end: pos, kind: 'marker' }); continue; }
      if (pos + 2 > view.byteLength) break;
      const length = view.getUint16(pos, false);
      const end = pos + length;
      segments.push({ marker, start, end, dataStart: pos + 2, dataLength: length - 2, kind: 'segment' });
      pos = end;
    }
    return segments;
  }

  function segmentBytes(view, seg) {
    return new Uint8Array(view.buffer, view.byteOffset + seg.dataStart, seg.dataLength);
  }

  function ascii(bytes, count) {
    return Array.from(bytes.subarray(0, count)).map((b) => String.fromCharCode(b)).join('');
  }

  function parseJpeg(buffer) {
    const view = new DataView(buffer);
    const segments = jpegSegments(view);
    let tiff = null;
    let xmp = null;
    let iptc = false;
    let icc = false;
    let sof = null;

    segments.forEach((seg) => {
      if (seg.kind !== 'segment') return;
      const bytes = segmentBytes(view, seg);
      if (seg.marker === 0xe1 && ascii(bytes, 6) === 'Exif\0\0' && !tiff) {
        tiff = parseTiff(view, seg.dataStart + 6);
      } else if (seg.marker === 0xe1 && ascii(bytes, 29) === 'http://ns.adobe.com/xap/1.0/\0') {
        xmp = true;
      } else if (seg.marker === 0xed) {
        iptc = true;
      } else if (seg.marker === ICC_MARKER && ascii(bytes, 11) === 'ICC_PROFILE') {
        icc = true;
      } else if (seg.marker >= 0xc0 && seg.marker <= 0xcf && seg.marker !== 0xc4 && seg.marker !== 0xc8 && seg.marker !== 0xcc && !sof) {
        sof = {
          progressive: seg.marker === 0xc2,
          bits: bytes[0],
          height: (bytes[1] << 8) | bytes[2],
          width: (bytes[3] << 8) | bytes[4],
          components: bytes[5]
        };
      }
    });

    return { format: 'JPEG', segments, ...summarise(tiff), hasExif: Boolean(tiff), xmp, iptc, icc, sof };
  }

  function stripJpeg(buffer, options) {
    const view = new DataView(buffer);
    const segments = jpegSegments(view);
    const removeIcc = Boolean(options && options.removeIcc);
    const removed = [];
    const keep = [];
    segments.forEach((seg) => {
      if (seg.kind === 'segment' && METADATA_MARKERS_DEFAULT.has(seg.marker)) {
        removed.push(seg.marker); return;
      }
      if (seg.kind === 'segment' && seg.marker === ICC_MARKER && removeIcc) {
        const bytes = segmentBytes(view, seg);
        if (ascii(bytes, 11) === 'ICC_PROFILE') { removed.push(seg.marker); return; }
      }
      keep.push(seg);
    });
    const bytes = new Uint8Array(buffer);
    const out = [bytes.subarray(0, 2)]; // SOI
    keep.forEach((seg) => out.push(bytes.subarray(seg.start, seg.end)));
    return { blob: new Blob(out, { type: 'image/jpeg' }), removedCount: removed.length };
  }


  /* ---------- PNG ---------- */

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const PNG_METADATA_TYPES = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

  function pngChunks(view) {
    for (let i = 0; i < 8; i++) if (view.getUint8(i) !== PNG_SIG[i]) throw new Error('This does not look like a PNG file.');
    const chunks = [];
    let pos = 8;
    while (pos + 8 <= view.byteLength) {
      const length = view.getUint32(pos, false);
      const type = ascii(new Uint8Array(view.buffer, view.byteOffset + pos + 4, 4), 4);
      const dataStart = pos + 8;
      const end = dataStart + length + 4; // + CRC
      if (end > view.byteLength) break;
      chunks.push({ type, start: pos, end, dataStart, length });
      pos = end;
      if (type === 'IEND') break;
    }
    return chunks;
  }

  async function inflateZlib(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (error) {
      return null;
    }
  }

  async function parsePng(buffer) {
    const view = new DataView(buffer);
    const chunks = pngChunks(view);
    let ihdr = null;
    let tiff = null;
    const text = [];

    for (const chunk of chunks) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + chunk.dataStart, chunk.length);
      if (chunk.type === 'IHDR') {
        ihdr = {
          width: view.getUint32(chunk.dataStart, false),
          height: view.getUint32(chunk.dataStart + 4, false),
          bitDepth: bytes[8],
          colorType: bytes[9],
          interlace: bytes[12]
        };
      } else if (chunk.type === 'eXIf' && !tiff) {
        tiff = parseTiff(view, chunk.dataStart);
      } else if (chunk.type === 'tEXt') {
        const nul = bytes.indexOf(0);
        if (nul > -1) text.push({ key: ascii(bytes, nul), value: new TextDecoder('latin1').decode(bytes.subarray(nul + 1)) });
      } else if (chunk.type === 'iTXt') {
        const nul = bytes.indexOf(0);
        if (nul > -1) {
          const key = ascii(bytes, nul);
          const compressed = bytes[nul + 1] === 1;
          let p = nul + 3;
          const langEnd = bytes.indexOf(0, p);
          p = langEnd + 1;
          const keyEnd = bytes.indexOf(0, p);
          const rest = bytes.subarray(keyEnd + 1);
          if (compressed) {
            const inflated = await inflateZlib(rest);
            if (inflated) text.push({ key, value: new TextDecoder('utf-8').decode(inflated) });
          } else {
            text.push({ key, value: new TextDecoder('utf-8').decode(rest) });
          }
        }
      } else if (chunk.type === 'zTXt') {
        const nul = bytes.indexOf(0);
        if (nul > -1) {
          const inflated = await inflateZlib(bytes.subarray(nul + 2));
          if (inflated) text.push({ key: ascii(bytes, nul), value: new TextDecoder('latin1').decode(inflated) });
        }
      }
    }

    const colorNames = { 0: 'Greyscale', 2: 'Truecolour', 3: 'Palette', 4: 'Greyscale with alpha', 6: 'Truecolour with alpha' };
    return {
      format: 'PNG', chunks, ihdr, colorTypeName: ihdr ? colorNames[ihdr.colorType] : null,
      ...summarise(tiff), hasExif: Boolean(tiff), text
    };
  }

  function stripPng(buffer, options) {
    const view = new DataView(buffer);
    const chunks = pngChunks(view);
    const removeIccp = Boolean(options && options.removeIccp);
    const removed = [];
    const keep = [];
    chunks.forEach((chunk) => {
      if (PNG_METADATA_TYPES.has(chunk.type) || (chunk.type === 'iCCP' && removeIccp)) {
        removed.push(chunk.type); return;
      }
      keep.push(chunk);
    });
    const bytes = new Uint8Array(buffer);
    const out = [bytes.subarray(0, 8)]; // signature
    keep.forEach((chunk) => out.push(bytes.subarray(chunk.start, chunk.end)));
    return { blob: new Blob(out, { type: 'image/png' }), removedCount: removed.length };
  }


  /* ---------- WebP ---------- */

  function riffChunks(view) {
    if (ascii(new Uint8Array(view.buffer, view.byteOffset, 4), 4) !== 'RIFF' ||
        ascii(new Uint8Array(view.buffer, view.byteOffset + 8, 4), 4) !== 'WEBP') {
      throw new Error('This does not look like a WebP file.');
    }
    const chunks = [];
    let pos = 12;
    while (pos + 8 <= view.byteLength) {
      const type = ascii(new Uint8Array(view.buffer, view.byteOffset + pos, 4), 4);
      const size = view.getUint32(pos + 4, true);
      const dataStart = pos + 8;
      const padded = size + (size % 2);
      chunks.push({ type, start: pos, dataStart, size, end: dataStart + padded });
      pos = dataStart + padded;
    }
    return chunks;
  }

  function parseWebp(buffer) {
    const view = new DataView(buffer);
    const chunks = riffChunks(view);
    let tiff = null;
    let xmp = false;
    let icc = false;
    chunks.forEach((chunk) => {
      if (chunk.type === 'EXIF' && !tiff) {
        const bytes = new Uint8Array(view.buffer, view.byteOffset + chunk.dataStart, Math.min(6, chunk.size));
        const hasHeader = ascii(bytes, 6) === 'Exif\0\0';
        tiff = parseTiff(view, chunk.dataStart + (hasHeader ? 6 : 0));
      } else if (chunk.type === 'XMP ') {
        xmp = true;
      } else if (chunk.type === 'ICCP') {
        icc = true;
      }
    });
    return { format: 'WebP', chunks, ...summarise(tiff), hasExif: Boolean(tiff), xmp, icc };
  }

  function stripWebp(buffer) {
    const view = new DataView(buffer);
    const chunks = riffChunks(view);
    const removed = [];
    const keep = [];
    chunks.forEach((chunk) => {
      if (chunk.type === 'EXIF' || chunk.type === 'XMP ') { removed.push(chunk.type); return; }
      keep.push(chunk);
    });
    const bytes = new Uint8Array(buffer);
    const parts = [];
    keep.forEach((chunk) => parts.push(bytes.subarray(chunk.start, chunk.end)));
    const dataSize = parts.reduce((sum, p) => sum + p.length, 0);
    const header = new Uint8Array(12);
    const headerView = new DataView(header.buffer);
    header.set([0x52, 0x49, 0x46, 0x46]); // RIFF
    headerView.setUint32(4, 4 + dataSize, true); // "WEBP" + chunks
    header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    return { blob: new Blob([header, ...parts], { type: 'image/webp' }), removedCount: removed.length };
  }


  /* ---------- Public entry points ---------- */

  function sniff(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
    if (bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b)) return 'png';
    if (bytes.length >= 12 && ascii(bytes, 4) === 'RIFF' && ascii(bytes.subarray(8, 12), 4) === 'WEBP') return 'webp';
    return null;
  }

  // Reads whatever metadata is inside the file. Never throws for an unsupported format.
  LBExif.read = async function read(file) {
    const buffer = await file.arrayBuffer();
    const kind = sniff(new Uint8Array(buffer));
    let info;
    if (kind === 'jpeg') info = parseJpeg(buffer);
    else if (kind === 'png') info = await parsePng(buffer);
    else if (kind === 'webp') info = parseWebp(buffer);
    else info = { format: (file.type.split('/')[1] || 'unknown').toUpperCase(), rows: [], camera: [], exposure: [], gps: null };
    info.fileName = file.name;
    info.fileSize = file.size;
    info.fileType = file.type;
    info.kind = kind;
    return info;
  };

  // Returns a cleaned copy of the file with the metadata blocks removed
  LBExif.strip = async function strip(file, options) {
    const buffer = await file.arrayBuffer();
    const kind = sniff(new Uint8Array(buffer));
    if (kind === 'jpeg') return { ...stripJpeg(buffer, options), format: 'JPEG', supported: true };
    if (kind === 'png') return { ...stripPng(buffer, options), format: 'PNG', supported: true };
    if (kind === 'webp') return { ...stripWebp(buffer), format: 'WebP', supported: true };
    return { supported: false };
  };

  root.LBExif = LBExif;
})(window);


/* ==========================================================
   The three pages: viewer UI shared by the metadata viewer and
   the EXIF viewer, and a separate, simpler flow for the remover.
   ========================================================== */

(function () {
  const section = $('[data-exif-tool]');
  if (!section) return;
  const mode = section.dataset.exifTool; // "viewer" or "remover"
  const el = (id) => document.getElementById(id);

  if (mode === 'viewer') {
    const preview = el('ex-preview');
    const summary = el('ex-summary');
    const gpsBox = el('ex-gps');
    const groupsBox = el('ex-groups');
    const emptyNote = el('ex-empty');
    const exportButton = el('ex-export');
    let current = null;

    createTool(section.id.replace('tool-', ''), async ({ img, file }) => {
      preview.src = img.src;
      say(section, 'Reading the file...');
      try {
        current = await LBExif.read(file);
        render(current, img);
        say(section, '');
      } catch (error) {
        say(section, error.message, true);
      }
    });

    function row(label, text) {
      const tr = document.createElement('tr');
      const th = document.createElement('td');
      th.textContent = label;
      const td = document.createElement('td');
      td.textContent = text;
      tr.append(th, td);
      return tr;
    }

    function group(title, rows) {
      if (!rows.length) return null;
      const wrap = document.createElement('div');
      wrap.className = 'exif-group';
      const h = document.createElement('h3');
      h.textContent = title;
      const table = document.createElement('table');
      const body = document.createElement('tbody');
      rows.forEach((r) => body.append(row(r.label, r.text)));
      table.append(body);
      wrap.append(h, table);
      return wrap;
    }

    function render(info, img) {
      groupsBox.innerHTML = '';
      gpsBox.innerHTML = '';

      const fileRows = [
        { label: 'File name', text: info.fileName },
        { label: 'File type', text: info.format },
        { label: 'File size', text: formatBytes(info.fileSize) },
        { label: 'Dimensions', text: `${img.naturalWidth} \u00d7 ${img.naturalHeight} px` }
      ];
      if (info.ihdr) {
        fileRows.push({ label: 'Colour type', text: info.colorTypeName });
        fileRows.push({ label: 'Bit depth', text: `${info.ihdr.bitDepth}-bit` });
      }
      if (info.sof) fileRows.push({ label: 'Encoding', text: info.sof.progressive ? 'Progressive JPEG' : 'Baseline JPEG' });

      summary.innerHTML = '';
      summary.append(group('File', fileRows));

      const found = [];
      if (info.hasExif) found.push('Exif data');
      if (info.xmp) found.push('XMP data');
      if (info.iptc) found.push('IPTC/Photoshop data');
      if (info.icc) found.push('a colour profile');
      if (info.text && info.text.length) found.push('text chunks');

      if (section.dataset.exifDetail === 'full') {
        const cam = group('Camera', info.camera);
        const exp = group('Exposure and settings', info.exposure);
        if (cam) groupsBox.append(cam);
        if (exp) groupsBox.append(exp);
        if (info.text && info.text.length) {
          const g = group('Text stored in the file', info.text.map((t) => ({ label: t.key, text: t.value })));
          if (g) groupsBox.append(g);
        }
      } else {
        const highlights = info.rows.slice(0, 8);
        const g = group('Highlights', highlights);
        if (g) groupsBox.append(g);
      }

      if (info.gps) {
        const g = group('Location', [
          { label: 'Latitude', text: info.gps.latText },
          { label: 'Longitude', text: info.gps.lonText },
          ...(info.gps.altitude != null ? [{ label: 'Altitude', text: `${info.gps.altitude.toFixed(0)} m` }] : [])
        ]);
        if (g) gpsBox.append(g);
        const link = document.createElement('a');
        link.className = 'btn';
        link.href = info.gps.mapUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'View on OpenStreetMap';
        gpsBox.append(link);
      }

      emptyNote.hidden = Boolean(found.length);
      emptyNote.textContent = 'No Exif, GPS or text metadata was found in this file.';
      say(section, found.length ? `Found ${found.join(', ')}.` : 'No embedded metadata was found.');
      exportButton.hidden = !info.rows.length && !info.gps;
    }

    exportButton.addEventListener('click', () => {
      if (!current) return;
      const lines = ['File: ' + current.fileName, 'Format: ' + current.format, ''];
      current.rows.forEach((r) => lines.push(`${r.label}: ${r.text}`));
      if (current.gps) {
        lines.push('', 'Latitude: ' + current.gps.latText, 'Longitude: ' + current.gps.lonText);
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName(current.fileName)}-metadata.txt`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  if (mode === 'remover') {
    const preview = el('ex-preview');
    const foundBox = el('ex-found');
    const removeIcc = el('ex-remove-icc');
    const goButton = el('ex-go');
    const result = el('ex-result');
    let fileRef = null;
    let resultUrl = null;

    createTool(section.id.replace('tool-', ''), async ({ img, file }) => {
      preview.src = img.src;
      fileRef = file;
      result.hidden = true;
      say(section, 'Checking the file...');
      try {
        const info = await LBExif.read(file);
        const found = [];
        if (info.hasExif) found.push('Exif data (camera, date, and often GPS location)');
        if (info.xmp) found.push('XMP data');
        if (info.iptc) found.push('IPTC/Photoshop data');
        if (info.gps) found.push('a precise GPS location');
        if (info.text && info.text.length) found.push('text chunks (' + info.text.map((t) => t.key).join(', ') + ')');
        if (info.icc) foundBox.dataset.hasIcc = '1'; else delete foundBox.dataset.hasIcc;
        foundBox.innerHTML = '';
        if (found.length) {
          const ul = document.createElement('ul');
          found.forEach((f) => { const li = document.createElement('li'); li.textContent = f; ul.append(li); });
          foundBox.append(ul);
          say(section, '');
        } else {
          foundBox.textContent = 'No hidden metadata was found in this file. It is already clean.';
          say(section, '');
        }
        goButton.disabled = kindUnsupported(info);
        if (goButton.disabled) say(section, `Lightbench cannot rewrite ${info.format} files yet, only JPEG, PNG and WebP.`, true);
      } catch (error) {
        say(section, error.message, true);
      }
    });

    function kindUnsupported(info) {
      return !['JPEG', 'PNG', 'WebP'].includes(info.format);
    }

    goButton.addEventListener('click', () =>
      withBusy(goButton, section, async () => {
        if (!fileRef) return;
        const cleaned = await LBExif.strip(fileRef, { removeIcc: removeIcc.checked, removeIccp: removeIcc.checked });
        if (!cleaned.supported) {
          say(section, 'This file type is not supported for cleaning.', true);
          return;
        }
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        resultUrl = URL.createObjectURL(cleaned.blob);
        $('.img-result', result).src = resultUrl;
        $('.cap-result', result).textContent =
          `Cleaned: ${formatBytes(cleaned.blob.size)}, ${cleaned.removedCount} metadata block${cleaned.removedCount === 1 ? '' : 's'} removed`;
        const originalImg = $('.img-original', result);
        if (originalImg) {
          originalImg.src = preview.src;
          $('.cap-original', result).textContent = `Original: ${formatBytes(fileRef.size)}`;
        }
        const link = $('.download', result);
        link.href = resultUrl;
        const ext = { JPEG: 'jpg', PNG: 'png', WebP: 'webp' }[cleaned.format] || 'img';
        link.download = `${baseName(fileRef.name)}-clean.${ext}`;
        result.hidden = false;
        say(section, cleaned.removedCount
          ? 'Done. The picture itself was not re-encoded, so there is no quality loss.'
          : 'Nothing needed removing, but here is a fresh copy of the file.');
      })
    );
  }
})();
