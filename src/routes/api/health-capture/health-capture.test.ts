import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOwnedPatient: vi.fn(),
  requireUserId: vi.fn(() => 'account-1'),
  extractHealthCapture: vi.fn(),
}));

vi.mock('$lib/server/ownership', () => ({
  getOwnedPatient: mocks.getOwnedPatient,
  requireUserId: mocks.requireUserId,
}));

vi.mock('$lib/server/health-capture', () => {
  class HealthCaptureInputError extends Error {}
  class HealthCaptureUnavailableError extends Error {}

  return {
    extractHealthCapture: mocks.extractHealthCapture,
    HealthCaptureInputError,
    HealthCaptureUnavailableError,
  };
});

import { POST } from './+server';

const APP_URL = 'https://health.example/api/health-capture';

function requestEvent(options: {
  authenticated?: boolean;
  origin?: string | null;
  body?: unknown;
}) {
  const url = new URL(APP_URL);
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.origin !== null) {
    headers.set('origin', options.origin || url.origin);
  }

  return {
    request: new Request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(
        Object.hasOwn(options, 'body')
          ? options.body
          : {
              patientId: 'profile-1',
              kind: 'medicine',
              message: 'One tablet every evening',
              timeZone: 'UTC',
              locale: 'en',
            },
      ),
    }),
    locals: options.authenticated === false ? {} : { user: { sub: 'account-1' } },
    url,
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  mocks.getOwnedPatient.mockReset();
  mocks.requireUserId.mockClear();
  mocks.extractHealthCapture.mockReset();
});

describe('health capture endpoint', () => {
  it('requires an authenticated session', async () => {
    const response = await POST(requestEvent({ authenticated: false }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ code: 'capture_unauthorized' });
    expect(mocks.getOwnedPatient).not.toHaveBeenCalled();
  });

  it('rejects a cross-site request before reading health data', async () => {
    const response = await POST(requestEvent({ origin: 'https://outside.example' }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ code: 'capture_forbidden_origin' });
    expect(mocks.getOwnedPatient).not.toHaveBeenCalled();
    expect(mocks.extractHealthCapture).not.toHaveBeenCalled();
  });

  it('requires ownership of the selected profile', async () => {
    mocks.getOwnedPatient.mockResolvedValue(null);

    const response = await POST(requestEvent({}));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ code: 'capture_profile_not_found' });
    expect(mocks.getOwnedPatient).toHaveBeenCalledWith('account-1', 'profile-1');
    expect(mocks.extractHealthCapture).not.toHaveBeenCalled();
  });

  it('rejects a non-object body and oversized messages before profile lookup', async () => {
    const invalidBody = await POST(requestEvent({ body: null }));
    const oversizedMessage = await POST(
      requestEvent({
        body: {
          patientId: 'profile-1',
          kind: 'medicine',
          message: 'x'.repeat(1501),
          timeZone: 'UTC',
        },
      }),
    );

    expect(invalidBody.status).toBe(400);
    expect(oversizedMessage.status).toBe(400);
    expect(mocks.getOwnedPatient).not.toHaveBeenCalled();
    expect(mocks.extractHealthCapture).not.toHaveBeenCalled();
  });

  it('passes bounded context to the extractor and disables response caching', async () => {
    mocks.getOwnedPatient.mockResolvedValue({ extraData: JSON.stringify({ timeZone: 'UTC' }) });
    mocks.extractHealthCapture.mockResolvedValue({ kind: 'medicine', recognized: true });

    const response = await POST(requestEvent({}));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      proposal: { kind: 'medicine', recognized: true },
    });
    expect(mocks.extractHealthCapture).toHaveBeenCalledWith({
      userId: 'account-1',
      kind: 'medicine',
      message: 'One tablet every evening',
      currentLocal: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      timeZone: 'UTC',
      locale: 'en',
    });
  });

  it('rejects an invalid browser timezone', async () => {
    mocks.getOwnedPatient.mockResolvedValue({ extraData: null });

    const response = await POST(
      requestEvent({
        body: {
          patientId: 'profile-1',
          kind: 'energy',
          message: 'Lunch was soup',
          timeZone: 'Invalid/Zone',
          locale: 'en',
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ code: 'capture_invalid_input' });
    expect(mocks.extractHealthCapture).not.toHaveBeenCalled();
  });
});
