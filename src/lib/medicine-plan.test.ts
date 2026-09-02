import { describe, expect, it } from 'vitest';
import {
  activeCourseOf,
  checklistDayOf,
  addDays,
  assignDoseSlotKeys,
  buildDoseChecklist,
  countAdherence,
  currentRegimenOf,
  normalizeDaysOfWeek,
  normalizeDoseSlots,
  planDoses,
  type DoseOccurrenceRecord,
  type DoseRegimenRecord,
  type DoseSlot,
  type MedicineCourseRecord,
} from './medicine-plan';

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

function course(overrides: Partial<MedicineCourseRecord> = {}): MedicineCourseRecord {
  return {
    id: 'course-1',
    patientId: 'patient-1',
    medicineClaimId: 'medicine-1',
    kind: 'initial',
    status: 'active',
    previousCourseId: null,
    startDate: '2026-08-01',
    endDate: null,
    endReason: null,
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

function occurrence(overrides: Partial<DoseOccurrenceRecord> = {}): DoseOccurrenceRecord {
  return {
    id: 'occurrence-1',
    patientId: 'patient-1',
    courseId: 'course-1',
    regimenId: 'regimen-1',
    regimenRevision: 1,
    slotKey: 0,
    localDate: '2026-08-10',
    plannedAt: null,
    timezone: 'Asia/Tokyo',
    status: 'taken',
    actualAt: null,
    actualValue: null,
    actualUnit: null,
    actualText: null,
    route: null,
    site: null,
    reason: null,
    reaction: null,
    notes: null,
    originKind: 'manual',
    originProvider: null,
    originExternalId: null,
    revision: 1,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('planDoses', () => {
  it('expands daily clock slots into zone-correct instants', () => {
    const doses = planDoses(
      course(),
      regimen({ slots: [slot({ time: '08:00', anchorKind: 'clock' }), slot({ time: '21:30', anchorKind: 'clock' })] }),
      '2026-08-10',
      '2026-08-11',
    );

    expect(doses).toHaveLength(4);
    expect(doses[0]).toMatchObject({
      localDate: '2026-08-10',
      slotKey: 0,
      plannedAt: '2026-08-09T23:00:00.000Z',
    });
    expect(doses[1]).toMatchObject({
      localDate: '2026-08-10',
      slotKey: 1,
      plannedAt: '2026-08-10T12:30:00.000Z',
    });
  });

  it('leaves meal-anchored slots without a planned instant', () => {
    const doses = planDoses(
      course(),
      regimen({
        slots: [
          slot({ label: '朝食後', anchorKind: 'meal', anchorMeal: 'breakfast', amountValue: 2, amountUnit: '錠' }),
          slot({ label: '夕食後', anchorKind: 'meal', anchorMeal: 'dinner', amountValue: 2, amountUnit: '錠' }),
        ],
      }),
      '2026-08-10',
      '2026-08-10',
    );

    expect(doses).toHaveLength(2);
    expect(doses.every((dose) => dose.plannedAt === null)).toBe(true);
    expect(doses[0].slot?.anchorMeal).toBe('breakfast');
  });

  it('keeps weekly slots to the chosen weekday', () => {
    const doses = planDoses(
      course(),
      // 2026-08-10 is a Monday.
      regimen({ slots: [slot({ time: '09:00', anchorKind: 'clock' })], daysOfWeek: [1] }),
      '2026-08-09',
      '2026-08-22',
    );

    expect(doses.map((dose) => dose.localDate)).toEqual(['2026-08-10', '2026-08-17']);
  });

  it('steps interval rules from the anchor instant', () => {
    const doses = planDoses(
      course(),
      regimen({
        ruleKind: 'interval',
        intervalHours: 48,
        anchorAt: '2026-08-01T13:00:00.000Z',
        slots: [slot({ label: 'patch change', amountValue: 2, amountUnit: '枚' })],
      }),
      '2026-08-10',
      '2026-08-15',
    );

    expect(doses.map((dose) => [dose.localDate, dose.plannedAt, dose.slotKey])).toEqual([
      ['2026-08-11', '2026-08-11T13:00:00.000Z', 5],
      ['2026-08-13', '2026-08-13T13:00:00.000Z', 6],
      ['2026-08-15', '2026-08-15T13:00:00.000Z', 7],
    ]);
  });

  it('clips to the course and regimen windows', () => {
    const doses = planDoses(
      course({ startDate: '2026-08-05', endDate: '2026-08-06' }),
      regimen({ slots: [slot({ time: '08:00', anchorKind: 'clock' })], effectiveFrom: '2026-08-06' }),
      '2026-08-01',
      '2026-08-31',
    );

    expect(doses.map((dose) => dose.localDate)).toEqual(['2026-08-06']);
  });

  it('plans nothing for as-needed rules and planned courses', () => {
    expect(
      planDoses(course(), regimen({ ruleKind: 'as_needed' }), '2026-08-01', '2026-08-31'),
    ).toEqual([]);
    expect(
      planDoses(
        course({ status: 'planned' }),
        regimen({ slots: [slot({ time: '08:00', anchorKind: 'clock' })] }),
        '2026-08-01',
        '2026-08-31',
      ),
    ).toEqual([]);
  });

  it('moves a dose out of a daylight-saving gap instead of dropping it', () => {
    const doses = planDoses(
      course({ startDate: '2026-03-01' }),
      regimen({
        slots: [slot({ time: '02:30', anchorKind: 'clock' })],
        timezone: 'America/New_York',
        effectiveFrom: '2026-03-01',
      }),
      // Spring-forward in 2026 is March 8: 02:30 does not exist that day.
      '2026-03-08',
      '2026-03-08',
    );

    expect(doses).toHaveLength(1);
    // The gap collapses 02:30 onto the first instant that exists, 03:00 EDT.
    expect(doses[0].plannedAt).toBe('2026-03-08T07:00:00.000Z');
  });
});

describe('planDoses slot keys', () => {
  it('keeps a slot aimed at its saved key when earlier slots are removed', () => {
    const doses = planDoses(
      course(),
      regimen({ slots: [slot({ key: 1, time: '21:00', anchorKind: 'clock' })] }),
      '2026-08-10',
      '2026-08-10',
    );

    expect(doses).toHaveLength(1);
    expect(doses[0].slotKey).toBe(1);
  });
});

describe('buildDoseChecklist', () => {
  it('joins stored records onto their planned slots and keeps strays', () => {
    const planned = planDoses(
      course(),
      regimen({ slots: [slot({ time: '08:00', anchorKind: 'clock' })] }),
      '2026-08-10',
      '2026-08-11',
    );
    const stored = [
      occurrence({ localDate: '2026-08-10', slotKey: 0, status: 'taken' }),
      occurrence({ id: 'occurrence-2', regimenId: null, slotKey: null, localDate: '2026-08-10', status: 'taken' }),
      occurrence({ id: 'occurrence-3', localDate: '2026-07-30', slotKey: 0, status: 'skipped' }),
    ];

    const entries = buildDoseChecklist(planned, stored);

    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ localDate: '2026-07-30', status: 'skipped' });
    const monday = entries.filter((entry) => entry.localDate === '2026-08-10');
    expect(monday.map((entry) => entry.status).sort()).toEqual(['taken', 'taken']);
    expect(entries[3]).toMatchObject({ localDate: '2026-08-11', status: 'planned', record: null });
  });
});

describe('countAdherence', () => {
  it('counts only due slots and never invents a missed dose', () => {
    const planned = planDoses(
      course(),
      regimen({ slots: [slot({ time: '08:00', anchorKind: 'clock' })] }),
      '2026-08-10',
      '2026-08-13',
    );
    const entries = buildDoseChecklist(planned, [
      occurrence({ localDate: '2026-08-10', slotKey: 0, status: 'taken' }),
      occurrence({ id: 'occurrence-2', localDate: '2026-08-11', slotKey: 0, status: 'skipped' }),
    ]);

    const counts = countAdherence(entries, '2026-08-12T23:00:00.000Z');

    expect(counts).toMatchObject({ due: 4, taken: 1, skipped: 1, missed: 0, unrecorded: 2 });
  });

  it('treats label-only slots as due once the day has passed', () => {
    const planned = planDoses(
      course(),
      regimen({ slots: [slot({ label: '朝食後', anchorKind: 'meal', anchorMeal: 'breakfast' })] }),
      '2026-08-10',
      '2026-08-11',
    );
    const counts = countAdherence(buildDoseChecklist(planned, []), '2026-08-11T00:00:00.000Z');

    expect(counts).toMatchObject({ due: 1, unrecorded: 1 });
  });
});

describe('assignDoseSlotKeys', () => {
  it('keeps first claim on a key and moves duplicates to free keys', () => {
    const assigned = assignDoseSlotKeys([
      slot({ key: 1 }),
      slot({ key: 1 }),
      slot({ key: null }),
    ]);

    expect(assigned.map((entry) => entry.key)).toEqual([1, 0, 2]);
  });
});

describe('normalizers', () => {
  it('drops junk slots and keeps well-formed ones', () => {
    const slots = normalizeDoseSlots([
      { label: ' 朝食後 ', anchorKind: 'meal', anchorMeal: 'breakfast', amountValue: 2, amountUnit: '錠' },
      { time: '25:00' },
      'junk',
      { time: '08:30' },
    ]);

    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ label: '朝食後', anchorKind: 'meal', anchorMeal: 'breakfast' });
    expect(slots[1]).toMatchObject({ time: null });
    expect(slots[2]).toMatchObject({ time: '08:30', anchorKind: 'clock' });
  });

  it('normalizes weekday lists', () => {
    expect(normalizeDaysOfWeek([3, 1, 3, 9, -1])).toEqual([1, 3]);
    expect(normalizeDaysOfWeek([])).toBeNull();
    expect(normalizeDaysOfWeek('every day')).toBeNull();
  });
});

