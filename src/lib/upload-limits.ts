/**
 * Upload ceilings, shared by the browser and the server.
 *
 * They live apart from the extraction code because `$lib/server` never reaches
 * the client, and the upload form has to know the same numbers in order to
 * shrink a photograph rather than let the server refuse it.
 */

/**
 * The largest document that may be sent at all.
 *
 * A file is streamed to the model as an upload rather than inlined, so the
 * worker holds it once instead of five times over and its 128 MB is no longer
 * what decides this. What decides it is the model's own 50 MB per-file limit;
 * Cloudflare's 100 MB request body sits above that.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * The largest image that may be sent inline.
 *
 * An image goes to the model as a data URL, which the worker does hold several
 * times over, so this one is bounded by isolate memory. It rarely binds: the
 * browser redraws any image above it, and only a format it cannot decode —
 * HEIC, in practice — arrives at full size.
 */
export const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
