export const EVIDENCE_MAX_WIDTH = 1600;
export const EVIDENCE_TARGET_BYTES = 1024 * 1024;
export const EVIDENCE_WEBP_QUALITY = 0.72;

type DecodedEvidenceImage = {
  width: number;
  height: number;
  draw: (canvas: unknown, width: number, height: number) => void;
  close: () => void;
};

export type EvidenceImageRuntime = {
  decode: (file: File) => Promise<DecodedEvidenceImage>;
  createCanvas: (width: number, height: number) => unknown;
  encodeWebp: (canvas: unknown, quality: number) => Promise<Blob | null>;
};

export function evidenceDimensions(width: number, height: number, maxWidth = EVIDENCE_MAX_WIDTH) {
  if (!(width > 0 && height > 0)) throw new Error("invalid_image_dimensions");
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function webpName(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "evidence";
  return `${base}.webp`;
}

async function browserImageRuntime(): Promise<EvidenceImageRuntime> {
  return {
    decode: async (file) => {
      if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw: (target, width, height) => {
            const context = (target as HTMLCanvasElement).getContext("2d");
            if (!context) throw new Error("canvas_context_unavailable");
            context.drawImage(bitmap, 0, 0, width, height);
          },
          close: () => bitmap.close(),
        };
      }

      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("image_decode_failed"));
          image.src = objectUrl;
        });
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
          draw: (target, width, height) => {
            const context = (target as HTMLCanvasElement).getContext("2d");
            if (!context) throw new Error("canvas_context_unavailable");
            context.drawImage(image, 0, 0, width, height);
          },
          close: () => URL.revokeObjectURL(objectUrl),
        };
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
      }
    },
    createCanvas: (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    encodeWebp: (target, quality) =>
      new Promise((resolve) => {
        (target as HTMLCanvasElement).toBlob(resolve, "image/webp", quality);
      }),
  };
}

/** Returns the original File if decoding or WebP conversion is unsupported. */
export async function optimizeEvidenceImage(
  file: File,
  runtime?: EvidenceImageRuntime,
): Promise<File> {
  try {
    const imageRuntime = runtime ?? (await browserImageRuntime());
    const decoded = await imageRuntime.decode(file);
    try {
      let dimensions = evidenceDimensions(decoded.width, decoded.height);
      let smallest: Blob | null = null;
      const qualities = [EVIDENCE_WEBP_QUALITY, 0.62, 0.52, 0.42];

      for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
        const canvas = imageRuntime.createCanvas(dimensions.width, dimensions.height);
        decoded.draw(canvas, dimensions.width, dimensions.height);
        for (const quality of qualities) {
          const blob = await imageRuntime.encodeWebp(canvas, quality);
          if (!blob || blob.type !== "image/webp" || blob.size === 0) return file;
          if (!smallest || blob.size < smallest.size) smallest = blob;
          if (blob.size <= EVIDENCE_TARGET_BYTES) {
            return new File([blob], webpName(file.name), {
              type: "image/webp",
              lastModified: file.lastModified,
            });
          }
        }
        dimensions = {
          width: Math.max(1, Math.round(dimensions.width * 0.8)),
          height: Math.max(1, Math.round(dimensions.height * 0.8)),
        };
      }

      return smallest
        ? new File([smallest], webpName(file.name), {
            type: "image/webp",
            lastModified: file.lastModified,
          })
        : file;
    } finally {
      decoded.close();
    }
  } catch {
    return file;
  }
}

export function evidenceWeekFinalized(
  activity: { user_id: string; activity_date: string },
  weeks: Array<{ user_id: string; week_start: string; week_end: string }>,
) {
  return weeks.some(
    (week) =>
      week.user_id === activity.user_id &&
      activity.activity_date >= week.week_start &&
      activity.activity_date <= week.week_end,
  );
}
