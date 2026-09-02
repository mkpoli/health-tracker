<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import {
    formatAmountWithUnit,
    formatDoseAmount,
    addDays,
    doseSlotIdentity,
    localDateOf,
    type DoseChecklistEntry,
    type DoseOccurrenceRecord,
    type DoseRegimenRecord,
    type DoseStatus,
  } from '$lib/medicine-plan';
  import type { MedicineClaimRecord } from '$lib/medicine';
  import { toDateTimeLocal } from '$lib/time-zone';

  let {
    entries = [],
    medicinesByCourse,
    regimensById,
    today,
    yesterday,
    timezone,
    now,
  }: {
    entries: DoseChecklistEntry[];
    medicinesByCourse: Map<string, MedicineClaimRecord>;
    regimensById: Map<string, DoseRegimenRecord>;
    /** Calendar dates in the patient's zone; they name the two groups. */
    today: string;
    yesterday: string;
    timezone: string;
    /** The current instant, ticking from the parent so the groups follow the clock. */
    now: string;
  } = $props();

  function identityOf(entry: DoseChecklistEntry) {
    return entry.regimenId && entry.slotKey !== null
      ? doseSlotIdentity(entry.regimenId, entry.localDate, entry.slotKey)
      : `record:${entry.record?.id}`;
  }

  // A tap shows its result at once and the server round trip settles behind
  // it. The saved row replaces the tapped state until the page data catches
  // up, and a failed save falls back to the open slot with a message.
  let pending = $state(new Set<string>());
  let saved = $state(new Map<string, DoseOccurrenceRecord>());

  const shownEntries = $derived(
    entries.map((entry) => {
      const identity = identityOf(entry);
      const record = saved.get(identity);
      if (!record || (entry.record && entry.record.revision >= record.revision)) return entry;
      return { ...entry, record, plannedAt: record.plannedAt ?? entry.plannedAt, status: record.status };
    }),
  );

  // Each rule keeps its own zone, so an entry is judged against that zone's
  // calendar rather than the patient's.
  function dayOf(entry: DoseChecklistEntry) {
    const zoneToday = localDateOf(now, entry.timezone);
    if (entry.localDate === zoneToday) return 'today';
    if (entry.localDate === addDays(zoneToday, -1)) return 'yesterday';
    return null;
  }
  const yesterdayEntries = $derived(shownEntries.filter((entry) => dayOf(entry) === 'yesterday'));
  const todayEntries = $derived(shownEntries.filter((entry) => dayOf(entry) === 'today'));

  // Yesterday matters while its slots are still being settled: a bedtime dose
  // recorded after midnight belongs to the day before, and an open slot from
  // yesterday is still worth a tap. Early in the morning the whole day stays
  // in view; later it folds away unless something in it is still open.
  const earlyHours = $derived(Number(toDateTimeLocal(now, timezone).slice(11, 13)) < 6);
  let yesterdayExpanded = $state<boolean | null>(null);
  const showYesterday = $derived(
    yesterdayExpanded ??
      (earlyHours || yesterdayEntries.some((entry) => entry.status === 'planned')),
  );

  function countLine(list: DoseChecklistEntry[]) {
    return m.dose_today_count({
      done: list.filter((entry) => entry.status !== 'planned').length,
      total: list.length,
    });
  }

  function dayLabel(date: string) {
    return new Intl.DateTimeFormat(getLocale(), { month: 'numeric', day: 'numeric', weekday: 'short' })
      .format(new Date(`${date}T12:00:00Z`));
  }

  // Doses recorded elsewhere (a reminder reply, another device) only reach
  // this page through a reload, so returning to the tab refreshes it.
  let lastRefresh = 0;
  onMount(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh < 30_000) return;
      lastRefresh = Date.now();
      void invalidateAll();
    };
    lastRefresh = Date.now();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  });

  let saving = $state(false);
  let saveError = $state('');
  let editorOpen = $state(false);
  let editing = $state<DoseChecklistEntry | null>(null);
  let editorStatus = $state<DoseStatus>('taken');
  let editorActualAt = $state('');
  let editorReason = $state('');
  let editorReaction = $state('');
  let editorNotes = $state('');

  const editableStatuses: DoseStatus[] = [
    'taken',
    'partial',
    'skipped',
    'missed',
    'delayed',
    'held',
    'unknown',
  ];

  function medicineFor(entry: DoseChecklistEntry) {
    return medicinesByCourse.get(entry.courseId) || null;
  }

  function regimenFor(entry: DoseChecklistEntry) {
    return entry.regimenId ? regimensById.get(entry.regimenId) || null : null;
  }

  function slotHeading(entry: DoseChecklistEntry) {
    const record = entry.record;
    const slot = entry.slot;
    const label = slot?.label || null;

    if (entry.plannedAt) {
      const time = new Intl.DateTimeFormat(getLocale(), {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: entry.timezone,
      }).format(new Date(entry.plannedAt));
      return label ? `${time} · ${label}` : time;
    }

    if (label) return label;
    if (record && !record.regimenId) return m.dose_unplanned();
    return m.dose_anytime();
  }

  function amountLine(entry: DoseChecklistEntry) {
    const record = entry.record;
    if (record?.actualValue !== null && record?.actualValue !== undefined) {
      return formatAmountWithUnit(record.actualValue, record.actualUnit);
    }
    if (record?.actualText) return record.actualText;
    return formatDoseAmount(entry.slot, regimenFor(entry)?.doseText ?? null) || '';
  }

  function takenTime(entry: DoseChecklistEntry) {
    const at = entry.record?.actualAt;
    if (!at || entry.status === 'planned') return '';
    return new Intl.DateTimeFormat(getLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: entry.timezone,
    }).format(new Date(at));
  }

  function statusLabel(status: DoseStatus) {
    if (status === 'planned') return m.dose_status_planned();
    if (status === 'taken') return m.dose_status_taken();
    if (status === 'partial') return m.dose_status_partial();
    if (status === 'skipped') return m.dose_status_skipped();
    if (status === 'missed') return m.dose_status_missed();
    if (status === 'delayed') return m.dose_status_delayed();
    if (status === 'held') return m.dose_status_held();
    return m.dose_status_unknown();
  }

  function statusGlyph(status: DoseStatus) {
    if (status === 'partial') return '½';
    if (status === 'skipped' || status === 'missed') return '✕';
    if (status === 'delayed') return '~';
    if (status === 'held') return '⏸';
    if (status === 'unknown') return '?';
    return '·';
  }

  function statusTone(status: DoseStatus) {
    if (status === 'taken') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'partial' || status === 'delayed') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (status === 'skipped' || status === 'missed') return 'border-rose-200 bg-rose-50 text-rose-700';
    if (status === 'held') return 'border-slate-300 bg-slate-100 text-slate-600';
    if (status === 'unknown') return 'border-slate-200 bg-slate-50 text-slate-500';
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }

  function openEditor(entry: DoseChecklistEntry) {
    editing = entry;
    editorStatus = entry.record && entry.record.status !== 'planned' ? entry.record.status : 'taken';
    editorActualAt = entry.record?.actualAt
      ? toDateTimeLocal(entry.record.actualAt, entry.timezone)
      : '';
    editorReason = entry.record?.reason || '';
    editorReaction = entry.record?.reaction || '';
    editorNotes = entry.record?.notes || '';
    saveError = '';
    editorOpen = true;
  }

  function closeEditor() {
    if (saving) return;
    editorOpen = false;
    editing = null;
  }

  const markTaken = (entry: DoseChecklistEntry): SubmitFunction => {
    const identity = identityOf(entry);
    return () => {
      pending = new Set(pending).add(identity);
      saveError = '';

      return async ({ result }) => {
        const next = new Set(pending);
        next.delete(identity);
        pending = next;

        if (result.type === 'success' && result.data?.occurrence) {
          saved = new Map(saved).set(identity, result.data.occurrence as DoseOccurrenceRecord);
          void invalidateAll();
          return;
        }
        if (result.type === 'failure' && result.status === 409) {
          void invalidateAll();
          saveError = m.claim_revision_stale();
        } else {
          saveError = m.dose_save_failed();
        }
      };
    };
  };

  const submitDose: SubmitFunction = () => {
    saving = true;
    saveError = '';

    return async ({ result, update }) => {
      if (result.type === 'success') {
        await update({ reset: true, invalidateAll: true });
        saving = false;
        editorOpen = false;
        editing = null;
        return;
      }

      if (result.type === 'failure' && result.status === 409) {
        await invalidateAll();
        saveError = m.claim_revision_stale();
      } else {
        saveError = m.dose_save_failed();
      }
      saving = false;
    };
  };

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && editorOpen) closeEditor();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet doseRow(entry: DoseChecklistEntry)}
  {@const identity = identityOf(entry)}
  {@const busy = pending.has(identity)}
  <li class="flex items-center gap-3 rounded-xl border border-white/80 bg-white px-3.5 py-3 shadow-sm">
    {#if entry.status === 'planned' && entry.regimenId && entry.slotKey !== null}
      <form method="POST" action="?/recordDose" use:enhance={markTaken(entry)}>
        <input type="hidden" name="regimenId" value={entry.regimenId} />
        <input type="hidden" name="localDate" value={entry.localDate} />
        <input type="hidden" name="slotKey" value={entry.slotKey} />
        <input type="hidden" name="status" value="taken" />
        <button
          type="submit"
          disabled={busy}
          class={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors active:scale-95 ${busy ? 'border-emerald-300 bg-emerald-50 text-emerald-500' : 'border-blue-300 bg-white text-transparent hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-500'}`}
          aria-label={m.dose_mark_taken()}
          title={m.dose_mark_taken()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor" class={`h-5 w-5 ${busy ? 'animate-pulse' : ''}`} aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </button>
      </form>
    {:else}
      <button
        type="button"
        onclick={() => openEditor(entry)}
        class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${statusTone(entry.status)}`}
        title={statusLabel(entry.status)}
        aria-label={`${statusLabel(entry.status)} · ${m.dose_edit_record()}`}
      >
        {#if entry.status === 'taken'}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        {:else}
          <span class="text-xs font-bold">{statusGlyph(entry.status)}</span>
        {/if}
      </button>
    {/if}

    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-semibold text-slate-800">
        {medicineFor(entry)?.name || m.dose_unknown_medicine()}
      </p>
      <p class="truncate text-xs text-slate-500">
        {[slotHeading(entry), amountLine(entry), takenTime(entry)].filter(Boolean).join(' · ')}
      </p>
    </div>

    <button
      type="button"
      onclick={() => openEditor(entry)}
      class="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
    >
      {entry.record ? m.dose_edit_record() : m.dose_record_details()}
    </button>
  </li>
{/snippet}

{#if entries.length > 0}
  <section class="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 sm:p-5">
    {#if saveError && !editorOpen}
      <p class="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
        {saveError}
      </p>
    {/if}

    {#if yesterdayEntries.length > 0}
      <button
        type="button"
        onclick={() => (yesterdayExpanded = !showYesterday)}
        aria-expanded={showYesterday}
        class="flex w-full items-center justify-between gap-3 rounded-lg py-1 text-left"
      >
        <span class="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">
          {m.dose_day_yesterday()} · {dayLabel(yesterday)}
        </span>
        <span class="flex items-center gap-1.5 text-xs text-blue-600">
          {countLine(yesterdayEntries)}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class={`h-3.5 w-3.5 transition-transform ${showYesterday ? 'rotate-180' : ''}`} aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </button>
      {#if showYesterday}
        <ul class="mt-2 mb-4 space-y-2">
          {#each yesterdayEntries as entry (identityOf(entry))}
            {@render doseRow(entry)}
          {/each}
        </ul>
      {:else}
        <div class="mb-3"></div>
      {/if}
    {/if}

    <div class="flex items-center justify-between gap-3 py-1">
      <h4 class="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">
        {m.dose_day_today()} · {dayLabel(today)}
      </h4>
      <p class="text-xs text-blue-600">{countLine(todayEntries)}</p>
    </div>

    {#if todayEntries.length > 0}
      <ul class="mt-2 space-y-2">
        {#each todayEntries as entry (identityOf(entry))}
          {@render doseRow(entry)}
        {/each}
      </ul>
    {:else}
      <p class="mt-2 text-sm text-slate-500">{m.dose_today_empty()}</p>
    {/if}
    <p class="mt-3 text-xs leading-relaxed text-blue-700/80">{m.dose_today_hint()}</p>
  </section>
{/if}

{#if editorOpen && editing}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/55 backdrop-blur-sm sm:items-center sm:p-6"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeEditor();
    }}
  >
    <div
      class="sheet-enter app-scroll flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:rounded-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dose-editor-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div>
          <h2 id="dose-editor-title" class="text-lg font-semibold tracking-tight text-slate-900">
            {medicineFor(editing)?.name || m.dose_unknown_medicine()}
          </h2>
          <p class="mt-1 text-sm text-slate-500">{slotHeading(editing)} · {editing.localDate}</p>
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

      <form method="POST" action="?/recordDose" use:enhance={submitDose} class="app-scroll flex-1 overflow-y-auto">
        {#if editing.record}
          <input type="hidden" name="occurrenceId" value={editing.record.id} />
          <input type="hidden" name="revision" value={editing.record.revision} />
        {:else if editing.regimenId && editing.slotKey !== null}
          <input type="hidden" name="regimenId" value={editing.regimenId} />
          <input type="hidden" name="localDate" value={editing.localDate} />
          <input type="hidden" name="slotKey" value={editing.slotKey} />
        {/if}

        <div class="space-y-4 px-5 py-5">
          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.dose_status()}</span>
            <select
              name="status"
              bind:value={editorStatus}
              class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              {#each editableStatuses as status}
                <option value={status}>{statusLabel(status)}</option>
              {/each}
            </select>
          </label>

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.dose_actual_time()}</span>
            <input
              name="actualAt"
              type="datetime-local"
              bind:value={editorActualAt}
              class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </label>

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.dose_reason()}</span>
            <input
              name="reason"
              type="text"
              bind:value={editorReason}
              maxlength="500"
              placeholder={m.dose_reason_placeholder()}
              class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </label>

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.dose_reaction()}</span>
            <textarea
              name="reaction"
              bind:value={editorReaction}
              rows="2"
              maxlength="2000"
              placeholder={m.dose_reaction_placeholder()}
              class="w-full resize-y rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
            ></textarea>
          </label>

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.notes()}</span>
            <textarea
              name="notes"
              bind:value={editorNotes}
              rows="2"
              maxlength="4000"
              class="w-full resize-y rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
            ></textarea>
          </label>

          {#if saveError}
            <p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {saveError}
            </p>
          {/if}
        </div>

        <footer class="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur" style="padding-bottom: calc(1rem + var(--safe-bottom))">
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
            class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:bg-blue-400"
          >
            {saving ? m.saving() : m.dose_save_record()}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}
