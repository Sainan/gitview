// AI-generated stuff based on https://github.com/PlutoLang/pluto-zip/blob/senpai/zip.pluto#L106-L125
// Yeah, this is 100 lines of JavaScript just to do what Pluto does in 20...

function textEncoder() {
  return new TextEncoder();
}
function toU8(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return textEncoder().encode(data);
  throw new TypeError("File content must be Uint8Array or string");
}
function writeU16LE(arr, v) {
  arr.push(v & 0xff, (v >>> 8) & 0xff);
}
function writeU32LE(arr, v) {
  arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}
function writeBytes(arr, u8) {
  for (let i = 0; i < u8.length; i++) arr.push(u8[i]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++)
    c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zipCreate(files) {
  const out = [];
  const offsets = new Map();
  const fileMeta = [];

  // compress each file first so we know sizes
  for (const [pathRaw, contentRaw] of files) {
    const path = String(pathRaw);
    const nameU8 = toU8(path);
    const data = toU8(contentRaw);
    const crc = crc32(data);
    const comp = await deflateRaw(data);
    fileMeta.push({ path, nameU8, data, crc, comp });
  }

  // write locals
  for (const f of fileMeta) {
    offsets.set(f.path, out.length);

    writeU32LE(out, 0x04034b50); // local sig
    writeU16LE(out, 20); // version needed (2.0 for deflate)
    writeU16LE(out, 0); // flags
    writeU16LE(out, 8); // method = 8 (deflate)
    writeU16LE(out, 0); // mtime
    writeU16LE(out, 0); // mdate
    writeU32LE(out, f.crc); // crc-32 of ORIGINAL data
    writeU32LE(out, f.comp.length); // compressed size
    writeU32LE(out, f.data.length); // uncompressed size
    writeU16LE(out, f.nameU8.length); // filename length
    writeU16LE(out, 0); // extra length
    writeBytes(out, f.nameU8); // filename
    writeBytes(out, f.comp); // compressed data
  }

  const centralDirOffset = out.length;

  // central directory
  for (const f of fileMeta) {
    writeU32LE(out, 0x02014b50); // central sig
    writeU16LE(out, 0); // version made by
    writeU16LE(out, 20); // version needed
    writeU16LE(out, 0); // flags
    writeU16LE(out, 8); // method
    writeU16LE(out, 0); // mtime
    writeU16LE(out, 0); // mdate
    writeU32LE(out, f.crc); // crc
    writeU32LE(out, f.comp.length); // comp size
    writeU32LE(out, f.data.length); // uncomp size
    writeU16LE(out, f.nameU8.length); // name len
    writeU16LE(out, 0); // extra len
    writeU16LE(out, 0); // comment len
    writeU16LE(out, 0); // disk start
    writeU16LE(out, 0); // internal attrs
    writeU32LE(out, 0); // external attrs
    writeU32LE(out, offsets.get(f.path)); // rel offset
    writeBytes(out, f.nameU8);
  }

  const centralDirSize = out.length - centralDirOffset;

  writeU32LE(out, 0x06054b50); // EOCD
  writeU16LE(out, 0);
  writeU16LE(out, 0);
  writeU16LE(out, fileMeta.length);
  writeU16LE(out, fileMeta.length);
  writeU32LE(out, centralDirSize);
  writeU32LE(out, centralDirOffset);
  writeU16LE(out, 0); // comment len

  return new Uint8Array(out);
}

async function deflateRaw(u8) {
  const stream = new Blob([u8])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

async function zipDownload(name, files) {
  const zipData = await zipCreate(files);

  const blob = new Blob([zipData], { type: "application/zip" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}
