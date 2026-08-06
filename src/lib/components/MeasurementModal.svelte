<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import type { MeasurementDomain } from '$lib/metrics/measurement-domains';
  import { getMetricDefinitionByKey } from '$lib/metrics/catalog';
  import { getDefinitionDescription, getDefinitionLabel } from '$lib/metrics/labels';
  import { normalizeComparableMeasurement, parseNumber } from '$lib/metrics/normalization';
  import { computeDerivedMetrics } from '$lib/metrics/derived';
  import { getJisBraSize } from '$lib/metrics/bra-size';
  import { getLocale } from '$lib/paraglide/runtime';
  import { getMeasurementGuide, hasMeasurementGuide } from '$lib/content/measurement-guides';
  import MeasurementGuide from './MeasurementGuide.svelte';

  export type SessionEntry = {
    metricKey: string | null;
    metricName: string;
    value: string;
    unit: string | null;
  };

  type CustomRow = {
    id: number;
    label: string;
    value: string;
    unit: string;
  };

  let {
    domain,
    patientId,
    sessionId = null,
    measuredAt = '',
    notes = '',
    entries = [],
    carriedValues = {},
    onClose,
  }: {
    domain: MeasurementDomain;
    patientId: string;
    sessionId?: string | null;
    measuredAt?: string;
    notes?: string;
    entries?: SessionEntry[];
    /**
     * Last known value per catalog key from earlier sessions, so the preview can
     * show a BMI for a weigh-in whose height was recorded months ago.
     */
    carriedValues?: Record<string, number>;
    onClose: () => void;
  } = $props();

  const catalogKeys = new Set(domain.fields.flatMap((field) => [field.key, field.leftKey, field.rightKey].filter(Boolean) as string[]));

  function initialValues() {
    const values: Record<string, string> = {};

    for (const entry of entries) {
      if (entry.metricKey && catalogKeys.has(entry.metricKey)) values[entry.metricKey] = entry.value;
    }

    return values;
  }

  function initialUnits() {
    const units: Record<string, string> = {};

    for (const field of domain.fields) {
      for (const key of [field.key, field.leftKey, field.rightKey].filter(Boolean) as string[]) {
        units[key] = field.unit || '';
      }
    }

    for (const entry of entries) {
      if (entry.metricKey && catalogKeys.has(entry.metricKey) && entry.unit) units[entry.metricKey] = entry.unit;
    }

    return units;
  }

  function initialCustomRows() {
    return entries
      .filter((entry) => !entry.metricKey || !catalogKeys.has(entry.metricKey))
      .map((entry, index) => ({
        id: index,
        label: entry.metricName,
        value: entry.value,
        unit: entry.unit || '',
      }));
  }

  // `bind:value` on a number input hands back a number (or null when cleared),
  // so every read normalizes before it is treated as text.
  const initial = initialValues();

  let values = $state<Record<string, string | number | null>>({ ...initial });
  let units = $state<Record<string, string>>(initialUnits());
  let customRows = $state<CustomRow[]>(initialCustomRows());
  let customRowSeed = customRows.length;

  let sessionDate = $state(measuredAt || toLocalInput(new Date()));
  let sessionNotes = $state(notes);
  let query = $state('');
  let submitting = $state(false);
  let saveError = $state('');
  let commonOnly = $state(!sessionId && entries.length === 0);
  // Fields the user opened in this session stay on screen even once emptied,
  // so clearing a value does not make the input disappear under the cursor.
  let revealedKeys = $state<string[]>([]);
  let guideKey = $state<string | null>(null);

  const openGuide = $derived(guideKey ? getMeasurementGuide(guideKey, getLocale()) : null);

  // The model keys its profile by site rather than catalog key.
  const diagramValues = $derived.by(() => {
    const bySite: Record<string, number> = {};
    const map: Record<string, string> = {
      'neck-circumference': 'neck',
      'shoulder-circumference': 'shoulder',
      'bust-circumference': 'bust',
      'underbust-circumference': 'underbust',
      'waist-circumference': 'waist',
      'abdominal-circumference': 'abdomen',
      'hip-circumference': 'hip',
      'thigh-circumference': 'thigh',
      'calf-circumference': 'calf',
    };

    for (const [key, site] of Object.entries(map)) {
      const value = previewValues.get(key) ?? carriedValues[key];
      if (typeof value === 'number') bySite[site] = value;
    }

    return bySite;
  });
  let expandedSides = $state<Record<string, boolean>>(
    Object.fromEntries(
      domain.fields
        .filter((field) => field.sided)
        .map((field) => [
          field.key,
          Boolean(
            (field.leftKey && initial[field.leftKey] !== undefined) ||
              (field.rightKey && initial[field.rightKey] !== undefined),
          ),
        ]),
    ),
  );

  function toLocalInput(date: Date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  // `datetime-local` yields a bare wall-clock string. Parsing it server-side
  // would resolve it in the worker's zone (UTC on Cloudflare), turning a 08:00
  // weigh-in into 08:00Z, so the instant is resolved here in the browser.
  const measuredAtInstant = $derived.by(() => {
    const parsed = new Date(sessionDate);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  });

  function fieldLabel(key: string) {
    const definition = getMetricDefinitionByKey(key);
    return definition ? getDefinitionLabel(definition) : key;
  }

  function fieldDescription(key: string) {
    const definition = getMetricDefinitionByKey(key);
    return definition ? getDefinitionDescription(definition) : '';
  }

  function searchText(key: string) {
    const definition = getMetricDefinitionByKey(key);
    if (!definition) return key;

    return [definition.canonicalLabel, getDefinitionLabel(definition), ...(definition.aliases || [])]
      .join(' ')
      .toLowerCase();
  }

  function readValue(key: string) {
    const raw = values[key];
    if (raw === undefined || raw === null) return '';
    return String(raw).trim();
  }

  function isNumeric(value: string) {
    return parseNumber(value) !== null;
  }

  const normalizedQuery = $derived(query.trim().toLowerCase());

  const visibleFields = $derived.by(() =>
    domain.fields.filter((field) => {
      const hasValue =
        readValue(field.key) !== '' ||
        (field.leftKey ? readValue(field.leftKey) !== '' : false) ||
        (field.rightKey ? readValue(field.rightKey) !== '' : false);

      if (normalizedQuery) return searchText(field.key).includes(normalizedQuery);
      if (commonOnly) return field.common || hasValue || revealedKeys.includes(field.key);

      return true;
    }),
  );

  $effect(() => {
    if (!commonOnly || normalizedQuery) return;

    for (const field of domain.fields) {
      if (field.common || revealedKeys.includes(field.key)) continue;

      const hasValue =
        readValue(field.key) !== '' ||
        (field.leftKey ? readValue(field.leftKey) !== '' : false) ||
        (field.rightKey ? readValue(field.rightKey) !== '' : false);

      if (hasValue) revealedKeys = [...revealedKeys, field.key];
    }
  });

  const groupedFields = $derived.by(() =>
    domain.groups
      .map((group) => ({
        key: group,
        label: domain.groupLabel(group),
        fields: visibleFields.filter((field) => field.group === group),
      }))
      .filter((group) => group.fields.length > 0),
  );

  const payload = $derived.by(() => {
    const collected: Array<{ key?: string; label?: string; value: string; unit: string | null }> = [];

    // Everything currently held in state is submitted, whatever the search box
    // or the common-only filter happens to be hiding. The L/R toggle clears the
    // values it hides, so state and what gets saved never diverge.
    for (const key of catalogKeys) {
      const value = readValue(key);
      if (!value) continue;
      collected.push({ key, value, unit: units[key]?.trim() || null });
    }

    for (const row of customRows) {
      const label = row.label.trim();
      const value = row.value.trim();
      // A non-numeric custom value would be dropped server-side, so it must not
      // count as filled here either.
      if (!label || !value || !isNumeric(value)) continue;
      collected.push({ label, value, unit: row.unit.trim() || null });
    }

    return collected;
  });

  const filledCount = $derived(payload.length);

  // What the entered values already add up to, recomputed as they are typed.
  // Values from earlier sessions stand in for the dependencies this session does
  // not repeat, matching how the saved session will be read back.
  const previewValues = $derived.by(() => {
    const resolved = new Map<string, number>(Object.entries(carriedValues));

    for (const entry of payload) {
      if (!entry.key) continue;
      const comparable = normalizeComparableMeasurement(entry.value, entry.unit, null).comparableValue;
      if (comparable !== null) resolved.set(entry.key, comparable);
    }

    return resolved;
  });

  const previewItems = $derived.by(() => {
    const points = computeDerivedMetrics([{ id: 'preview' }], new Map([['preview', previewValues]]));

    const items = points.map((point) => ({
      key: point.definition.key,
      label: getDefinitionLabel(point.definition),
      value: `${point.value.toFixed(point.precision)}${point.unit ? ` ${point.unit}` : ''}`,
    }));

    const bust = previewValues.get('bust-circumference');
    const underbust = previewValues.get('underbust-circumference');
    const braSize =
      domain.bodyExtras && bust !== undefined && underbust !== undefined ? getJisBraSize(underbust, bust) : null;

    if (braSize) {
      items.push({ key: 'bra-size', label: m.bra_size_jis(), value: braSize });
    }

    return items;
  });

  // Switching a limb between one value and two rewrites the form: the values
  // the other mode holds are cleared on screen, so nothing is pruned invisibly
  // at save time.
  function toggleSides(key: string) {
    const field = domain.fields.find((item) => item.key === key);
    const opening = !expandedSides[key];
    expandedSides = { ...expandedSides, [key]: opening };

    if (!field) return;

    const next = { ...values };

    if (opening) {
      delete next[field.key];
    } else {
      if (field.leftKey) delete next[field.leftKey];
      if (field.rightKey) delete next[field.rightKey];
    }

    values = next;
  }

  function addCustomRow() {
    customRowSeed += 1;
    customRows = [...customRows, { id: customRowSeed, label: '', value: '', unit: '' }];
  }

  function removeCustomRow(id: number) {
    customRows = customRows.filter((row) => row.id !== id);
  }

  // A click on the backdrop, Escape, or Cancel must not throw away a form that
  // may hold dozens of hand-measured values. Only an untouched dialog closes
  // without asking.
  const currentState = $derived(JSON.stringify({ payload, notes: sessionNotes, date: sessionDate }));
  let baselineState = $state('');
  const dirty = $derived(baselineState !== '' && currentState !== baselineState);

  $effect(() => {
    if (!baselineState) baselineState = untrack(() => currentState);
  });

  function requestClose() {
    if (dirty && !confirm(m.discard_measurements_confirm())) return;
    onClose();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') requestClose();
  }

  // Opening a 70-field dialog without moving focus leaves the keyboard behind
  // in the page underneath.
  function focusOnOpen(node: HTMLElement) {
    node.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/50 backdrop-blur-sm sm:items-start sm:p-8"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) requestClose();
  }}