describe('addDays', () => {
  it('crosses month boundaries', () => {
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('activeCourseOf', () => {
  it('prefers the ongoing course over a later planned one', () => {
    const ongoing = course({ id: 'ongoing', status: 'active', startDate: '2026-01-01' });
    const planned = course({ id: 'planned', status: 'planned', startDate: '2026-09-01' });
    expect(activeCourseOf([planned, ongoing])?.id).toBe('ongoing');
  });

  it('falls back to the most recently started course', () => {
    const first = course({ id: 'first', status: 'ended', startDate: '2025-01-01' });
    const second = course({ id: 'second', status: 'ended', startDate: '2026-01-01' });
    expect(activeCourseOf([first, second])?.id).toBe('second');
    expect(activeCourseOf([])).toBeNull();
  });

  it('breaks a shared start date by creation time', () => {
    const earlier = course({ id: 'earlier', status: 'ended', createdAt: '2026-08-01T08:00:00.000Z' });
    const later = course({ id: 'later', status: 'ended', createdAt: '2026-08-01T09:00:00.000Z' });
    expect(activeCourseOf([earlier, later])?.id).toBe('later');
    expect(activeCourseOf([later, earlier])?.id).toBe('later');
  });
});

describe('currentRegimenOf', () => {
  const today = '2026-08-20';

  it('picks the rule in force and lets the latest start win', () => {
    const old = regimen({ id: 'old', effectiveFrom: '2026-08-01' });
    const revised = regimen({ id: 'revised', effectiveFrom: '2026-08-15' });
    expect(currentRegimenOf(course(), [old, revised], today)?.id).toBe('revised');
  });

  it('ignores rules that have ended, not yet begun, or belong elsewhere', () => {
    const ended = regimen({ id: 'ended', effectiveFrom: '2026-08-01', effectiveTo: '2026-08-10' });
    const future = regimen({ id: 'future', effectiveFrom: '2026-09-01' });
    const other = regimen({ id: 'other', courseId: 'course-2' });
    expect(currentRegimenOf(course(), [ended, future, other], today)).toBeNull();
  });

  it('breaks a shared start date by creation time', () => {
    const earlier = regimen({ id: 'earlier', createdAt: '2026-08-01T08:00:00.000Z' });
    const later = regimen({ id: 'later', createdAt: '2026-08-01T09:00:00.000Z' });
    expect(currentRegimenOf(course(), [earlier, later], today)?.id).toBe('later');
    expect(currentRegimenOf(course(), [later, earlier], today)?.id).toBe('later');
  });
});

describe('checklistDayOf', () => {
  it('judges the day on the slot\'s own zone', () => {
    const now = '2026-09-02T15:30:00Z'; // 00:30 on 2026-09-03 in Tokyo, 08:30 on 09-02 in Los Angeles
    expect(checklistDayOf({ localDate: '2026-09-03', timezone: 'Asia/Tokyo' }, now)).toBe('today');
    expect(checklistDayOf({ localDate: '2026-09-02', timezone: 'Asia/Tokyo' }, now)).toBe('yesterday');
    expect(checklistDayOf({ localDate: '2026-09-02', timezone: 'America/Los_Angeles' }, now)).toBe('today');
    expect(checklistDayOf({ localDate: '2026-09-01', timezone: 'America/Los_Angeles' }, now)).toBe('yesterday');
    expect(checklistDayOf({ localDate: '2026-09-03', timezone: 'America/Los_Angeles' }, now)).toBeNull();
    expect(checklistDayOf({ localDate: '2026-09-01', timezone: 'Asia/Tokyo' }, now)).toBeNull();
  });
});
