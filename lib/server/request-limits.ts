export const MAX_UPLOAD_BYTES = 1_048_576;
export const MAX_UNIVERSE_ROWS = 1_000;
export const MAX_SCAN_ITEMS = 500;
export const MAX_EXPORT_ITEMS = 500;
export const MAX_SCAN_BODY_BYTES = 1_048_576;
export const MAX_EXPORT_BODY_BYTES = 2_097_152;

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Request payload is too large");
    this.name = "PayloadTooLargeError";
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PayloadTooLargeError();
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new PayloadTooLargeError();
  }
  return JSON.parse(text) as unknown;
}
