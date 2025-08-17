const tdUtf8 = new TextDecoder("utf-8");

function parseCommit(raw) {
  const { type, body } = parseObjectHeader(raw);
  console.assert(type == "commit");
  return parseCommitBody(body);
}

function parseTree(raw) {
  const { type, body } = parseObjectHeader(raw);
  console.assert(type == "tree");
  return parseTreeBody(body);
}

function parseBlob(raw) {
  const { type, body } = parseObjectHeader(raw);
  console.assert(type == "blob");
  return tdUtf8.decode(body);
}

// AI-generated Git helpers. Would use Gitwit (https://github.com/PlutoLang/gitwit) but Pluto maybe a bit too heavy of a dependency right now.

/**
 * Split a raw Git object into { type, size, body }.
 * raw: Uint8Array of "<type> <size>\0<body>"
 */
function parseObjectHeader(raw) {
  let nul = 0;
  while (nul < raw.length && raw[nul] !== 0x00) nul++;
  if (nul === raw.length)
    throw new Error("Invalid git object: missing NUL header separator");

  const header = tdUtf8.decode(raw.subarray(0, nul)); // e.g. "commit 123"
  const [type, sizeStr] = header.split(" ");
  const size = Number(sizeStr);
  const body = raw.subarray(nul + 1);

  console.assert(Number.isFinite(size) && size === body.length);

  return { type, size, body };
}

/**
 * Convert 20 bytes at offset to a 40-hex SHA-1 string.
 */
