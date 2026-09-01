import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// Small code-drawn running-track icon; no third-party image or private data.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, crc]);
}
for (const size of [192, 512]) {
  const pixels = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / size - 0.5) / 0.29;
      const dy = (y / size - 0.5) / 0.23;
      const radius = Math.hypot(dx, dy);
      const track = (radius > 0.82 && radius < 1) || (radius > 0.56 && radius < 0.65);
      const color = track ? [163, 230, 53] : [17, 24, 39];
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      pixels.set(color, offset);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    new URL(`../public/icons/challenge-${size}.png`, import.meta.url),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
