import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  construct: vi.fn(),
  env: {
    OPENAI_API_KEY: 'test-key',
    OPENAI_API_MODEL: 'capture-test-model',
    OPENAI_API_CAPTURE_REASONING_EFFORT: 'low',
  } as Record<string, string | undefined>,
}));

vi.mock('$env/dynamic/private', () => ({
  env: mocks.env,
}));

vi.mock('openai', () => ({
  default: class {
    constructor(options: unknown) {
      mocks.construct(options);
    }
    chat = { completions: { create: mocks.create } };
  },
}));

import {
  extractHealthCapture,
  HealthCaptureInputError,
  HealthCaptureUnavailableError,
} from './health-capture';

const energyResult = {
  kind: 'energy',
  recognized: true,
  direction: 'intake',
  label: 'Noodle soup',
  category: 'lunch',
  energy_kcal: null,
  occurred_local: '2026-08-15T12:30',
  duration_minutes: null,
  notes: null,
  uncertain_fields: ['energyKcal'],
};

beforeEach(() => {
  mocks.create.mockReset();
  mocks.construct.mockReset();
  Object.assign(mocks.env, {
    OPENAI_API_KEY: 'test-key',
    OPENAI_API_MODEL: 'capture-test-model',
    OPENAI_API_CAPTURE_REASONING_EFFORT: 'low',
  });
  delete mocks.env.HEALTH_CAPTURE_PROVIDER;
  delete mocks.env.DEEPSEEK_API_KEY;
  delete mocks.env.DEEPSEEK_API_CAPTURE_MODEL;
});

describe('health capture provider request', () => {
  it('uses strict structured output and disables provider storage', async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(energyResult) } }],
    });

    const result = await extractHealthCapture({
      userId: 'private-account-subject',
      kind: 'energy',
      message: 'Lunch was noodle soup. I do not know the calories.',
      currentLocal: '2026-08-15T19:00',
      timeZone: 'Asia/Tokyo',
      locale: 'en',
    });

    expect(result).toMatchObject({
      kind: 'energy',
      label: 'Noodle soup',
      energyKcal: null,
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [request, options] = mocks.create.mock.calls[0];
    expect(request).toMatchObject({
      model: 'capture-test-model',
      reasoning_effort: 'low',
      max_completion_tokens: 3000,
      store: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'energy_capture', strict: true },
      },
    });
    expect(request.safety_identifier).toMatch(/^[a-f0-9]{32}$/);
    expect(request.safety_identifier).not.toContain('private-account-subject');
    expect(request.messages[0].content).toContain('Never estimate calories');
    expect(request.messages[0].content).toContain('Return one valid JSON object');
    expect(options).toEqual({ timeout: 30_000, maxRetries: 0 });
    expect(mocks.construct).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  it('uses DeepSeek JSON output when a DeepSeek key is configured', async () => {
    mocks.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
    mocks.env.DEEPSEEK_API_CAPTURE_MODEL = 'deepseek-v4-flash-test';
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(energyResult) } }],
    });

    await extractHealthCapture({
      userId: 'private-account-subject',
      kind: 'energy',
      message: 'Lunch was noodle soup.',
      currentLocal: '2026-08-15T19:00',
      timeZone: 'Asia/Tokyo',
      locale: 'en',
    });

    expect(mocks.construct).toHaveBeenCalledWith({
      apiKey: 'deepseek-test-key',
      baseURL: 'https://api.deepseek.com',
    });
    const [request, options] = mocks.create.mock.calls[0];
    expect(request).toMatchObject({
      model: 'deepseek-v4-flash-test',
      response_format: { type: 'json_object' },
      max_tokens: 3000,
      thinking: { type: 'disabled' },
    });
    expect(request).not.toHaveProperty('store');
    expect(request).not.toHaveProperty('safety_identifier');
    expect(request).not.toHaveProperty('reasoning_effort');
    expect(request).not.toHaveProperty('max_completion_tokens');
    expect(options).toEqual({ timeout: 30_000, maxRetries: 0 });
  });

  it('rejects oversized input before calling the provider', async () => {
    await expect(
      extractHealthCapture({
        userId: 'account',
        kind: 'medicine',
        message: 'x'.repeat(1501),
        currentLocal: '2026-08-15T19:00',
        timeZone: 'Asia/Tokyo',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(HealthCaptureInputError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid provider result', async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: '{"kind":"energy"}' } }] });

    await expect(
      extractHealthCapture({
        userId: 'account',
        kind: 'energy',
        message: 'Lunch was soup',
        currentLocal: '2026-08-15T19:00',
        timeZone: 'Asia/Tokyo',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(HealthCaptureUnavailableError);
  });
});
