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
