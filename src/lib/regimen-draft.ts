import type {
  DoseAnchorKind,
  DoseAnchorMeal,
  DoseRegimenRecord,
  RegimenRuleKind,
} from '$lib/medicine-plan';
import { toDateTimeLocal } from '$lib/time-zone';

/** One slot as the regimen editor holds it: strings, so the inputs bind directly. */
export type SlotDraft = {
  key: number | null;
  label: string;
  anchorKind: DoseAnchorKind | '';
  anchorMeal: DoseAnchorMeal;
  anchorOffsetMinutes: string;
  time: string;
  amountValue: string;
  amountUnit: string;
};

export type RegimenDraft = {
  id: string;
  revision: number;
  courseId: string;
  ruleKind: RegimenRuleKind;
  slots: SlotDraft[];
  daysOfWeek: number[];
  intervalHours: string;
  anchorAt: string;
  doseText: string;
  route: string;
  site: string;
  timezone: string;
  effectiveFrom: string;
  effectiveTo: string;
  remindMinutesBefore: string;
  notes: string;
};

export function emptySlot(): SlotDraft {
  return {
    key: null,
    label: '',
    anchorKind: '',
    anchorMeal: 'breakfast',
    anchorOffsetMinutes: '',
    time: '',
    amountValue: '',
    amountUnit: '',
  };
}

export function emptyRegimenDraft(timezone: string): RegimenDraft {
  return {
    id: '',
    revision: 0,
    courseId: '',
    ruleKind: 'fixed_slots',
    slots: [emptySlot()],
    daysOfWeek: [],
    intervalHours: '',
    anchorAt: '',
    doseText: '',
    route: '',
    site: '',
    timezone,
    effectiveFrom: '',
    effectiveTo: '',
    remindMinutesBefore: '',
    notes: '',
  };
}

export function regimenDraftOf(regimen: DoseRegimenRecord): RegimenDraft {
  return {
    id: regimen.id,
    revision: regimen.revision,
    courseId: regimen.courseId,
    ruleKind: regimen.ruleKind,
    slots:
      regimen.slots.length > 0
        ? regimen.slots.map((slot) => ({
            key: slot.key,
            label: slot.label || '',
            anchorKind: slot.anchorKind || '',
            anchorMeal: slot.anchorMeal || 'breakfast',
            anchorOffsetMinutes:
              slot.anchorOffsetMinutes === null ? '' : String(slot.anchorOffsetMinutes),
            time: slot.time || '',
            amountValue: slot.amountValue === null ? '' : String(slot.amountValue),
            amountUnit: slot.amountUnit || '',
          }))
        : [emptySlot()],
    daysOfWeek: regimen.daysOfWeek ? [...regimen.daysOfWeek] : [],
    intervalHours: regimen.intervalHours === null ? '' : String(regimen.intervalHours),
    anchorAt: regimen.anchorAt ? toDateTimeLocal(regimen.anchorAt, regimen.timezone) : '',
    doseText: regimen.doseText || '',
    route: regimen.route || '',
    site: regimen.site || '',
    timezone: regimen.timezone,
    effectiveFrom: regimen.effectiveFrom,
    effectiveTo: regimen.effectiveTo || '',
    remindMinutesBefore:
      regimen.remindMinutesBefore === null ? '' : String(regimen.remindMinutesBefore),
    notes: regimen.notes || '',
  };
}

/** The slots the form submits: blank rows dropped, strings turned into values. */
export function slotsJsonOf(draft: RegimenDraft) {
  return JSON.stringify(
    draft.slots
      .filter(
        (slot) =>
          slot.label || slot.time || slot.anchorKind || slot.amountValue || slot.amountUnit,
      )
      .map((slot) => ({
        key: slot.key,
        label: slot.label || null,
        anchorKind: slot.anchorKind || null,
        anchorMeal: slot.anchorKind === 'meal' ? slot.anchorMeal : null,
        anchorOffsetMinutes:
          slot.anchorKind && slot.anchorKind !== 'clock' && slot.anchorOffsetMinutes !== ''
            ? Number(slot.anchorOffsetMinutes)
            : null,
        time: slot.anchorKind === 'clock' || (!slot.anchorKind && slot.time) ? slot.time || null : null,
        amountValue: slot.amountValue === '' ? null : Number(slot.amountValue),
        amountUnit: slot.amountUnit || null,
      })),
  );
}
