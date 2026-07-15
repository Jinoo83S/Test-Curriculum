  // ================================================================
// timetable-print-archive.js · Minimal ZIP/CRC utilities for Office exports
// ================================================================

export function crc32Bytes(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!crc32Bytes.table) {
    crc32Bytes.table = Array.from({ length: 256 }, (_, i) => {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const b of source) crc = crc32Bytes.table[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function officeXmlEsc(value = "") {
  return String(value ?? "").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function u8FromString(value) {
  return new TextEncoder().encode(String(value ?? ""));
}

export function concatU8(parts = []) {
  const normalized = parts.map(part => part instanceof Uint8Array ? part : new Uint8Array(part || []));
  const total = normalized.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of normalized) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function le16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function le32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

export function zipStore(files = [], options = {}) {
  if (!Array.isArray(files) || !files.length) throw new Error("ZIP에 포함할 파일이 없습니다.");
  const now = options.now instanceof Date ? options.now : new Date();
  const dostime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | (Math.floor(now.getSeconds() / 2) & 31);
  const dosdate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
  let offset = 0;
  const locals = [];
  const centrals = [];

  for (const file of files) {
    if (!file || !file.name) throw new Error("ZIP 파일 이름이 비어 있습니다.");
    const nameBytes = u8FromString(file.name);
    const data = file.data instanceof Uint8Array ? file.data : u8FromString(file.data);
    const crc = crc32Bytes(data);
    const local = concatU8([
      le32(0x04034b50), le16(20), le16(0), le16(0), le16(dostime), le16(dosdate),
      le32(crc), le32(data.length), le32(data.length), le16(nameBytes.length), le16(0), nameBytes, data,
    ]);
    locals.push(local);
    const central = concatU8([
      le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(dostime), le16(dosdate),
      le32(crc), le32(data.length), le32(data.length), le16(nameBytes.length), le16(0), le16(0),
      le16(0), le16(0), le32(0), le32(offset), nameBytes,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = concatU8([
    le32(0x06054b50), le16(0), le16(0), le16(files.length), le16(files.length),
    le32(centralSize), le32(offset), le16(0),
  ]);
  return new Blob([concatU8([...locals, ...centrals, end])], { type: options.mimeType || "application/zip" });
}
