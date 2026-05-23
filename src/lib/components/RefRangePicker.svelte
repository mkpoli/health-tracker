<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getMetricDefinition } from '$lib/metrics/catalog';
  import {
    getRefRangesForMetric,
    formatRefRangeForUnit,
    type PatientContext,
    type RefRangeEntry,
  } from '$lib/metrics/ref-ranges';

  let {
    metricLabel,
    patient,
    currentUnit,
    onSelect,
  }: {
    metricLabel?: string | null;
    patient?: PatientContext | null;
    currentUnit?: string | null;
    onSelect: (rangeText: string) => void;
  } = $props();

  let detailsEl: HTMLDetailsElement | null = $state(null);

  const metricKey = $derived(getMetricDefinition(metricLabel).key);
  const entries = $derived(getRefRangesForMetric(metricKey, patient || {}));

  function entryDisplay(entry: RefRangeEntry) {
    return formatRefRangeForUnit(entry, currentUnit);
  }

  function handlePick(entry: RefRangeEntry) {
    const display = entryDisplay(entry);
    onSelect(display.range);
    if (detailsEl) detailsEl.open = false;
  }
</script>

{#if entries.length > 0}
  <details bind:this={detailsEl} class="group relative inline-block">
    <summary
      class="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600 shadow-sm transition-colors hover:border-teal-500 hover:text-teal-700 marker:content-none"
      title={m.pick_reference_range()}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
      </svg>
      {m.ref_short()}
    </summary>

    <div
      class="absolute right-0 z-30 mt-1.5 max-h-72 w-72 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10"
    >
      {#each entries as entry, idx}
        {@const display = entryDisplay(entry)}
        <button
          type="button"
          onclick={() => handlePick(entry)}
          class="block w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-teal-50 {idx === 0
            ? 'border border-teal-100 bg-teal-50/40'
            : ''}"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-xs font-semibold text-slate-800">{entry.label}</span>
            <span class="font-mono text-xs font-semibold text-slate-900">
              {display.range}{display.unit ? ` ${display.unit}` : ''}
            </span>
          </div>
          {#if display.converted}
            <div class="mt-0.5 text-[10px] uppercase tracking-wide text-teal-600">
              {m.ref_converted_from({ unit: entry.unit || '' })}
            </div>
          {:else if entry.unit && currentUnit && entry.unit.trim() !== currentUnit.trim()}
            <div class="mt-0.5 text-[10px] uppercase tracking-wide text-amber-600">
              {m.ref_unit_mismatch({ unit: entry.unit })}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  </details>
{/if}
