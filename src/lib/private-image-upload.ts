export const PRIVATE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const PRIVATE_IMAGE_MAX_DIMENSION = 12_000;
export const PRIVATE_IMAGE_MAX_PIXELS = 80_000_000;

export const PRIVATE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export const STANDARD_PRIVATE_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PrivateImageType = {
  extension: "jpg" | "png" | "webp" | "gif" | "heic" | "heif";
  mimeType: (typeof PRIVATE_IMAGE_MIME_TYPES)[number];
};

type ImageDimensions = { width: number; height: number };
export type PrivateImageDecode = (file: File) => Promise<ImageDimensions>;

export class PrivateImageValidationError extends Error {
  readonly code:
    | "invalid_private_image_size"
    | "invalid_private_image_content"
    | "private_image_type_mismatch"
    | "private_image_decode_failed"
    | "private_image_dimensions_exceeded";

  constructor(code: PrivateImageValidationError["code"]) {
    super(code);
    this.name = "PrivateImageValidationError";
    this.code = code;
  }
}

export function isPrivateImageValidationError(
  error: unknown,
): error is PrivateImageValidationError {
  return error instanceof PrivateImageValidationError;
}

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.slice(from, to));
const uint16be = (bytes: Uint8Array, offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!;
const uint16le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8);
const uint24le = (bytes: Uint8Array, offset: number) =>
  bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
const uint32be = (bytes: Uint8Array, offset: number) =>
  (bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!) >>>
  0;

function isAsciiBoxType(value: string) {
  return /^[\x20-\x7e]{4}$/.test(value);
}

function findCompleteBox(bytes: Uint8Array, type: string, minimumSize = 8) {
  for (let typeOffset = 4; typeOffset + 4 <= bytes.length; typeOffset += 1) {
    if (ascii(bytes, typeOffset, typeOffset + 4) !== type) continue;
    const start = typeOffset - 4;
    const size = uint32be(bytes, start);
    if (size >= minimumSize && start + size <= bytes.length) return { start, size };
  }
  return null;
}

function isoBmffDimensions(bytes: Uint8Array): ImageDimensions | null {
  const box = findCompleteBox(bytes, "ispe", 20);
  return box
    ? { width: uint32be(bytes, box.start + 12), height: uint32be(bytes, box.start + 16) }
    : null;
}

function detectIsoBmffImage(bytes: Uint8Array): PrivateImageType | null {
  if (bytes.length < 24 || ascii(bytes, 4, 8) !== "ftyp") return null;
  const ftypSize = uint32be(bytes, 0);
  if (ftypSize < 16 || ftypSize % 4 !== 0 || ftypSize > bytes.length - 8) return null;
  const brands = new Set<string>();
  for (let offset = 8; offset + 4 <= ftypSize; offset += 4)
    brands.add(ascii(bytes, offset, offset + 4).toLowerCase());
  const type: PrivateImageType | null = ["heic", "heix", "hevc", "hevx"].some((brand) =>
    brands.has(brand),
  )
    ? { mimeType: "image/heic", extension: "heic" }
    : ["mif1", "msf1"].some((brand) => brands.has(brand)) &&
        !brands.has("avif") &&
        !brands.has("avis")
      ? { mimeType: "image/heif", extension: "heif" }
      : null;
  if (!type) return null;
  // A lone ftyp header is not an image. Require the essential complete image
  // metadata and media-data structures used by ordinary iPhone HEIC files.
  const meta = findCompleteBox(bytes, "meta", 12);
  const media = findCompleteBox(bytes, "mdat", 9);
  const dimensions = isoBmffDimensions(bytes);
  if (
    !meta ||
    !media ||
    !dimensions ||
    !isAsciiBoxType(ascii(bytes, meta.start + 4, meta.start + 8))
  )
    return null;
  return type;
}

