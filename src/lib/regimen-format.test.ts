import { describe, expect, it } from 'vitest';
import type { DoseRegimenRecord, DoseSlot } from './medicine-plan';
import { regimenSummary } from './regimen-format';

function slot(overrides: Partial<DoseSlot> = {}): DoseSlot {
  return {
    key: null,
    label: null,
    anchorKind: null,
    anchorMeal: null,
    anchorOffsetMinutes: null,
    time: null,
    amountValue: null,
    amountUnit: null,
    ...overrides,
  };
}

function regimen(overrides: Partial<DoseRegimenRecord> = {}): DoseRegimenRecord {
  return {
    id: 'regimen-1',
    patientId: 'patient-1',
    courseId: 'course-1',
    ruleKind: 'fixed_slots',
    slots: [],
    daysOfWeek: null,
    intervalHours: null,
    anchorAt: null,
    doseText: null,
    route: null,
    site: null,
    timezone: 'Asia/Tokyo',
    effectiveFrom: '2026-08-01',
    effectiveTo: null,
    remindMinutesBefore: null,
    notes: null,
    originKind: 'manual',
    originProvider: null,
    originExternalId: null,
    revision: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('regimenSummary', () => {
  it('names each slot by time and amount, then the weekdays', () => {
    const summary = regimenSummary(
      regimen({
        slots: [
          slot({ time: '08:00', amountValue: 1, amountUnit: 'tablet' }),
          slot({ time: '20:00', amountValue: 1, amountUnit: 'tablet' }),
        ],
        daysOfWeek: [1, 4],
      }),
    );
    expect(summary).toBe('08:00 1 tablet · 20:00 1 tablet · Mon Thu');
  });

  it('prints the dose wording once when no slot carries an amount', () => {
    const summary = regimenSummary(
      regimen({
        slots: [slot({ time: '08:00' }), slot({ time: '20:00' })],
        doseText: '1 tablet with water',
      }),
    );
    expect(summary).toBe('08:00 · 20:00 · 1 tablet with water');
  });

  it('joins a CJK label and a counted amount without a space', () => {
    const summary = regimenSummary(
      regimen({ slots: [slot({ label: '朝食後', amountValue: 1, amountUnit: '錠' })] }),
    );
    expect(summary).toBe('朝食後1錠');
  });

  it('describes as-needed and interval rules with their dose wording', () => {
    expect(regimenSummary(regimen({ ruleKind: 'as_needed', doseText: '1 tablet' }))).toBe(
      'As needed · 1 tablet',
    );
    expect(
      regimenSummary(regimen({ ruleKind: 'interval', intervalHours: 8, doseText: '1 tablet' })),
    ).toBe('Every 8 hours · 1 tablet');
  });
});
