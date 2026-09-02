import * as m from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime';
import {
  formatDoseAmount,
  type DoseAnchorKind,
  type DoseAnchorMeal,
  type DoseRegimenRecord,
} from '$lib/medicine-plan';

export function anchorKindLabel(kind: DoseAnchorKind) {
  if (kind === 'clock') return m.anchor_clock();
  if (kind === 'wake') return m.anchor_wake();
  if (kind === 'meal') return m.anchor_meal();
  return m.anchor_bedtime();
}

export function anchorMealLabel(meal: DoseAnchorMeal) {
  if (meal === 'breakfast') return m.anchor_meal_breakfast();
  if (meal === 'lunch') return m.anchor_meal_lunch();
  return m.anchor_meal_dinner();
}

/** Short weekday names in the active locale, index 0 = Sunday. */
export function weekdayLabels() {
  const formatter = new Intl.DateTimeFormat(getLocale(), { weekday: 'short', timeZone: 'UTC' });
  // 2023-01-01 is a Sunday; index i renders weekday i.
  return [0, 1, 2, 3, 4, 5, 6].map((day) => formatter.format(new Date(Date.UTC(2023, 0, 1 + day))));
}

/** One line for when and how much: `08:00 1 tablet · 20:00 1 tablet · Mon Thu`. */
export function regimenSummary(regimen: DoseRegimenRecord) {
  if (regimen.ruleKind === 'as_needed') {
    return [m.regimen_as_needed(), regimen.doseText].filter(Boolean).join(' · ');
  }
  if (regimen.ruleKind === 'interval') {
    return [m.regimen_every_hours({ hours: regimen.intervalHours ?? 0 }), regimen.doseText]
      .filter(Boolean)
      .join(' · ');
  }

  const slots = regimen.slots.map((slot) => {
    const place =
      slot.time ||
      slot.label ||
      (slot.anchorKind === 'meal' && slot.anchorMeal
        ? anchorMealLabel(slot.anchorMeal)
        : slot.anchorKind
          ? anchorKindLabel(slot.anchorKind)
          : '');
    return [place, formatDoseAmount(slot, regimen.doseText)].filter(Boolean).join(' ');
  });
  const labels = weekdayLabels();
  const days = regimen.daysOfWeek ? regimen.daysOfWeek.map((day) => labels[day]).join(' ') : '';
  return [...slots, days].filter(Boolean).join(' · ');
}
