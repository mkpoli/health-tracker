<script lang="ts">
  import { createModalController, refreshAfterSave } from '$lib/modal';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import { changedClaimFields, type EnergyClaimRevisionRecord } from '$lib/claim-revision';
  import type { EnergyCaptureProposal } from '$lib/health-capture';
  import type {
    EnergyClaimRecord,
    EnergyDirection,
    EnergyFoodDataSource,
    EnergyFoodItemRecord,
    EnergySourceRecord,
    EnergyStatus,
  } from '$lib/energy';
  import ClaimRevisionTimeline from './ClaimRevisionTimeline.svelte';
  import HealthCapture from './HealthCapture.svelte';

  let {
    patientId,
    entries = [],
    sources = [],
    revisions = [],
  }: {
    patientId: string;
    entries: EnergyClaimRecord[];
    sources: EnergySourceRecord[];
    revisions: EnergyClaimRevisionRecord[];
  } = $props();

  type EditorStatus = EnergyStatus | 'auto';

  type FoodDraft = {
    key: string;
    name: string;
    quantityValue: string;
    quantityUnit: string;
    energyKcal: string;
    energyKcalMin: string;
    energyKcalMax: string;
    proteinG: string;
    carbohydrateG: string;
    fatG: string;
    fiberG: string;
    sodiumMg: string;
    dataSource: EnergyFoodDataSource;
    notes: string;
  };

  type Draft = {
    id: string;
    revision: number;
    direction: EnergyDirection;
    label: string;
    category: string;
    energyKcal: string;
    occurredLocal: string;
    timezone: string;
    timezoneOffsetMinutes: number;
    durationMinutes: string;
    status: EditorStatus;
    notes: string;
    foods: FoodDraft[];
  };

  let editorOpen = $state(false);
  let saving = $state(false);
  let saveError = $state('');
  let captureReview = $state(false);
  let selectedDate = $state(todayLocalDate());
  let draft = $state<Draft>(newDraft('intake'));

  const sourcesByEntry = $derived.by(() => {
    const grouped = new Map<string, EnergySourceRecord[]>();
    for (const source of sources) {
      const current = grouped.get(source.energyClaimId) || [];
      current.push(source);
      grouped.set(source.energyClaimId, current);
    }
    return grouped;
  });

  const revisionsByEntry = $derived.by(() => {
    const grouped = new Map<string, EnergyClaimRevisionRecord[]>();
    for (const revision of revisions) {
      const history = grouped.get(revision.claimId) || [];
      history.push(revision);
      grouped.set(revision.claimId, history);
    }
    for (const history of grouped.values()) history.sort((a, b) => b.revision - a.revision);
    return grouped;
  });

  const selectedEntries = $derived(
    entries
      .filter((entry) => entry.localDate === selectedDate)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  );
  const selectedMeals = $derived(
    selectedEntries
      .filter((entry) => entry.direction === 'intake')
      .sort(
        (a, b) =>
          categoryRank(a.category) - categoryRank(b.category) ||
          a.occurredAt.localeCompare(b.occurredAt),
      ),
  );
  const selectedActivities = $derived(
    selectedEntries.filter((entry) => entry.direction === 'expenditure'),
  );
  const countedEntries = $derived(
    selectedEntries.filter((entry) => entry.status === 'recorded' && entry.energyKcal !== null),
  );
  const selectedIntake = $derived(
    countedEntries
      .filter((entry) => entry.direction === 'intake')
      .reduce((total, entry) => total + (entry.energyKcal || 0), 0),
  );
  const selectedExpenditure = $derived(
    countedEntries
      .filter((entry) => entry.direction === 'expenditure')
      .reduce((total, entry) => total + (entry.energyKcal || 0), 0),
  );
  const selectedDifference = $derived(
    Math.round((selectedIntake - selectedExpenditure) * 1000) / 1000,
  );
  const selectedPending = $derived(
    selectedEntries.filter((entry) => entry.status === 'draft' || entry.energyKcal === null).length,
  );
  const selectedMacros = $derived.by(() => {
    const foods = countedEntries
      .filter((entry) => entry.direction === 'intake')
      .flatMap((entry) => entry.foodItems);
    return {
      protein: sumKnown(foods, 'proteinG'),
      carbohydrate: sumKnown(foods, 'carbohydrateG'),
      fat: sumKnown(foods, 'fatG'),
    };
  });
  const draftMealTotal = $derived(
    draft.foods.length > 0 && draft.foods.every((food) => finiteDraftNumber(food.energyKcal) !== null)
      ? draft.foods.reduce((sum, food) => sum + (finiteDraftNumber(food.energyKcal) || 0), 0)
      : null,
  );
  const draftFoodItems = $derived(
    JSON.stringify(
      draft.foods.map(({ key: _key, ...food }) => ({
        ...food,
        quantityValue: nullableDraftNumber(food.quantityValue),
        energyKcal: nullableDraftNumber(food.energyKcal),
        energyKcalMin: nullableDraftNumber(food.energyKcalMin),
        energyKcalMax: nullableDraftNumber(food.energyKcalMax),
        proteinG: nullableDraftNumber(food.proteinG),
        carbohydrateG: nullableDraftNumber(food.carbohydrateG),
        fatG: nullableDraftNumber(food.fatG),
        fiberG: nullableDraftNumber(food.fiberG),
        sodiumMg: nullableDraftNumber(food.sodiumMg),
      })),
    ),
  );

  function pad(value: number) {
    return String(value).padStart(2, '0');
  }

  function todayLocalDate() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function currentLocalDateTime() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function browserTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  }

  function blankFood(): FoodDraft {
    return {
      key: crypto.randomUUID(),
      name: '',
      quantityValue: '',
      quantityUnit: '',
      energyKcal: '',
      energyKcalMin: '',
      energyKcalMax: '',
      proteinG: '',
      carbohydrateG: '',
      fatG: '',
      fiberG: '',
      sodiumMg: '',
      dataSource: 'unknown',
      notes: '',
    };
  }

  function foodDraft(item: EnergyFoodItemRecord): FoodDraft {
    return {
      key: item.id,
      name: item.name,
      quantityValue: numberInput(item.quantityValue),
      quantityUnit: item.quantityUnit || '',
      energyKcal: numberInput(item.energyKcal),
      energyKcalMin: numberInput(item.energyKcalMin),
      energyKcalMax: numberInput(item.energyKcalMax),
      proteinG: numberInput(item.proteinG),
      carbohydrateG: numberInput(item.carbohydrateG),
      fatG: numberInput(item.fatG),
      fiberG: numberInput(item.fiberG),
      sodiumMg: numberInput(item.sodiumMg),
      dataSource: item.dataSource,
      notes: item.notes || '',
    };
  }

  function newDraft(direction: EnergyDirection): Draft {
    return {
      id: '',
      revision: 0,
      direction,
      label: '',
      category: direction === 'intake' ? 'meal' : '',
      energyKcal: '',
      occurredLocal: currentLocalDateTime(),
      timezone: browserTimezone(),
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      durationMinutes: '',
      status: 'auto',
      notes: '',
      foods: direction === 'intake' ? [blankFood()] : [],
    };
  }

  function numberInput(value: number | null) {
    return value === null ? '' : String(value);
  }

  function finiteDraftNumber(value: string) {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function nullableDraftNumber(value: string) {
    return finiteDraftNumber(value);
  }

  function entryLocalDateTime(entry: EnergyClaimRecord) {
    const shifted = new Date(Date.parse(entry.occurredAt) + entry.timezoneOffsetMinutes * 60_000);
    return shifted.toISOString().slice(0, 16);
  }

  function openCreate(direction: EnergyDirection) {
    draft = newDraft(direction);
    saveError = '';
    captureReview = false;
    editorOpen = true;
  }

  function openEdit(entry: EnergyClaimRecord) {
    const legacyFood =
      entry.direction === 'intake' && entry.foodItems.length === 0
        ? [{
            ...blankFood(),
            name: entry.label || m.calories_unnamed_food(),
            energyKcal: numberInput(entry.energyKcal),
          }]
        : entry.foodItems.map(foodDraft);
    draft = {
      id: entry.id,
      revision: entry.revision,
      direction: entry.direction,
      label: entry.label || '',
      category: entry.category || '',
      energyKcal: numberInput(entry.energyKcal),
      occurredLocal: entryLocalDateTime(entry),
      timezone: entry.timezone || '',
      timezoneOffsetMinutes: entry.timezoneOffsetMinutes,
      durationMinutes: numberInput(entry.durationMinutes),
      status: entry.status,
      notes: entry.notes || '',
      foods: legacyFood,
    };
    saveError = '';
    captureReview = false;
    editorOpen = true;
  }

  function applyCapture(proposal: EnergyCaptureProposal, sourceMessage: string) {
    const direction = proposal.direction || 'intake';
    const sourceNote = m.capture_source_note({ message: sourceMessage });
    const next = newDraft(direction);
    draft = {
      ...next,
      category: direction === 'intake' ? proposal.category || 'meal' : '',
      energyKcal: proposal.energyKcal === null ? '' : String(proposal.energyKcal),
      occurredLocal: proposal.occurredLocal || currentLocalDateTime(),
      durationMinutes: proposal.durationMinutes === null ? '' : String(proposal.durationMinutes),
      notes: [proposal.notes, sourceNote].filter(Boolean).join('\n\n').slice(0, 4000),
      foods:
        direction === 'intake'
          ? [{
              ...blankFood(),
              name: proposal.label || '',
              energyKcal: proposal.energyKcal === null ? '' : String(proposal.energyKcal),
              dataSource: 'estimated',
            }]
          : [],
      label: direction === 'expenditure' ? proposal.label || '' : '',
    };
    updateDraftTimeZone();
    selectedDate = draft.occurredLocal.slice(0, 10);
    saveError = '';
    captureReview = true;
    editorOpen = true;
  }

  function updateDraftTimeZone() {
    const currentTimezone = browserTimezone();
    if (draft.id && draft.timezone && draft.timezone !== currentTimezone) return;
    const localDate = new Date(draft.occurredLocal);
    if (Number.isNaN(localDate.getTime())) return;
    draft.timezone = currentTimezone;
    draft.timezoneOffsetMinutes = -localDate.getTimezoneOffset();
  }

  function closeEditor() {
    if (saving) return;
    editorOpen = false;
    saveError = '';
    captureReview = false;
  }

  function addFood() {
    draft.foods = [...draft.foods, blankFood()];
  }

  function removeFood(key: string) {
    if (draft.foods.length <= 1) return;
    draft.foods = draft.foods.filter((food) => food.key !== key);
  }

  function changeDirection(direction: EnergyDirection) {
    draft.direction = direction;
    if (direction === 'intake' && draft.foods.length === 0) draft.foods = [blankFood()];
  }

  function changeSelectedDate(days: number) {
    const date = new Date(`${selectedDate}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return;
    date.setUTCDate(date.getUTCDate() + days);
    selectedDate = date.toISOString().slice(0, 10);
  }

  const submitEntry: SubmitFunction = ({ cancel }) => {
    if (saving) { cancel(); return; }
    saving = true;
    saveError = '';
    return async ({ result, update }) => {
      try {
        if (result.type === 'success') {
          await refreshAfterSave(() => update({ reset: false, invalidateAll: true }));
          editorOpen = false;
          captureReview = false;
          draft = newDraft('intake');
          return;
        }

        if (result.type === 'failure' && result.status === 409) {
          await invalidateAll();
          saveError = m.claim_revision_stale();
        } else {
          saveError = m.calories_save_failed();
        }
      } catch {
        saveError = m.calories_save_failed();
      } finally {
        saving = false;
      }
    };
  };

  function statusLabel(status: EnergyStatus) {
    if (status === 'recorded') return m.calories_status_recorded();
    if (status === 'draft') return m.calories_status_draft();
    return m.calories_status_excluded();
  }

  function statusTone(status: EnergyStatus) {
    if (status === 'recorded') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'draft') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-slate-200 bg-slate-50 text-slate-600';
  }

  function entryLabel(entry: EnergyClaimRecord) {
    if (entry.label) return entry.label;
    return entry.direction === 'intake' ? categoryLabel(entry.category) : m.calories_unnamed_activity();
  }

  function categoryLabel(category: string | null) {
    if (category === 'breakfast') return m.calories_meal_breakfast();
    if (category === 'lunch') return m.calories_meal_lunch();
    if (category === 'dinner' || category === 'late_dinner') return m.calories_meal_dinner();
    if (category === 'snack') return m.calories_meal_snack();
    if (category === 'drink') return m.calories_meal_drink();
    return m.calories_meal_other();
  }

  function categoryRank(category: string | null) {
    const rank = ['breakfast', 'lunch', 'dinner', 'late_dinner', 'snack', 'drink', 'meal'].indexOf(
      category || 'meal',
    );
    return rank < 0 ? 99 : rank;
  }

  function formatKcal(value: number) {
    return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value);
  }

  function formatNutrient(value: number) {
    return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value);
  }

  function formatDateOnly(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat(getLocale(), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  function formatEntryTime(entry: EnergyClaimRecord) {
    const shifted = new Date(Date.parse(entry.occurredAt) + entry.timezoneOffsetMinutes * 60_000);
    return new Intl.DateTimeFormat(getLocale(), {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(shifted);
  }

  function formatQuantity(item: EnergyFoodItemRecord) {
    if (item.quantityValue === null) return item.quantityUnit || '';
    return [formatNutrient(item.quantityValue), item.quantityUnit].filter(Boolean).join(' ');
  }

  function foodSourceLabel(source: EnergyFoodDataSource) {
    if (source === 'label') return m.calories_source_label();
    if (source === 'database') return m.calories_source_database();
    if (source === 'estimated') return m.calories_source_estimated();
    return m.calories_source_unknown();
  }

  function sumKnown(
    items: EnergyFoodItemRecord[],
    key: 'proteinG' | 'carbohydrateG' | 'fatG',
  ) {
    const values = items.map((item) => item[key]).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }

  function foodRange(item: EnergyFoodItemRecord) {
    if (item.energyKcalMin === null && item.energyKcalMax === null) return '';
    return m.calories_estimate_range({
      min: item.energyKcalMin === null ? '—' : formatKcal(item.energyKcalMin),
      max: item.energyKcalMax === null ? '—' : formatKcal(item.energyKcalMax),
    });
  }

  function energyFieldLabel(field: string, snapshot: EnergyClaimRecord) {
    if (field === 'foodItems') return m.calories_foods_in_meal();
    if (field === 'direction') return m.calories_entry_type();
    if (field === 'label') return snapshot.direction === 'intake' ? m.calories_meal_name() : m.calories_activity_name();
    if (field === 'category') return m.calories_meal_type();
    if (field === 'energyKcal') return m.calories_energy();
    if (field === 'occurredAt') return m.calories_time();
    if (field === 'localDate') return m.claim_field_local_date();
    if (field === 'timezone' || field === 'timezoneOffsetMinutes') return m.claim_field_time_zone();
    if (field === 'durationMinutes') return m.calories_duration();
    if (field === 'status') return m.calories_counting_state();
    if (field === 'notes') return m.notes();
    if (field === 'originExternalId') return m.claim_field_source_reference();
    if (field === 'originKind' || field === 'originProvider') return m.claim_field_source();
    return field;
  }

  function energyRevisionItems(entry: EnergyClaimRecord) {
    const history = revisionsByEntry.get(entry.id) || [];
    return history.map((revision, index) => {
      const previous = history[index + 1]?.snapshot || null;
      const snapshot = revision.snapshot;
      const fields = changedClaimFields(snapshot, previous).map((field) =>
        energyFieldLabel(field, snapshot),
      );
      const energy =
        snapshot.energyKcal === null
          ? m.calories_estimate_needed()
          : `${formatKcal(snapshot.energyKcal)} kcal`;
      return {
        id: revision.id,
        revision: revision.revision,
        changedAt: revision.changedAt,
        current: revision.revision === entry.revision,
        changedFields: [...new Set(fields)],
        primary: [entryLabel(snapshot), energy].join(' · '),
        secondary: [
          statusLabel(snapshot.status),
          `${formatDateOnly(snapshot.localDate)} ${formatEntryTime(snapshot)}`,
        ].join(' · '),
      };
    });
  }

  const editorModal = createModalController({ onClose: closeEditor, busy: () => saving, draft: () => draft, dirty: () => captureReview });
</script>


<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  <header class="border-b border-slate-100 bg-gradient-to-br from-orange-50 via-white to-amber-50 px-5 py-5 sm:px-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div class="flex items-start gap-3">
        <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 3.75v6a4.5 4.5 0 009 0v-6M5.25 20.25h13.5M12 14.25v6" />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold tracking-tight text-slate-900">{m.calories_title()}</h3>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">{m.calories_subtitle()}</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:flex">
        <button type="button" onclick={() => openCreate('intake')} class="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2">
          <span class="text-base leading-none">+</span>{m.calories_add_food()}
        </button>
        <button type="button" onclick={() => openCreate('expenditure')} class="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2">
          <span class="text-base leading-none">+</span>{m.calories_add_activity()}
        </button>
      </div>
    </div>
  </header>

  <div class="space-y-6 p-4 sm:p-6">
    <HealthCapture
      kind="energy"
      {patientId}
      onproposal={(proposal, sourceMessage) => {
        if (proposal.kind === 'energy') applyCapture(proposal, sourceMessage);
      }}
    />

    <section aria-labelledby="calorie-day-heading">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h4 id="calorie-day-heading" class="text-sm font-semibold text-slate-800">{m.calories_daily_diary()}</h4>
          <p class="mt-1 text-lg font-semibold tracking-tight text-slate-950">{formatDateOnly(selectedDate)}</p>
        </div>
        <div class="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button type="button" onclick={() => changeSelectedDate(-1)} aria-label={m.calories_previous_day()} class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">←</button>
          <button type="button" onclick={() => (selectedDate = todayLocalDate())} class="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">{m.calories_today()}</button>
          <input type="date" bind:value={selectedDate} aria-label={m.calories_summary_date()} class="w-10 cursor-pointer rounded-lg border-0 p-2 text-transparent focus:ring-2 focus:ring-orange-500" />
          <button type="button" onclick={() => changeSelectedDate(1)} aria-label={m.calories_next_day()} class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">→</button>
        </div>
      </div>

      <div class="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div class="rounded-2xl bg-slate-950 p-5 text-white shadow-sm">
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-orange-300">{m.calories_intake()}</p>
          <p class="mt-2 text-3xl font-semibold tracking-tight">{formatKcal(selectedIntake)} <span class="text-sm font-medium text-slate-400">kcal</span></p>
          <div class="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
            {#if selectedMacros.protein !== null}<span>{m.calories_protein_short()} {formatNutrient(selectedMacros.protein)} g</span>{/if}
            {#if selectedMacros.carbohydrate !== null}<span>{m.calories_carbs_short()} {formatNutrient(selectedMacros.carbohydrate)} g</span>{/if}
            {#if selectedMacros.fat !== null}<span>{m.calories_fat_short()} {formatNutrient(selectedMacros.fat)} g</span>{/if}
          </div>
        </div>
        <div class="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5">
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{m.calories_activity()}</p>
          <p class="mt-2 text-2xl font-semibold tracking-tight text-emerald-950">{formatKcal(selectedExpenditure)} <span class="text-sm font-medium text-emerald-600">kcal</span></p>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{m.calories_logged_difference()}</p>
          <p class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{selectedDifference > 0 ? '+' : ''}{formatKcal(selectedDifference)} <span class="text-sm font-medium text-slate-500">kcal</span></p>
        </div>
      </div>
      <div class="mt-3 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>{m.calories_balance_note()}</p>
        {#if selectedPending > 0}<p class="font-semibold text-amber-700">{m.calories_pending_count({ count: selectedPending })}</p>{/if}
      </div>
    </section>

    <section aria-labelledby="calorie-journal-heading">
      <div class="mb-4 flex items-center justify-between">
        <h4 id="calorie-journal-heading" class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{m.calories_journal()}</h4>
        <p class="text-xs text-slate-400">{m.calories_entry_count({ count: selectedEntries.length })}</p>
      </div>

      {#if selectedEntries.length === 0}
        <div class="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center">
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-2xl">🍽️</div>
          <h5 class="mt-4 font-semibold text-slate-800">{m.calories_day_empty()}</h5>
          <p class="mt-1 max-w-md text-sm text-slate-500">{m.calories_day_empty_hint()}</p>
        </div>
      {:else}
        <div class="space-y-6">
          {#if selectedMeals.length > 0}
            <div class="space-y-3">
              <h5 class="text-sm font-semibold text-slate-700">{m.calories_meals()}</h5>
              {#each selectedMeals as entry (entry.id)}
                {@const entrySources = sourcesByEntry.get(entry.id) || []}
                <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div class="flex gap-4 p-4 sm:p-5">
                    {#if entrySources[0]}
                      <img src={entrySources[0].sourceUrl} alt={m.calories_photo_alt({ name: entryLabel(entry) })} class="h-20 w-20 shrink-0 rounded-xl object-cover sm:h-24 sm:w-24" loading="lazy" decoding="async" />
                    {/if}
                    <div class="min-w-0 flex-1">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="flex flex-wrap items-center gap-2 text-xs">
                            <span class="font-semibold text-orange-700">{categoryLabel(entry.category)}</span>
                            <span class="text-slate-400">{formatEntryTime(entry)}</span>
                            <span class={`rounded-full border px-2 py-0.5 font-semibold ${statusTone(entry.status)}`}>{statusLabel(entry.status)}</span>
                          </div>
                          <h6 class="mt-1.5 font-semibold text-slate-900">{entryLabel(entry)}</h6>
                        </div>
                        <button type="button" onclick={() => openEdit(entry)} class="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700">{m.calories_edit_entry()}</button>
                      </div>
                      <div class="mt-2">
                        {#if entry.energyKcal !== null}
                          <span class="text-xl font-semibold tracking-tight text-slate-950">{formatKcal(entry.energyKcal)} <span class="text-xs font-medium text-slate-500">kcal</span></span>
                        {:else}
                          <span class="text-sm font-semibold text-amber-700">{m.calories_estimate_needed()}</span>
                        {/if}
                      </div>
                    </div>
                  </div>

                  {#if entry.foodItems.length > 0}
                    <ul class="divide-y divide-slate-100 border-t border-slate-100">
                      {#each entry.foodItems as food (food.id)}
                        <li class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 sm:px-5">
                          <div class="min-w-0">
                            <div class="flex flex-wrap items-baseline gap-x-2">
                              <p class="font-medium text-slate-800">{food.name}</p>
                              {#if formatQuantity(food)}<span class="text-xs text-slate-400">{formatQuantity(food)}</span>{/if}
                            </div>
                            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                              <span>{foodSourceLabel(food.dataSource)}</span>
                              {#if foodRange(food)}<span>{foodRange(food)}</span>{/if}
                              {#if food.proteinG !== null}<span>{m.calories_protein_short()} {formatNutrient(food.proteinG)} g</span>{/if}
                              {#if food.carbohydrateG !== null}<span>{m.calories_carbs_short()} {formatNutrient(food.carbohydrateG)} g</span>{/if}
                              {#if food.fatG !== null}<span>{m.calories_fat_short()} {formatNutrient(food.fatG)} g</span>{/if}
                            </div>
                          </div>
                          <p class={food.energyKcal === null ? 'text-sm font-semibold text-amber-700' : 'text-sm font-semibold tabular-nums text-slate-800'}>
                            {food.energyKcal === null ? m.calories_pending_short() : `${formatKcal(food.energyKcal)} kcal`}
                          </p>
                        </li>
                      {/each}
                    </ul>
                  {/if}

                  {#if entry.notes}<p class="border-t border-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-600 sm:px-5">{entry.notes}</p>{/if}
                  <ClaimRevisionTimeline items={energyRevisionItems(entry)} />
                  <div class="flex justify-end border-t border-slate-100 px-4 py-2.5">
                    <form method="POST" action="?/deleteEnergyEntry" use:enhance={(submission) => {
                      if (!confirm(m.calories_delete_confirm({ name: entryLabel(entry) }))) {
                        submission.cancel();
                        return;
                      }
                      return async ({ result, update }) => {
                        await update();
                        if (result.type !== 'success') alert(m.calories_delete_failed());
                      };
                    }}>
                      <input type="hidden" name="id" value={entry.id} />
                      <button type="submit" class="text-xs font-semibold text-rose-600 hover:text-rose-700">{m.calories_delete_entry()}</button>
                    </form>
                  </div>
                </article>
              {/each}
            </div>
          {/if}

          {#if selectedActivities.length > 0}
            <div class="space-y-3">
              <h5 class="text-sm font-semibold text-slate-700">{m.calories_activities()}</h5>
              {#each selectedActivities as entry (entry.id)}
                <article class="flex items-center justify-between gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                  <div>
                    <p class="font-semibold text-slate-900">{entryLabel(entry)}</p>
                    <p class="mt-1 text-xs text-slate-500">{formatEntryTime(entry)}{entry.durationMinutes === null ? '' : ` · ${m.calories_duration_value({ minutes: entry.durationMinutes })}`}</p>
                  </div>
                  <div class="flex items-center gap-3">
                    <p class="font-semibold text-emerald-800">{entry.energyKcal === null ? '—' : formatKcal(entry.energyKcal)} kcal</p>
                    <button type="button" onclick={() => openEdit(entry)} class="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">{m.calories_edit_entry()}</button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>
  </div>
</section>

{#if editorOpen}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/55 backdrop-blur-sm sm:items-center sm:p-6"
    role="presentation"
  >
    <div
      class="sheet-enter app-scroll flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:rounded-2xl"
      use:editorModal.attach role="dialog"
      aria-modal="true"
      aria-labelledby="calorie-editor-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
        <div>
          <h2 id="calorie-editor-title" class="text-xl font-semibold tracking-tight text-slate-900">{draft.id ? m.calories_edit_entry() : m.calories_add_entry()}</h2>
          <p class="mt-1 text-sm text-slate-500">{m.calories_editor_hint()}</p>
        </div>
        <button
          type="button"
          onclick={editorModal.requestClose}
          disabled={saving}
          class="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-700 disabled:opacity-40"
          aria-label={m.close()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <form method="POST" action={draft.id ? '?/updateEnergyEntry' : '?/createEnergyEntry'} enctype="multipart/form-data" use:enhance={submitEntry} class="app-scroll flex-1 overflow-y-auto">
        <input type="hidden" name="patientId" value={patientId} />
        {#if draft.id}<input type="hidden" name="id" value={draft.id} /><input type="hidden" name="revision" value={draft.revision} />{/if}
        <input type="hidden" name="timezone" value={draft.timezone} />
        <input type="hidden" name="timezoneOffsetMinutes" value={draft.timezoneOffsetMinutes} />
        {#if draft.direction === 'intake'}<input type="hidden" name="foodItems" value={draftFoodItems} />{/if}

        <div class="space-y-6 px-5 py-5 sm:px-6 sm:py-6">
          {#if captureReview}<p class="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-relaxed text-amber-800">{m.capture_editor_notice()}</p>{/if}

          <fieldset>
            <legend class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{m.calories_entry_type()}</legend>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <label class="cursor-pointer">
                <input class="peer sr-only" type="radio" name="direction" value="intake" checked={draft.direction === 'intake'} onchange={() => changeDirection('intake')} />
                <span class="flex items-center justify-center rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-600 peer-checked:border-orange-300 peer-checked:bg-orange-50 peer-checked:text-orange-800">{m.calories_intake()}</span>
              </label>
              <label class="cursor-pointer">
                <input class="peer sr-only" type="radio" name="direction" value="expenditure" checked={draft.direction === 'expenditure'} onchange={() => changeDirection('expenditure')} />
                <span class="flex items-center justify-center rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-600 peer-checked:border-emerald-300 peer-checked:bg-emerald-50 peer-checked:text-emerald-800">{m.calories_activity()}</span>
              </label>
            </div>
          </fieldset>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="sm:col-span-2">
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{draft.direction === 'intake' ? m.calories_meal_name() : m.calories_activity_name()}</span>
              <input name="label" type="text" bind:value={draft.label} maxlength="300" autocomplete="off" placeholder={draft.direction === 'intake' ? m.calories_meal_name_placeholder() : m.calories_activity_name_placeholder()} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500" />
            </label>
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_time()}</span>
              <input name="occurredLocal" type="datetime-local" bind:value={draft.occurredLocal} onchange={updateDraftTimeZone} required class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500" />
            </label>
            {#if draft.direction === 'intake'}
              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_meal_type()}</span>
                <select name="category" bind:value={draft.category} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500">
                  <option value="meal">{m.calories_meal_other()}</option>
                  <option value="breakfast">{m.calories_meal_breakfast()}</option>
                  <option value="lunch">{m.calories_meal_lunch()}</option>
                  <option value="dinner">{m.calories_meal_dinner()}</option>
                  <option value="snack">{m.calories_meal_snack()}</option>
                  <option value="drink">{m.calories_meal_drink()}</option>
                </select>
              </label>
            {:else}
              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_energy()}</span>
                <div class="relative"><input name="energyKcal" type="number" bind:value={draft.energyKcal} min="0" max="1000000" step="0.1" inputmode="decimal" class="w-full rounded-lg border-slate-300 px-3 py-2.5 pr-14 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500" /><span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-400">kcal</span></div>
              </label>
              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_duration()}</span>
                <div class="relative"><input name="durationMinutes" type="number" bind:value={draft.durationMinutes} min="0" max="10080" step="1" inputmode="numeric" class="w-full rounded-lg border-slate-300 px-3 py-2.5 pr-20 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500" /><span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-400">{m.calories_minutes()}</span></div>
              </label>
            {/if}
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_counting_state()}</span>
              <select name="status" bind:value={draft.status} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500">
                {#if !draft.id}<option value="auto">{m.calories_status_auto()}</option>{/if}
                <option value="recorded">{m.calories_status_recorded()}</option>
                <option value="draft">{m.calories_status_draft()}</option>
                <option value="excluded">{m.calories_status_excluded()}</option>
              </select>
            </label>
          </div>

          {#if draft.direction === 'intake'}
            <section aria-labelledby="meal-foods-heading">
              <div class="flex items-end justify-between gap-4">
                <div>
                  <h3 id="meal-foods-heading" class="text-sm font-semibold text-slate-900">{m.calories_foods_in_meal()}</h3>
                  <p class="mt-1 text-xs text-slate-500">{m.calories_foods_hint()}</p>
                </div>
                <div class="text-right">
                  <p class="text-xs text-slate-400">{m.calories_meal_total()}</p>
                  <p class={draftMealTotal === null ? 'font-semibold text-amber-700' : 'font-semibold text-slate-900'}>{draftMealTotal === null ? m.calories_pending_short() : `${formatKcal(draftMealTotal)} kcal`}</p>
                </div>
              </div>

              <div class="mt-3 space-y-3">
                {#each draft.foods as food, index (food.key)}
                  <div class="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                    <div class="mb-3 flex items-center justify-between">
                      <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{m.calories_food_number({ number: index + 1 })}</p>
                      {#if draft.foods.length > 1}<button type="button" onclick={() => removeFood(food.key)} class="text-xs font-semibold text-rose-600 hover:text-rose-700">{m.delete()}</button>{/if}
                    </div>
                    <div class="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
                      <label>
                        <span class="mb-1 block text-xs font-medium text-slate-600">{m.calories_food_item_name()}</span>
                        <input type="text" bind:value={food.name} maxlength="300" required placeholder={m.calories_food_item_placeholder()} class="w-full rounded-lg border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                      </label>
                      <label>
                        <span class="mb-1 block text-xs font-medium text-slate-600">{m.calories_quantity()}</span>
                        <input type="number" bind:value={food.quantityValue} min="0" max="1000000" step="any" inputmode="decimal" class="w-full rounded-lg border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                      </label>
                      <label>
                        <span class="mb-1 block text-xs font-medium text-slate-600">{m.calories_quantity_unit()}</span>
                        <input type="text" bind:value={food.quantityUnit} maxlength="40" placeholder={m.calories_quantity_unit_placeholder()} class="w-full rounded-lg border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500" />
                      </label>
                      <label>
                        <span class="mb-1 block text-xs font-medium text-slate-600">{m.calories_energy()}</span>
                        <div class="relative"><input type="number" bind:value={food.energyKcal} min="0" max="1000000" step="0.1" inputmode="decimal" class="w-full rounded-lg border-slate-300 px-3 py-2 pr-12 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500" /><span class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-400">kcal</span></div>
                      </label>
                    </div>

                    <details class="mt-3 rounded-xl border border-slate-200 bg-white">
                      <summary class="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">{m.calories_nutrition_details()}</summary>
                      <div class="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-3">
                        <label><span class="mb-1 block text-xs text-slate-500">{m.calories_data_source()}</span><select bind:value={food.dataSource} class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm"><option value="unknown">{m.calories_source_unknown()}</option><option value="label">{m.calories_source_label()}</option><option value="database">{m.calories_source_database()}</option><option value="estimated">{m.calories_source_estimated()}</option></select></label>
                        <label><span class="mb-1 block text-xs text-slate-500">{m.calories_estimate_min()}</span><input type="number" bind:value={food.energyKcalMin} min="0" step="0.1" class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm" /></label>
                        <label><span class="mb-1 block text-xs text-slate-500">{m.calories_estimate_max()}</span><input type="number" bind:value={food.energyKcalMax} min="0" step="0.1" class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm" /></label>
                        <label><span class="mb-1 block text-xs text-slate-500">{m.calories_protein()}</span><input type="number" bind:value={food.proteinG} min="0" step="0.1" class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm" /></label>
                        <label><span class="mb-1 block text-xs text-slate-500">{m.calories_carbohydrate()}</span><input type="number" bind:value={food.carbohydrateG} min="0" step="0.1" class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm" /></label>
                        <label><span class="mb-1 block text-xs text-slate-500">{m.calories_fat()}</span><input type="number" bind:value={food.fatG} min="0" step="0.1" class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm" /></label>
                        <label><span class="mb-1 block text-xs text-slate-500">{m.calories_fiber()}</span><input type="number" bind:value={food.fiberG} min="0" step="0.1" class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm" /></label>
                        <label><span class="mb-1 block text-xs text-slate-500">{m.calories_sodium()}</span><input type="number" bind:value={food.sodiumMg} min="0" step="0.1" class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm" /></label>
                        <label class="sm:col-span-3"><span class="mb-1 block text-xs text-slate-500">{m.notes()}</span><input type="text" bind:value={food.notes} maxlength="1000" class="w-full rounded-lg border-slate-300 px-2.5 py-2 text-sm" /></label>
                      </div>
                    </details>
                  </div>
                {/each}
              </div>
              <button type="button" onclick={addFood} class="mt-3 inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-100"><span>+</span>{m.calories_add_food_item()}</button>
            </section>
          {/if}

          {#if !draft.id && draft.direction === 'intake'}
            <label class="block rounded-xl border border-dashed border-orange-200 bg-orange-50/50 p-4">
              <span class="block text-sm font-semibold text-orange-900">{m.calories_source_photo()}</span>
              <span class="mt-1 block text-xs leading-relaxed text-orange-700">{m.calories_source_photo_hint()}</span>
              <input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif" capture="environment" class="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-orange-700 file:shadow-sm hover:file:bg-orange-100" />
            </label>
          {/if}

          {#if draft.id && (sourcesByEntry.get(draft.id)?.length || 0) > 0}<p class="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">{m.calories_existing_photo_retained()}</p>{/if}

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.notes()}</span>
            <textarea name="notes" bind:value={draft.notes} rows="3" maxlength="4000" placeholder={m.calories_notes_placeholder()} class="w-full resize-y rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500"></textarea>
          </label>
          {#if saveError}<p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{saveError}</p>{/if}
        </div>

        <footer class="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-6" style="padding-bottom: calc(1rem + var(--safe-bottom))">
          <button
            type="button"
            onclick={editorModal.requestClose}
            disabled={saving}
            class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {m.cancel()}
          </button>
          <button
            type="submit"
            disabled={saving}
            class="rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:cursor-wait disabled:bg-orange-400"
          >
            {saving ? m.saving() : draft.id ? m.calories_update_entry() : m.calories_save_entry()}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}
