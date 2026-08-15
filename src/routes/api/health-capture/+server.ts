import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOwnedPatient, requireUserId } from '$lib/server/ownership';
import {
  extractHealthCapture,
  HealthCaptureInputError,
  HealthCaptureUnavailableError,
} from '$lib/server/health-capture';
import {
  isValidTimeZone,
  timeZoneFromMetadata,
  toDateTimeLocal,
} from '$lib/time-zone';
import { MAX_CAPTURE_MESSAGE_CHARS } from '$lib/health-capture';

const NO_STORE = { 'cache-control': 'no-store' };
const MAX_REQUEST_CHARS = 10_000;

export const POST: RequestHandler = async ({ request, locals, url }) => {
  if (!locals.user) {
    return json({ code: 'capture_unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const userId = requireUserId(locals);
  if (request.headers.get('origin') !== url.origin) {
    return json({ code: 'capture_forbidden_origin' }, { status: 403, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_CHARS) {
      return json({ code: 'capture_invalid_input' }, { status: 400, headers: NO_STORE });
    }
    const requestText = await request.text();
    if (requestText.length > MAX_REQUEST_CHARS) {
      return json({ code: 'capture_invalid_input' }, { status: 400, headers: NO_STORE });
    }
    const parsed = JSON.parse(requestText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json({ code: 'capture_invalid_input' }, { status: 400, headers: NO_STORE });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ code: 'capture_invalid_input' }, { status: 400, headers: NO_STORE });
  }

  const patientId = typeof body.patientId === 'string' ? body.patientId : '';
  const kind = body.kind;
  const message = typeof body.message === 'string' ? body.message : '';
  if (
    !patientId ||
    patientId.length > 200 ||
    !message.trim() ||
    message.length > MAX_CAPTURE_MESSAGE_CHARS ||
    (kind !== 'medicine' && kind !== 'energy')
  ) {
    return json({ code: 'capture_invalid_input' }, { status: 400, headers: NO_STORE });
  }

  const profile = await getOwnedPatient(userId, patientId);
  if (!profile) {
    return json({ code: 'capture_profile_not_found' }, { status: 404, headers: NO_STORE });
  }

  const requestedTimeZone = body.timeZone;
  if (
    requestedTimeZone !== undefined &&
    (typeof requestedTimeZone !== 'string' || !isValidTimeZone(requestedTimeZone))
  ) {
    return json({ code: 'capture_invalid_input' }, { status: 400, headers: NO_STORE });
  }
  const timeZone =
    typeof requestedTimeZone === 'string'
      ? requestedTimeZone
      : timeZoneFromMetadata(profile.extraData);
  const currentLocal = toDateTimeLocal(new Date().toISOString(), timeZone);
  const locale =
    typeof body.locale === 'string' && body.locale.length <= 35 ? body.locale : 'en';

  try {
    const proposal = await extractHealthCapture({
      userId,
      kind,
      message,
      currentLocal,
      timeZone,
      locale,
    });
    return json({ proposal }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof HealthCaptureInputError) {
      return json({ code: 'capture_invalid_input' }, { status: 400, headers: NO_STORE });
    }
    if (error instanceof HealthCaptureUnavailableError) {
      return json({ code: 'capture_unavailable' }, { status: 503, headers: NO_STORE });
    }

    console.error(
      '[health-capture] request failed',
      error instanceof Error ? error.name : 'unknown',
    );
    return json({ code: 'capture_failed' }, { status: 502, headers: NO_STORE });
  }
};