>
  <div
    class="sheet-enter app-scroll flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:my-auto sm:max-h-none sm:rounded-2xl"
    role="dialog"
    aria-modal="true"
    aria-label={sessionId ? m.edit_measurement_session() : m.new_measurement_session()}
    use:focusOnOpen
  >
    <form
      method="POST"
      action="?/saveMeasurement"
      use:enhance={() => {
        submitting = true;
        saveError = '';

        return async ({ result, update }) => {
          submitting = false;

          if (result.type === 'success') {
            await update({ invalidateAll: true, reset: false });
            onClose();
            return;
          }

          // Keep the draft on screen rather than discarding what was typed.
          const code = result.type === 'failure' ? (result.data?.code as string | undefined) : undefined;
          saveError =
            code === 'invalid_entries'
              ? m.save_measurements_invalid()
              : code === 'invalid_date'
                ? m.save_measurements_invalid_date()
                : m.save_measurements_failed();
        };
      }}
    >
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="kind" value={domain.kind} />
      <input type="hidden" name="sessionId" value={sessionId ?? ''} />
      <input type="hidden" name="measuredAt" value={measuredAtInstant} />
      <input type="hidden" name="entries" value={JSON.stringify(payload)} />

      <header class="shrink-0 border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-6 sm:py-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold tracking-tight text-slate-900">
              {sessionId ? m.edit_measurement_session() : m.new_measurement_session()}
            </h2>
            <p class="mt-1 text-sm text-slate-500">{domain.subtitle()}</p>
          </div>
          <button
            type="button"
            onclick={requestClose}
            class="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
            aria-label={m.close()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="mt-4 grid gap-4 sm:grid-cols-[16rem_minmax(0,1fr)]">
          <label class="block">
            <span class="mb-1.5 block text-sm font-semibold text-slate-700">{m.measured_at()}</span>
            <input
              type="datetime-local"
              required
              bind:value={sessionDate}
              class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </label>
          <label class="block">
            <span class="mb-1.5 block text-sm font-semibold text-slate-700">
              {m.notes()} <span class="font-normal text-slate-400">({m.optional()})</span>
            </span>
            <input
              type="text"
              name="notes"
              bind:value={sessionNotes}
              placeholder={domain.notesPlaceholder()}
              class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </label>
        </div>
      </header>

      <div class="shrink-0 flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 sm:gap-3 sm:px-6">
        <div class="relative min-w-56 flex-1">
          <input
            type="search"
            bind:value={query}
            placeholder={m.search_measurement()}
            class="w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-2 pl-9 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-1 focus:ring-teal-500"
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="2"
            stroke="currentColor"
            class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
        </div>

        <div class="flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onclick={() => (commonOnly = true)}
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {commonOnly
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'}"
          >
            {m.show_common_only()}
          </button>
          <button
            type="button"
            onclick={() => (commonOnly = false)}
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {!commonOnly
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'}"
          >
            {m.show_all_measurements()}
          </button>
        </div>

        <span class="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
          {filledCount === 1 ? m.entries_filled_one({ count: filledCount }) : m.entries_filled_other({ count: filledCount })}
        </span>
      </div>

      <div class="app-scroll flex-1 overflow-y-auto px-4 py-5 sm:max-h-[52vh] sm:px-6">
        {#each groupedFields as group (group.key)}
          <section class="mb-7 last:mb-0">
            <h3 class="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</h3>
            <div class="grid gap-3 sm:grid-cols-2">
              {#each group.fields as field (field.key)}
                <div class="rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <label for={`body-${field.key}`} class="block text-sm font-semibold text-slate-800">
                        {fieldLabel(field.key)}
                      </label>
                      <p class="mt-0.5 line-clamp-2 text-xs text-slate-500">{fieldDescription(field.key)}</p>
                      {#if hasMeasurementGuide(field.key)}
                        <button
                          type="button"
                          onclick={() => (guideKey = field.key)}
                          class="mt-1 inline-flex items-center gap-1 text-xs font-medium text-violet-700 transition-colors hover:text-violet-900"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-3.5 w-3.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 17.25h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {m.guide_open()}
                        </button>
                      {/if}
                    </div>
                    {#if field.sided}
                      <button
                        type="button"
                        onclick={() => toggleSides(field.key)}
                        title={m.measure_each_side()}
                        class="shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors {expandedSides[
                          field.key
                        ]
                          ? 'border-teal-300 bg-teal-50 text-teal-700'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-700'}"
                      >
                        L / R
                      </button>
                    {/if}
                  </div>

                  <div class="mt-2 space-y-2">
                    {#if !expandedSides[field.key]}
                      <div class="flex gap-2">
                        <input
                          id={`body-${field.key}`}
                          type="number"
                          min="0"
                          inputmode="decimal"
                          step="any"
                          bind:value={values[field.key]}
                          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        />
                        {#if field.unitOptions.length > 1}
                          <select
                            bind:value={units[field.key]}
                            aria-label={m.unit()}
                            class="w-24 shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-600 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                          >
                            {#each field.unitOptions as unitOption}
                              <option value={unitOption}>{unitOption}</option>
                            {/each}
                          </select>
                        {:else if field.unit}
                          <span class="flex w-24 shrink-0 items-center justify-center rounded-lg bg-slate-50 px-2 text-sm text-slate-500">
                            {field.unit}
                          </span>
                        {:else}
                          <span class="w-24 shrink-0" aria-hidden="true"></span>
                        {/if}
                      </div>
                    {:else}
                      {#each [field.leftKey, field.rightKey].filter(Boolean) as sideKey (sideKey)}
                        <div class="flex items-center gap-2">
                          <span class="w-10 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            {sideKey === field.leftKey ? m.body_side_short_left() : m.body_side_short_right()}
                          </span>
                          <input
                            type="number"
                            min="0"
                            inputmode="decimal"
                            step="any"
                            aria-label={fieldLabel(sideKey!)}
                            bind:value={values[sideKey!]}
                            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                          />
                          {#if field.unitOptions.length > 1}
                            <select
                              bind:value={units[sideKey!]}
                              aria-label={m.unit()}
                              class="w-24 shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-600 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                            >
                              {#each field.unitOptions as unitOption}
                                <option value={unitOption}>{unitOption}</option>
                              {/each}
                            </select>
                          {:else if field.unit}
                            <span class="flex w-24 shrink-0 items-center justify-center rounded-lg bg-slate-50 px-2 text-sm text-slate-500">
                              {field.unit}
                            </span>
                          {:else}
                            <span class="w-24 shrink-0" aria-hidden="true"></span>
                          {/if}
                        </div>
                      {/each}
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/each}

        <section class="mb-2">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {m.measurement_group_custom()}
          </h3>
          <div class="space-y-2">
            {#each customRows as row (row.id)}
              <div class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
                <input
                  type="text"
                  bind:value={row.label}
                  placeholder={m.measurement_name()}
                  class="min-w-40 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                />
                <input
                  type="text"
                  inputmode="decimal"
                  bind:value={row.value}
                  placeholder={m.value()}
                  class="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                />
                <input
                  type="text"
                  bind:value={row.unit}
                  placeholder={m.unit()}
                  class="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                />
                <button
                  type="button"
                  onclick={() => removeCustomRow(row.id)}
                  class="rounded-full p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  aria-label={m.remove_item()}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-4 w-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            {/each}

            <button
              type="button"
              onclick={addCustomRow}
              class="inline-flex items-center gap-2 rounded-full border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-teal-400 hover:text-teal-700"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-4 w-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {m.add_custom_measurement()}
            </button>
          </div>
        </section>
      </div>

      {#if previewItems.length > 0}
        <div class="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-teal-50/40 px-6 py-3">
          <span class="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700/80">{m.computed_now()}</span>
          {#each previewItems as item (item.key)}
            <span class="rounded-full border border-teal-200 bg-white px-3 py-1 text-sm text-slate-700">
              {item.label}
              <span class="ml-1 font-semibold text-slate-900">{item.value}</span>
            </span>
          {/each}
        </div>
      {/if}

      <footer class="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-6 sm:py-4" style="padding-bottom: calc(0.75rem + var(--safe-bottom))">
        {#if saveError}
          <p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700" role="alert">
            {saveError}
          </p>
        {:else}
          <p class="text-sm text-slate-500">{m.measurement_calculated_hint()}</p>
        {/if}
        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={requestClose}
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            {m.cancel()}
          </button>
          <button
            type="submit"
            disabled={filledCount === 0 || submitting}
            class="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? m.saving() : m.save_measurements()}
          </button>
        </div>
      </footer>
    </form>
  </div>
</div>

{#if guideKey && openGuide}
  <MeasurementGuide
    title={fieldLabel(guideKey)}
    guide={openGuide}
    circumferences={diagramValues}
    onClose={() => (guideKey = null)}
  />
{/if}
