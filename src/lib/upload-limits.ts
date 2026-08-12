/**
 * The upload ceiling, shared by the browser and the server.
 *
 * It lives apart from the extraction code because `$lib/server` never reaches
 * the client, and the drop zone has to know the same number in order to resize
 * a photograph rather than let the server refuse it.
 *
 * An isolate has 128 MB, and a scan occupies it several times over: the
 * buffered request body, the bytes read out of it, the base64 data URL, and the
 * JSON body sent upstream. Neither Cloudflare's 100 MB request limit nor the
 * model's 512 MB payload limit binds before memory does.
 */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