function sha1HexAt(bytes, offset) {
  let out = "";
  for (let i = 0; i < 20; i++) {
    const b = bytes[offset + i];
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Binary-safe tree parser.
 * Accepts a Uint8Array body of a 'tree' object (NOT including the "<type> <size>\0" header).
 * Returns [{ mode, name, hash }, ...]
 */
function parseTreeBody(body) {
  const files = [];
  let i = 0;

  while (i < body.length) {
    // mode: ASCII until space (0x20)
    let start = i;
    while (i < body.length && body[i] !== 0x20) i++;
    if (i >= body.length) throw new Error("Malformed tree: unterminated mode");
    const mode = tdUtf8.decode(body.subarray(start, i));
    i++; // skip space

    // name: bytes until NUL (0x00)
    start = i;
    while (i < body.length && body[i] !== 0x00) i++;
    if (i >= body.length) throw new Error("Malformed tree: unterminated name");
    const name = tdUtf8.decode(body.subarray(start, i));
    i++; // skip NUL

    // 20-byte SHA-1
    if (i + 20 > body.length)
      throw new Error("Malformed tree: truncated SHA-1");
    const hash = sha1HexAt(body, i);
    i += 20;

    files.push({ mode, name, hash });
  }

  return files;
}

/**
 * Commit parser: takes a Uint8Array body of a 'commit' object and returns a JS object.
 * Decodes UTF-8 text safely.
 */
function parseCommitBody(body) {
  // Commit objects are textual: headers (ASCII/UTF-8) then "\n\n" then message.
  // We'll parse on bytes to find the first blank line.
  let i = 0;
  const NL = 0x0a; // '\n'
  let sep = -1;

  // Find "\n\n"
  for (let j = 0; j + 1 < body.length; j++) {
    if (body[j] === NL && body[j + 1] === NL) {
      sep = j;
      break;
    }
  }
  const commit = {};
  if (sep === -1) {
    // No blank line: treat entire thing as headers (rare/malformed)
    sep = body.length - 1;
  }

  // Headers
  const headerText = tdUtf8.decode(body.subarray(0, sep));
  const lines = headerText.length ? headerText.split("\n") : [];
  for (const line of lines) {
    const idx = line.indexOf(" ");
    if (idx > 0) {
      const key = line.slice(0, idx);
      const value = line.slice(idx + 1);
      commit[key] = value;
    }
  }

  // Message (strip trailing newlines)
  const msgBytes =
    sep + 2 <= body.length ? body.subarray(sep + 2) : new Uint8Array();
  let message = tdUtf8.decode(msgBytes).replace(/\n+$/, "");
  commit.message = message;

  return commit;
}

async function parseIdx(buf) {
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  const MAGIC = 0xff744f63; // "\xfftOc"
  const magic = view.getUint32(0, false);
  if (magic !== MAGIC) throw new Error("Invalid idx magic");

  const version = view.getUint32(4, false);
  if (version !== 2) throw new Error(`Unsupported idx version: ${version}`);

  let i = 8;

  i += 4 * 255;

  const numObjects = view.getUint32(i, false);
  i += 4;

  const hashes = new Array(numObjects);
  for (let j = 0; j < numObjects; j++) {
    const slice = u8.subarray(i, i + 20);
    let hex = "";
    for (let k = 0; k < slice.length; k++) {
      hex += slice[k].toString(16).padStart(2, "0");
    }
    hashes[j] = hex;
    i += 20;
  }

  i += 4 * numObjects; // CRC32

  const offsets = {};
  for (let j = 0; j < numObjects; j++) {
    const off = view.getUint32(i, false);
    i += 4;
    offsets[hashes[j]] = off;
  }

  const sorted_offsets = Object.values(offsets).slice().sort((a, b) => a - b);

  return { offsets, sorted_offsets };
}

async function readPackObject(buf, offset, sorted_offsets) {
  const u8 = new Uint8Array(buf);

  // --- compute next object offset (end boundary) ---
  // offsets are in PACK order, so sort ascending and find the next one
  const idx = sorted_offsets.findIndex(o => o === offset);
  if (idx < 0) throw new Error("Offset not found in offsets table");
  const nextOffset = (idx + 1 < sorted_offsets.length) ? sorted_offsets[idx + 1] : (u8.length - 20);

  // --- parse header at `offset` ---
  let i = offset;
  let byte = u8[i++];
  let type = (byte >> 4) & 0b111;
  if (type === 0) throw new Error("Invalid pack object (type 0)");

  let length = byte & 0b1111;
  let hasMore = (byte >> 7) !== 0;
  let shift = 4;
  while (hasMore) {
    byte = u8[i++];
    length |= (byte & 0b0111_1111) << shift;
    shift += 7;
    hasMore = (byte >> 7) !== 0;
  }

  let base;
  if (type == 6) {
    let dist = 0;
    byte = u8[i++];
    dist = byte & 0x7f;
    while (byte & 0x80) {
      byte = u8[i++];
      dist = ((dist + 1) << 7) + (byte & 0x7f);
    }
    const baseOffset = offset - dist;
    //console.log("Delta, base at " + baseOffset);
    base = await readPackObject(buf, baseOffset, sorted_offsets);
    //console.log(base);
  }
  else if (type == 7) {
    throw new Error(`OBJ_REF_DELTA is not supported right now`);
  }

  // --- decompress only the bytes up to the next object header ---
  // This avoids the “junk after end” error.
  const compressedSlice = u8.subarray(i, nextOffset);
  const ds = new DecompressionStream("deflate");
  const reader = ds.readable.getReader()
  const writer = ds.writable.getWriter();

  const readPromise = (async () => {
    const out = new Uint8Array(length);
    let filled = 0;
    try {
      do {
        const { value, done } = await reader.read();
        if (done) break;
        const n = Math.min(value.length, length - filled);
        out.set(value.subarray(0, n), filled);
        filled += n;
      } while (filled < length);
    } finally {
      reader.releaseLock();
    }
    if (filled !== length) {
      throw new Error(`Decompressed ${filled} of ${length} bytes`);
    }
    return out;
  })();

  // Feed and close (now that readable is pulling)
  await writer.write(compressedSlice);
  await writer.close();

  let data = await readPromise;
  if (type == 6) {
    type = base.typeid;
    data = applyGitDelta(base.raw_data, data, length);
  }
  return { typeid: type, raw_data: data };
}

function applyGitDelta(base, delta, expectedOutSize) {
  let i = 0;

  // helper: read little-endian 7-bit varint (MSB=continue)
  const readVarint7 = () => {
    let val = 0;
    let shift = 0;
    while (true) {
      if (i >= delta.length) throw new Error("Delta truncated reading varint");
      const b = delta[i++];
      val |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return val >>> 0;
  };

  // 1) skip base size (present but not needed at apply time)
  const baseSize = readVarint7();
  // Optional check (won't always match: base on disk may be compressed differently)
  if (baseSize > 0 && baseSize !== base.length) {
    // Not fatal, but you can enable this if you want strictness:
    // throw new Error(`Base size mismatch: delta=${baseSize}, have=${base.length}`);
  }

  // 2) resulting object size
  const outSize = readVarint7();
  if (expectedOutSize != null && expectedOutSize !== outSize) {
    // Not strictly required, but helpful for catching corruption
    // throw new Error(`Result size mismatch: expected=${expectedOutSize}, deltaHeader=${outSize}`);
  }

  const out = new Uint8Array(outSize);
  let o = 0;

  while (i < delta.length) {
    const insn = delta[i++];

    if ((insn & 0x80) === 0) {
      // insert literal: low 7 bits is count
      const n = insn & 0x7f;
      if (n === 0) continue; // legal no-op
      if (i + n > delta.length) throw new Error("Delta insert overruns input");
      if (o + n > out.length) throw new Error("Delta insert overruns output");
      out.set(delta.subarray(i, i + n), o);
      i += n;
      o += n;
    } else {
      // copy from base; bits in insn select which offset/size bytes follow
      let cpOff = 0;
      let cpLen = 0;

      if (insn & 0x01) cpOff |= delta[i++];
      if (insn & 0x02) cpOff |= delta[i++] << 8;
      if (insn & 0x04) cpOff |= delta[i++] << 16;
      if (insn & 0x08) cpOff |= delta[i++] << 24;

      if (insn & 0x10) cpLen |= delta[i++];
      if (insn & 0x20) cpLen |= delta[i++] << 8;
      if (insn & 0x40) cpLen |= delta[i++] << 16;

      if (cpLen === 0) cpLen = 0x10000; // default when no size bytes

      // bounds
      if (cpOff < 0 || cpLen < 0) throw new Error("Negative copy in delta");
      if (cpOff + cpLen > base.length) throw new Error("Delta copy overruns base");
      if (o + cpLen > out.length) throw new Error("Delta copy overruns output");

      // copy
      out.set(base.subarray(cpOff, cpOff + cpLen), o);
      o += cpLen;
    }
  }

  if (o !== out.length) {
    throw new Error(`Delta application produced ${o} bytes, expected ${out.length}`);
  }
  return out;
}

const TYPE_NAMES = {
  1: "commit",
  2: "tree",
  3: "blob",
};

function buildObject({ typeid, raw_data }) {
  const type = TYPE_NAMES[typeid];
  if (!type) throw new Error(`Unknown/unsupported typeid ${typeid}`);
  const header = `${type} ${raw_data.length}\0`;
  const enc = new TextEncoder();
  const headBytes = enc.encode(header);
  const out = new Uint8Array(headBytes.length + raw_data.length);
  out.set(headBytes, 0);
  out.set(raw_data, headBytes.length);
  return out;
}