function detectedImageType(bytes: Uint8Array): PrivateImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mimeType: "image/jpeg", extension: "jpg" };
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return { mimeType: "image/png", extension: "png" };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return { mimeType: "image/webp", extension: "webp" };
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)))
    return { mimeType: "image/gif", extension: "gif" };
  return detectIsoBmffImage(bytes);
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) return null;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = uint16be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      if (segmentLength < 7) return null;
      return { height: uint16be(bytes, offset + 3), width: uint16be(bytes, offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

function encodedDimensions(bytes: Uint8Array, type: PrivateImageType): ImageDimensions | null {
  if (type.mimeType === "image/jpeg") return jpegDimensions(bytes);
  if (type.mimeType === "image/png") {
    if (bytes.length < 24 || ascii(bytes, 12, 16) !== "IHDR") return null;
    return { width: uint32be(bytes, 16), height: uint32be(bytes, 20) };
  }
  if (type.mimeType === "image/gif") {
    if (bytes.length < 10) return null;
    return { width: uint16le(bytes, 6), height: uint16le(bytes, 8) };
  }
  if (type.mimeType === "image/webp") {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8X" && bytes.length >= 30)
      return { width: uint24le(bytes, 24) + 1, height: uint24le(bytes, 27) + 1 };
    if (
      chunk === "VP8 " &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    )
      return { width: uint16le(bytes, 26) & 0x3fff, height: uint16le(bytes, 28) & 0x3fff };
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f)
      return {
        width: 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8)),
        height: 1 + ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0x0f) << 10)),
      };
  }
  if (type.mimeType === "image/heic" || type.mimeType === "image/heif")
    return isoBmffDimensions(bytes);
  return null;
}

function assertSafeDimensions(dimensions: ImageDimensions) {
  const { width, height } = dimensions;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0))
    throw new PrivateImageValidationError("private_image_decode_failed");
  if (
    width > PRIVATE_IMAGE_MAX_DIMENSION ||
    height > PRIVATE_IMAGE_MAX_DIMENSION ||
    width * height > PRIVATE_IMAGE_MAX_PIXELS
  )
    throw new PrivateImageValidationError("private_image_dimensions_exceeded");
}

async function decodeBrowserImage(file: File): Promise<ImageDimensions> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close();
      }
    } catch {
      // Safari/browser codec support varies; retry through HTMLImageElement.
    }
  }
  if (
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    throw new Error("image_decoder_unavailable");
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image_decode_failed"));
      image.src = objectUrl;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function normalizedDeclaredType(type: string) {
  return type.toLowerCase() === "image/jpg" ? "image/jpeg" : type.toLowerCase();
}

/**
 * Browser MIME metadata is caller-controlled. Validate the file signature,
 * encoded dimensions and browser decodability before private image uploads.
 * HEIC/HEIF remain structurally validated because decoding is not consistently
 * exposed by browsers; when the browser can decode them, their decoded size is
 * checked too.
 */
export async function inspectPrivateImage(
  file: File,
  allowedTypes: readonly string[] = PRIVATE_IMAGE_MIME_TYPES,
  decode: PrivateImageDecode = decodeBrowserImage,
): Promise<PrivateImageType> {
  if (file.size <= 0 || file.size > PRIVATE_IMAGE_MAX_BYTES)
    throw new PrivateImageValidationError("invalid_private_image_size");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectedImageType(bytes);
  if (!detected || !allowedTypes.includes(detected.mimeType))
    throw new PrivateImageValidationError("invalid_private_image_content");
  const declared = normalizedDeclaredType(file.type);
  if (declared && declared !== detected.mimeType)
    throw new PrivateImageValidationError("private_image_type_mismatch");

  const encoded = encodedDimensions(bytes, detected);
  const standard = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
    detected.mimeType,
  );
  if (standard && !encoded) throw new PrivateImageValidationError("private_image_decode_failed");
  if (encoded) assertSafeDimensions(encoded);

  try {
    const decoded = await decode(file);
    assertSafeDimensions(decoded);
    const dimensionsMatch =
      !encoded ||
      (decoded.width === encoded.width && decoded.height === encoded.height) ||
      // EXIF orientation can swap the decoded width and height for phone JPEGs.
      (decoded.width === encoded.height && decoded.height === encoded.width);
    if (!dimensionsMatch) throw new PrivateImageValidationError("private_image_decode_failed");
  } catch (error) {
    if (error instanceof PrivateImageValidationError) throw error;
    if (standard) throw new PrivateImageValidationError("private_image_decode_failed");
    // HEIC/HEIF decoding is not portable. Their validated ISO-BMFF structure
    // remains uploadable so common iPhone evidence is not rejected solely due
    // to missing browser codec support.
  }
  return detected;
}
