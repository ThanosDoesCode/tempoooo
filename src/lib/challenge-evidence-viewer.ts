import { isExpectedQueryCancellation } from "./query-cancellation.ts";

type SignedEvidenceItem = { signedUrl?: string | null };

export type EvidenceResolution =
  | { status: "ready"; urls: string[] }
  | { status: "expired" }
  | {
      status: "unavailable";
      reason: "cancelled" | "storage" | "unexpected";
      cause?: unknown;
    };

export function isEvidenceRequestCancellation(error: unknown): boolean {
  return (
    isExpectedQueryCancellation(error) ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export async function resolveEvidenceUrls({
  paths,
  expired,
  sign,
}: {
  paths: string[];
  expired: boolean;
  sign: (paths: string[]) => Promise<{ data: SignedEvidenceItem[] | null; error: unknown | null }>;
}): Promise<EvidenceResolution> {
  if (expired) return { status: "expired" };
  if (paths.length === 0) return { status: "unavailable", reason: "storage" };

  try {
    const { data, error } = await sign(paths);
    if (error) return { status: "unavailable", reason: "storage" };

    const urls = (data ?? []).flatMap((item) =>
      typeof item.signedUrl === "string" && item.signedUrl.length > 0 ? [item.signedUrl] : [],
    );
    if (urls.length !== paths.length) {
      return { status: "unavailable", reason: "storage" };
    }
    return { status: "ready", urls };
  } catch (error) {
    if (isEvidenceRequestCancellation(error)) {
      return { status: "unavailable", reason: "cancelled" };
    }
    return { status: "unavailable", reason: "unexpected", cause: error };
  }
}
