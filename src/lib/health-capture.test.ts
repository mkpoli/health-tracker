import { describe, expect, it } from 'vitest';
import {
  InvalidCaptureProposalError,
  normalizeEnergyCapture,
  normalizeMedicineCapture,
} from './health-capture';

describe('medicine text capture', () => {
  it('normalizes an editable proposal while preserving the stated wording', () => {
    expect(
      normalizeMedicineCapture({
        kind: 'medicine',
        recognized: true,
        name: '  Example Brand  ',
        generic_name: 'example ingredient',
        form: 'tablet',
        strength: '5 mg',
        route: 'oral',
        schedule: 'Every evening',
        status: 'active',
        start_date: '2026-08-15',
        end_date: null,
        purpose: null,
        prescriber: null,
        notes: 'With food',
        uncertain_fields: ['startDate', 'schedule', 'startDate'],
      }),
    ).toEqual({
      kind: 'medicine',
      recognized: true,
      name: 'Example Brand',
      genericName: 'example ingredient',
      form: 'tablet',
      strength: '5 mg',
      route: 'oral',
      schedule: 'Every evening',
      status: 'active',
      startDate: '2026-08-15',
      endDate: null,
      purpose: null,
      prescriber: null,
      notes: 'With food',
      uncertainFields: ['startDate', 'schedule'],
    });
  });

  it('does not mark a medicine recognized without a name', () => {
    const result = normalizeMedicineCapture({
      kind: 'medicine',
      recognized: true,
      name: null,
      generic_name: null,
      form: null,
      strength: null,
      route: null,
      schedule: 'Every morning',
      status: null,
      start_date: null,
      end_date: null,
      purpose: null,
      prescriber: null,
      notes: null,
      uncertain_fields: ['name'],
    });

    expect(result.recognized).toBe(false);
    expect(result.uncertainFields).toEqual(['name', 'status']);
  });

  it('marks an unstated medicine status for review', () => {
    const result = normalizeMedicineCapture({
      kind: 'medicine',
      recognized: true,
      name: 'Example',
      generic_name: null,
      form: null,
      strength: null,
      route: null,
      schedule: null,
      status: null,
      start_date: null,
      end_date: null,
      purpose: null,
      prescriber: null,
      notes: null,
      uncertain_fields: [],
    });

    expect(result.uncertainFields).toEqual(['status']);
  });

  it('rejects impossible dates and unknown states', () => {
    const base = {
      kind: 'medicine',
      recognized: true,
      name: 'Example',
      generic_name: null,
      form: null,
      strength: null,
      route: null,
      schedule: null,
      status: 'sometimes',
      start_date: '2026-02-30',
      end_date: null,
      purpose: null,
      prescriber: null,
      notes: null,
      uncertain_fields: [],
    };

    expect(() => normalizeMedicineCapture(base)).toThrow(InvalidCaptureProposalError);
    expect(() => normalizeMedicineCapture({ ...base, status: 'active' })).toThrow(
      InvalidCaptureProposalError,
    );
  });
});

describe('energy text capture', () => {
  it('normalizes intake fields and keeps unknown calories empty', () => {
    expect(
      normalizeEnergyCapture({
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
      }),
    ).toEqual({
      kind: 'energy',
      recognized: true,
      direction: 'intake',
      label: 'Noodle soup',
      category: 'lunch',
      energyKcal: null,
      occurredLocal: '2026-08-15T12:30',
      durationMinutes: null,
      notes: null,
      uncertainFields: ['energyKcal'],
    });
  });

  it('accepts stated expenditure values at the storage limits', () => {
    const result = normalizeEnergyCapture({
      kind: 'energy',
      recognized: true,
      direction: 'expenditure',
      label: 'Strength training',
      category: null,
      energy_kcal: 312.1234,
      occurred_local: null,
      duration_minutes: 45,
      notes: null,
      uncertain_fields: [],
    });

    expect(result.energyKcal).toBe(312.123);
    expect(result.durationMinutes).toBe(45);
    expect(result.uncertainFields).toEqual(['occurredLocal']);
  });

  it('marks defaulted intake time and category for review', () => {
    const result = normalizeEnergyCapture({
      kind: 'energy',
      recognized: true,
      direction: 'intake',
      label: 'Soup',
      category: null,
      energy_kcal: null,
      occurred_local: null,
      duration_minutes: null,
      notes: null,
      uncertain_fields: [],
    });

    expect(result.uncertainFields).toEqual(['occurredLocal', 'category']);
  });

  it('rejects invalid wall times and non-integer durations', () => {
    const base = {
      kind: 'energy',
      recognized: true,
      direction: 'expenditure',
      label: 'Run',
      category: null,
      energy_kcal: 200,
      occurred_local: '2026-02-30T12:00',
      duration_minutes: 30.5,
      notes: null,
      uncertain_fields: [],
    };

    expect(() => normalizeEnergyCapture(base)).toThrow(InvalidCaptureProposalError);
    expect(() =>
      normalizeEnergyCapture({ ...base, occurred_local: '2026-08-15T12:00' }),
    ).toThrow(InvalidCaptureProposalError);
  });
});
