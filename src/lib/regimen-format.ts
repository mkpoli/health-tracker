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

const weekdayCache = new Map<string, string[]>();

/** Short weekday names in the active locale, index 0 = Sunday. */
export function weekdayLabels() {
  const locale = getLocale();
  let labels = weekdayCache.get(locale);
  if (!labels) {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    // 2023-01-01 is a Sunday; index i renders weekday i.
    labels = [0, 1, 2, 3, 4, 5, 6].map((day) =>
      formatter.format(new Date(Date.UTC(2023, 0, 1 + day))),
    );
    weekdayCache.set(locale, labels);
  }
  return labels;
}

const cjk = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** Two fragments with a space between them, unless the boundary touches CJK text. */
function joinWords(a: string, b: string) {
  if (!a || !b) return a || b;
  return cjk.test(a.slice(-1)) || cjk.test(b[0]) ? `${a}${b}` : `${a} ${b}`;
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
    return joinWords(place, formatDoseAmount(slot, null) || '');
  });
  // The dose wording stands in once when no slot carries its own amount.
  const counted = regimen.slots.some((slot) => slot.amountValue !== null);
  const days = regimen.daysOfWeek
    ? regimen.daysOfWeek.map((day) => weekdayLabels()[day]).join(' ')
    : '';
  return [...slots, counted ? '' : regimen.doseText, days].filter(Boolean).join(' · ');
}
