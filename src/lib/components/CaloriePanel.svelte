<script lang="ts">
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import type {
    EnergyClaimRecord,
    EnergyDirection,
    EnergySourceRecord,
    EnergyStatus,
  } from '$lib/energy';

  let {
    patientId,
    entries = [],
    sources = [],
  }: {
    patientId: string;
    entries: EnergyClaimRecord[];
    sources: EnergySourceRecord[];
  } = $props();

  type EditorStatus = EnergyStatus | 'auto';

  type Draft = {
    id: string;
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
  };

  let editorOpen = $state(false);
  let saving = $state(false);
  let saveError = $state('');
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

  const selectedEntries = $derived(entries.filter((entry) => entry.localDate === selectedDate));
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

  const historyGroups = $derived.by(() => {
    const dates = [...new Set(entries.map((entry) => entry.localDate))].sort((a, b) => b.localeCompare(a));
    return dates.map((date) => ({
      date,
      entries: entries
        .filter((entry) => entry.localDate === date)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    }));
  });

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

  function newDraft(direction: EnergyDirection): Draft {
    return {
      id: '',
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
    };
  }

  function entryLocalDateTime(entry: EnergyClaimRecord) {
    const shifted = new Date(Date.parse(entry.occurredAt) + entry.timezoneOffsetMinutes * 60_000);
    return shifted.toISOString().slice(0, 16);
  }

  function openCreate(direction: EnergyDirection) {
    draft = newDraft(direction);
    saveError = '';
    editorOpen = true;
  }

  function openEdit(entry: EnergyClaimRecord) {
    draft = {
      id: entry.id,
      direction: entry.direction,
      label: entry.label || '',
      category: entry.category || '',
      energyKcal: entry.energyKcal === null ? '' : String(entry.energyKcal),
      occurredLocal: entryLocalDateTime(entry),
      timezone: entry.timezone || '',
      timezoneOffsetMinutes: entry.timezoneOffsetMinutes,
      durationMinutes: entry.durationMinutes === null ? '' : String(entry.durationMinutes),
      status: entry.status,
      notes: entry.notes || '',
    };
    saveError = '';
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
  }

  const submitEntry: SubmitFunction = () => {
    saving = true;
    saveError = '';

    return async ({ result, update }) => {
      if (result.type === 'success') {
        await update({ reset: true, invalidateAll: true });
        saving = false;
        editorOpen = false;
        draft = newDraft('intake');
        return;
      }

      saving = false;
      saveError = m.calories_save_failed();
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

  function directionLabel(direction: EnergyDirection) {
    return direction === 'intake' ? m.calories_intake() : m.calories_activity();
  }

  function entryLabel(entry: EnergyClaimRecord) {
    if (entry.label) return entry.label;
    return entry.direction === 'intake' ? m.calories_unnamed_meal() : m.calories_unnamed_activity();
  }

  function categoryLabel(category: string | null) {
    if (category === 'breakfast') return m.calories_meal_breakfast();
    if (category === 'lunch') return m.calories_meal_lunch();
    if (category === 'dinner') return m.calories_meal_dinner();
    if (category === 'snack') return m.calories_meal_snack();
    if (category === 'drink') return m.calories_meal_drink();
    if (category === 'meal') return m.calories_meal_other();
    return category || '';
  }

  function formatKcal(value: number) {
    return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(value);
  }

  function formatDateOnly(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(date);
  }

  function formatEntryTime(entry: EnergyClaimRecord) {
    const shifted = new Date(Date.parse(entry.occurredAt) + entry.timezoneOffsetMinutes * 60_000);
    return new Intl.DateTimeFormat(getLocale(), {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(shifted);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && editorOpen) closeEditor();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  <header class="border-b border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div class="flex items-start gap-3">
        <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3.75c-1.72 2.4-4.5 4.97-4.5 8.25a4.5 4.5 0 109 0c0-3.28-2.78-5.85-4.5-8.25z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 10.5c-.9 1.12-1.5 2.08-1.5 3a1.5 1.5 0 003 0c0-.92-.6-1.88-1.5-3z" />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold tracking-tight text-slate-900">{m.calories_title()}</h3>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">{m.calories_subtitle()}</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:flex">
        <button
          type="button"
          onclick={() => openCreate('intake')}
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
        >
          <span class="text-base leading-none">+</span>
          {m.calories_add_food()}
        </button>
        <button
          type="button"
          onclick={() => openCreate('expenditure')}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm transition-colors hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
        >
          <span class="text-base leading-none">+</span>
          {m.calories_add_activity()}
        </button>
      </div>
    </div>
  </header>

  <div class="space-y-8 p-4 sm:p-6">
    <section aria-labelledby="calorie-day-heading">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 id="calorie-day-heading" class="text-sm font-semibold text-slate-800">{m.calories_day_summary()}</h4>
          <p class="mt-0.5 text-xs text-slate-500">{m.calories_recorded_only()}</p>
        </div>
        <input
          type="date"
          bind:value={selectedDate}
          aria-label={m.calories_summary_date()}
          class="rounded-lg border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-orange-500 focus:ring-orange-500"
        />
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-2xl border border-orange-100 bg-orange-50/70 p-4">
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-orange-600">{m.calories_intake()}</p>
          <p class="mt-2 text-2xl font-semibold tracking-tight text-orange-950">
            {formatKcal(selectedIntake)} <span class="text-sm font-medium text-orange-600">kcal</span>
          </p>
        </div>
        <div class="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">{m.calories_activity()}</p>
          <p class="mt-2 text-2xl font-semibold tracking-tight text-emerald-950">
            {formatKcal(selectedExpenditure)} <span class="text-sm font-medium text-emerald-600">kcal</span>
          </p>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{m.calories_logged_difference()}</p>
          <p class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            {selectedDifference > 0 ? '+' : ''}{formatKcal(selectedDifference)}
            <span class="text-sm font-medium text-slate-500">kcal</span>
          </p>
        </div>
      </div>

      <div class="mt-3 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>{m.calories_balance_note()}</p>
        {#if selectedPending > 0}
          <p class="font-semibold text-amber-700">{m.calories_pending_count({ count: selectedPending })}</p>
        {/if}
      </div>
    </section>

    <section aria-labelledby="calorie-journal-heading">
      <h4 id="calorie-journal-heading" class="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {m.calories_journal()}
      </h4>

      {#if entries.length === 0}
        <div class="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 px-6 py-14 text-center">
          <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="h-7 w-7" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 3.75v6a3 3 0 003 3h9a3 3 0 003-3v-6M8.25 20.25h7.5M12 12.75v7.5" />
            </svg>
          </div>
          <h5 class="mt-4 font-semibold text-slate-800">{m.calories_empty()}</h5>
          <p class="mt-1 max-w-md text-sm text-slate-500">{m.calories_empty_hint()}</p>
        </div>
      {:else}
        <div class="space-y-7">
          {#each historyGroups as group (group.date)}
            <div>
              <h5 class="mb-3 text-sm font-semibold text-slate-700">{formatDateOnly(group.date)}</h5>
              <div class="grid gap-3 lg:grid-cols-2">
                {#each group.entries as entry (entry.id)}
                  {@const entrySources = sourcesByEntry.get(entry.id) || []}
                  <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors hover:border-orange-200">
                    <div class="flex">
                      {#if entrySources[0]}
                        <img
                          src={entrySources[0].sourceUrl}
                          alt={m.calories_photo_alt({ name: entryLabel(entry) })}
                          class="h-32 w-28 shrink-0 object-cover sm:h-36 sm:w-36"
                          loading="lazy"
                          decoding="async"
                        />
                      {/if}
                      <div class="min-w-0 flex-1 p-4">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class={`rounded-full px-2 py-0.5 text-xs font-semibold ${entry.direction === 'intake' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                {directionLabel(entry.direction)}
                              </span>
                              <span class={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone(entry.status)}`}>
                                {statusLabel(entry.status)}
                              </span>
                            </div>
                            <h6 class="mt-2 truncate font-semibold text-slate-900">{entryLabel(entry)}</h6>
                            <p class="mt-1 text-xs text-slate-500">
                              {formatEntryTime(entry)}{categoryLabel(entry.category) ? ` · ${categoryLabel(entry.category)}` : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onclick={() => openEdit(entry)}
                            class="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"
                          >
                            {m.calories_edit_entry()}
                          </button>
                        </div>

                        <div class="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
                          {#if entry.energyKcal !== null}
                            <p class="text-xl font-semibold tracking-tight text-slate-900">
                              {formatKcal(entry.energyKcal)} <span class="text-xs font-medium text-slate-500">kcal</span>
                            </p>
                          {:else}
                            <p class="text-sm font-semibold text-amber-700">{m.calories_estimate_needed()}</p>
                          {/if}
                          {#if entry.durationMinutes !== null}
                            <p class="text-xs text-slate-500">{m.calories_duration_value({ minutes: entry.durationMinutes })}</p>
                          {/if}
                          {#if entrySources.length > 0}
                            <p class="text-xs text-slate-500">{m.calories_photo_count({ count: entrySources.length })}</p>
                          {/if}
                        </div>
                      </div>
                    </div>

                    {#if entry.notes}
                      <p class="border-t border-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-600">{entry.notes}</p>
                    {/if}

                    <div class="flex justify-end border-t border-slate-100 px-4 py-2.5">
                      <form
                        method="POST"
                        action="?/deleteEnergyEntry"
                        use:enhance={(submission) => {
                          if (!confirm(m.calories_delete_confirm({ name: entryLabel(entry) }))) {
                            submission.cancel();
                            return;
                          }

                          return async ({ result, update }) => {
                            await update();
                            if (result.type !== 'success') alert(m.calories_delete_failed());
                          };
                        }}
                      >
                        <input type="hidden" name="id" value={entry.id} />
                        <button type="submit" class="text-xs font-semibold text-rose-600 hover:text-rose-700">
                          {m.calories_delete_entry()}
                        </button>
                      </form>
                    </div>
                  </article>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</section>

{#if editorOpen}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/55 backdrop-blur-sm sm:items-center sm:p-6"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeEditor();
    }}
  >
    <div
      class="sheet-enter app-scroll flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:rounded-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calorie-editor-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
        <div>
          <h2 id="calorie-editor-title" class="text-xl font-semibold tracking-tight text-slate-900">
            {draft.id ? m.calories_edit_entry() : m.calories_add_entry()}
          </h2>
          <p class="mt-1 text-sm text-slate-500">{m.calories_editor_hint()}</p>
        </div>
        <button
          type="button"
          onclick={closeEditor}
          disabled={saving}
          class="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-700 disabled:opacity-40"
          aria-label={m.close()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <form
        method="POST"
        action={draft.id ? '?/updateEnergyEntry' : '?/createEnergyEntry'}
        enctype="multipart/form-data"
        use:enhance={submitEntry}
        class="app-scroll flex-1 overflow-y-auto"
      >
        <input type="hidden" name="patientId" value={patientId} />
        {#if draft.id}<input type="hidden" name="id" value={draft.id} />{/if}
        <input type="hidden" name="timezone" value={draft.timezone} />
        <input type="hidden" name="timezoneOffsetMinutes" value={draft.timezoneOffsetMinutes} />

        <div class="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
          <fieldset>
            <legend class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {m.calories_entry_type()}
            </legend>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <label class="cursor-pointer">
                <input class="peer sr-only" type="radio" name="direction" value="intake" bind:group={draft.direction} />
                <span class="flex items-center justify-center rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-600 transition-colors peer-checked:border-orange-300 peer-checked:bg-orange-50 peer-checked:text-orange-800">
                  {m.calories_intake()}
                </span>
              </label>
              <label class="cursor-pointer">
                <input class="peer sr-only" type="radio" name="direction" value="expenditure" bind:group={draft.direction} />
                <span class="flex items-center justify-center rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-600 transition-colors peer-checked:border-emerald-300 peer-checked:bg-emerald-50 peer-checked:text-emerald-800">
                  {m.calories_activity()}
                </span>
              </label>
            </div>
          </fieldset>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="sm:col-span-2">
              <span class="mb-1.5 block text-sm font-medium text-slate-700">
                {draft.direction === 'intake' ? m.calories_food_name() : m.calories_activity_name()}
              </span>
              <input
                name="label"
                type="text"
                bind:value={draft.label}
                maxlength="300"
                autocomplete="off"
                placeholder={draft.direction === 'intake' ? m.calories_food_name_placeholder() : m.calories_activity_name_placeholder()}
                class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500"
              />
            </label>

            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_energy()}</span>
              <div class="relative">
                <input
                  name="energyKcal"
                  type="number"
                  bind:value={draft.energyKcal}
                  min="0"
                  max="1000000"
                  step="0.1"
                  inputmode="decimal"
                  placeholder="0"
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 pr-14 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500"
                />
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-400">kcal</span>
              </div>
            </label>

            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_time()}</span>
              <input
                name="occurredLocal"
                type="datetime-local"
                bind:value={draft.occurredLocal}
                onchange={updateDraftTimeZone}
                required
                class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500"
              />
            </label>

            {#if draft.direction === 'intake'}
              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_meal_type()}</span>
                <select
                  name="category"
                  bind:value={draft.category}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500"
                >
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
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_duration()}</span>
                <div class="relative">
                  <input
                    name="durationMinutes"
                    type="number"
                    bind:value={draft.durationMinutes}
                    min="0"
                    max="10080"
                    step="1"
                    inputmode="numeric"
                    class="w-full rounded-lg border-slate-300 px-3 py-2.5 pr-20 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500"
                  />
                  <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-400">{m.calories_minutes()}</span>
                </div>
              </label>
            {/if}

            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.calories_counting_state()}</span>
              <select
                name="status"
                bind:value={draft.status}
                class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500"
              >
                {#if !draft.id}<option value="auto">{m.calories_status_auto()}</option>{/if}
                <option value="recorded">{m.calories_status_recorded()}</option>
                <option value="draft">{m.calories_status_draft()}</option>
                <option value="excluded">{m.calories_status_excluded()}</option>
              </select>
            </label>
          </div>

          {#if !draft.id && draft.direction === 'intake'}
            <label class="block rounded-xl border border-dashed border-orange-200 bg-orange-50/50 p-4">
              <span class="block text-sm font-semibold text-orange-900">{m.calories_source_photo()}</span>
              <span class="mt-1 block text-xs leading-relaxed text-orange-700">{m.calories_source_photo_hint()}</span>
              <input
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,.heic,.heif"
                capture="environment"
                class="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-orange-700 file:shadow-sm hover:file:bg-orange-100"
              />
            </label>
          {/if}

          {#if draft.id && (sourcesByEntry.get(draft.id)?.length || 0) > 0}
            <p class="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              {m.calories_existing_photo_retained()}
            </p>
          {/if}

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.notes()}</span>
            <textarea
              name="notes"
              bind:value={draft.notes}
              rows="3"
              maxlength="4000"
              placeholder={m.calories_notes_placeholder()}
              class="w-full resize-y rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-orange-500 focus:ring-orange-500"
            ></textarea>
          </label>

          {#if saveError}
            <p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {saveError}
            </p>
          {/if}
        </div>

        <footer class="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-6" style="padding-bottom: calc(1rem + var(--safe-bottom))">
          <button
            type="button"
            onclick={closeEditor}
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
