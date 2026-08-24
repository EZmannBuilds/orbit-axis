// Orbit X :: dependency-free ZIP packaging for manual social export.
//
// Store-mode ZIP is intentional: PNG files are already compressed, while
// caption/manifest files are tiny. Avoiding another client dependency keeps
// the private desk deterministic and makes one browser download replace a
// burst of six to ten downloads.

const CRC_TABLE = Object.freeze(Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
}));

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipNumber(size, values) {
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  for (const [offset, value, bytes] of values) {
    if (bytes === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  }
  return out;
}

function joinBytes(parts) {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export function zipStore(entries) {
  const encoder = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries || []) {
    const name = encoder.encode(String(entry.name || "file"));
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data ?? ""));
    const crc = crc32(data);
    const header = zipNumber(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2],
      [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]);
    const directory = zipNumber(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2],
      [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2],
      [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]);
    local.push(header, name, data); central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralBytes = joinBytes(central);
  const end = zipNumber(22, [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, entries.length, 2],
    [10, entries.length, 2], [12, centralBytes.length, 4], [16, offset, 4], [20, 0, 2]]);
  return new Blob([...local, centralBytes, end], { type: "application/zip" });
}
