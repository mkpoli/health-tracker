<script lang="ts">
  import { enhance } from '$app/forms';
  import * as m from '$lib/paraglide/messages.js';
  import { getMetricDefinition } from '$lib/metrics/catalog';
  import { convertValueBetweenUnits, normalizeComparableMeasurement } from '$lib/metrics/normalization';
  import { getJisBraSize } from '$lib/metrics/bra-size';
  import { getDefinitionLabel } from '$lib/metrics/labels';
  import type { MeasurementDomain } from '$lib/metrics/measurement-domains';
  import type { DerivedPoint } from '$lib/metrics/derived';
  import MeasurementModal from './MeasurementModal.svelte';
  import BodyDiagram from './BodyDiagram.svelte';

  type MeasurementRecord = {
    id: string;
    reportId: string;
    metricName: string;
    value: string;
    unit: string | null;
    extraData: unknown;
  };

  type Session = {
    id: string;
    measuredAt: string | null;
    notes: string;
    records: MeasurementRecord[];
  };

  let {
    domain,
    patientId,
    sessions = [],
    derivedPoints = [],
    focusSessionId = null,
    formatDate,
  }: {
    domain: MeasurementDomain;
    patientId: string;
    sessions?: Session[];
    derivedPoints?: DerivedPoint[];
    /** Session to open, set when a trend point in this panel is clicked. */
    focusSessionId?: string | null;
    formatDate: (value: string | null, options?: Intl.DateTimeFormatOptions) => string;
  } = $props();

  let modalOpen = $state(false);
  let editingSessionId = $state<string | null>(null);
  let expandedSessionIds = $state<string[]>([]);

  const derivedBySession = $derived.by(() => {
    const grouped = new Map<string, DerivedPoint[]>();

    for (const point of derivedPoints) {
      const existing = grouped.get(point.reportId) || [];
      existing.push(point);
      grouped.set(point.reportId, existing);
    }

    return grouped;
  });

  const orderedSessions = $derived(
    [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a)),
  );

  type SnapshotItem = {
    metricName: string;
    label: string;
    groupRank: number;
    value: string;
    unit: string | null;
    date: string | null;
    delta: number | null;
    derived: boolean;
  };

  const snapshot = $derived.by(() => {
    const byMetric = new Map<string, Array<{ value: string; numeric: number | null; unit: string | null; date: string | null; derived: boolean }>>();

    for (const session of orderedSessions) {
      for (const item of session.records) {
        const list = byMetric.get(item.metricName) || [];
        list.push({
          value: item.value,
          numeric: toComparable(item.value, item.unit),
          unit: item.unit,
          date: session.measuredAt,
          derived: false,
        });
        byMetric.set(item.metricName, list);
      }

      for (const point of derivedBySession.get(session.id) || []) {
        const list = byMetric.get(point.definition.canonicalLabel) || [];
        list.push({
          value: point.value.toFixed(point.precision),
          numeric: point.value,
          unit: point.unit,
          date: session.measuredAt,
          derived: true,
        });
        byMetric.set(point.definition.canonicalLabel, list);
      }
    }

    const items: SnapshotItem[] = [];

    for (const [metricName, entries] of byMetric) {
      const [latest, previous] = entries;
      const definition = getMetricDefinition(metricName);

      items.push({
        metricName,
        label: getDefinitionLabel(definition),
        groupRank: groupRankFor(metricName),
        value: latest.value,
        unit: latest.unit,
        date: latest.date,
        delta: deltaInDisplayUnit(latest, previous),
        derived: latest.derived,
      });
    }

    return items.sort((a, b) => a.groupRank - b.groupRank || a.label.localeCompare(b.label));
  });

  const editingSession = $derived(orderedSessions.find((session) => session.id === editingSessionId) || null);

  // Most recent value per catalog key, for the dialog's live preview: a session
  // that does not repeat height still gets a BMI out of it.
  const carriedValues = $derived.by(() => {
    const latest = new Map<string, number>();

    for (const session of orderedSessions) {
      for (const item of session.records) {
        const key = recordMetricKey(item);
        if (latest.has(key)) continue;

        const comparable = toComparable(item.value, item.unit);
        if (comparable !== null) latest.set(key, comparable);
      }
    }

    return Object.fromEntries(latest);
  });

  const latestBraSize = $derived.by(() => {
    const bust = carriedValues['bust-circumference'];
    const underbust = carriedValues['underbust-circumference'];

    return bust !== undefined && underbust !== undefined ? getJisBraSize(underbust, bust) : null;
  });

  // Same reading order as the snapshot above: size, indices, composition, then
  // circumferences and skinfolds.
  function sortedRecords(records: MeasurementRecord[]) {
    return [...records].sort(
      (a, b) =>
        groupRankFor(a.metricName) - groupRankFor(b.metricName) ||
        getDefinitionLabel(getMetricDefinition(a.metricName)).localeCompare(
          getDefinitionLabel(getMetricDefinition(b.metricName)),
        ),
    );
  }

  function sessionTime(session: Session) {
    return session.measuredAt ? new Date(session.measuredAt).getTime() : 0;
  }

  // Deltas compare comparable values, so a session logged in lb against one in
  // kg subtracts like for like instead of showing an invented gain.
  function toComparable(value: string, unit: string | null) {
    const { comparableValue } = normalizeComparableMeasurement(value, unit, null);
    return comparableValue;
  }

  type SnapshotEntry = { numeric: number | null; unit: string | null };

  // The difference is taken in comparable units and then expressed in whatever
  // unit the card displays, so the number under "72.4 kg" is also kg.
  function deltaInDisplayUnit(latest: SnapshotEntry, previous?: SnapshotEntry) {
    if (latest.numeric === null || previous?.numeric === undefined || previous.numeric === null) return null;

    const rawDelta = latest.numeric - previous.numeric;
    const comparableUnit = normalizeComparableMeasurement(1, latest.unit, null).comparableUnit;
    const displayDelta =
      comparableUnit && latest.unit ? convertValueBetweenUnits(rawDelta, comparableUnit, latest.unit) : rawDelta;

    return Number((displayDelta ?? rawDelta).toFixed(2));
  }

  // Tailwind needs the class names whole, so each accent is spelled out rather
  // than assembled from the domain's colour name.
  const accentBar = $derived(domain.accent === 'violet' ? 'bg-violet-500' : 'bg-rose-500');
  const accentButton = $derived(
    domain.accent === 'violet'
      ? 'bg-violet-600 hover:bg-violet-700 focus:ring-violet-500'
      : 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500',
  );
  const accentPill = $derived(
    domain.accent === 'violet'
      ? 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
      : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  );
  const accentLabel = $derived(domain.accent === 'violet' ? 'text-violet-700/80' : 'text-rose-700/80');
  const accentWash = $derived(
    domain.accent === 'violet'
      ? 'bg-gradient-to-br from-violet-50/60 via-white to-teal-50/40'
      : 'bg-gradient-to-br from-rose-50/60 via-white to-amber-50/40',
  );

  // Snapshot tiles read in the same order as the logging form's sections.
  const groupRankByKey = $derived(new Map(domain.fields.map((field, index) => [field.key, index])));

  function groupRankFor(metricName: string) {
    return groupRankByKey.get(getMetricDefinition(metricName).key) ?? domain.fields.length;
  }

  function recordMetricKey(item: MeasurementRecord) {
    const extra = item.extraData;
    const parsed = typeof extra === 'string' ? safeParse(extra) : (extra as Record<string, unknown> | null);
    const key = parsed?.metricKey;
    return typeof key === 'string' ? key : getMetricDefinition(item.metricName).key;
  }

  function safeParse(value: string) {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function toLocalInput(value: string | null) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openNewSession() {
    editingSessionId = null;
    modalOpen = true;
  }

  function openSession(sessionId: string) {
    editingSessionId = sessionId;
    modalOpen = true;
  }

  function toggleSession(sessionId: string) {
    expandedSessionIds = expandedSessionIds.includes(sessionId)
      ? expandedSessionIds.filter((id) => id !== sessionId)
      : [...expandedSessionIds, sessionId];
  }

  function isExpanded(sessionId: string) {
    return expandedSessionIds.includes(sessionId);
  }

  $effect(() => {
    if (focusSessionId && !expandedSessionIds.includes(focusSessionId)) {
      expandedSessionIds = [...expandedSessionIds, focusSessionId];
    }
  });

  function formatDelta(delta: number) {
    return delta > 0 ? `+${delta}` : String(delta);
  }
</script>

<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  <div class="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/50 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
    <div class="flex items-center">
      <div class="mr-3 h-6 w-1.5 rounded-full {accentBar}"></div>
      <div>
        <h3 class="text-lg font-semibold text-slate-800">{domain.title()}</h3>
        <p class="text-sm text-slate-500">{domain.subtitle()}</p>
      </div>
    </div>
    <button
      type="button"
      onclick={openNewSession}
      class="inline-flex items-center gap-2 self-start rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 lg:self-auto {accentButton}"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="h-4 w-4">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      {domain.logAction()}
    </button>
  </div>

  {#if sessions.length === 0}
    <div class="px-6 py-14 text-center text-slate-400">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        class="mx-auto mb-3 h-10 w-10 text-slate-300"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M3 7.5h18M3 16.5h18M7.5 7.5v3m4.5-3v4.5m4.5-4.5v3M7.5 16.5v-3m4.5 3V12m4.5 4.5v-3"
        />
      </svg>
      <p class="text-sm font-medium">{domain.emptyTitle()}</p>
      <p class="mt-1 text-xs">{domain.emptyHint()}</p>
    </div>
  {:else}
    <div class="border-b border-slate-100 px-6 py-5 {accentWash}">
      <p class="text-xs font-semibold uppercase tracking-[0.22em] {accentLabel}">{m.latest_measurements()}</p>

      <div class="mt-3 flex flex-col gap-5 xl:flex-row xl:items-start">
        {#if domain.bodyExtras}
          <div class="mx-auto w-full max-w-md shrink-0 xl:mx-0 xl:w-[22rem]">
            <BodyDiagram values={carriedValues} onPick={openNewSession} />
          </div>
        {/if}

        <div class="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#if latestBraSize}
          <div class="rounded-xl border border-white/80 bg-white/80 p-3 shadow-sm backdrop-blur">
            <div class="flex items-start justify-between gap-2">
              <p class="text-xs font-medium text-slate-500">{m.bra_size_jis()}</p>
              <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {m.derived_value()}
              </span>
            </div>
            <p class="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{latestBraSize}</p>
            <p class="mt-1 text-xs text-slate-400">{m.bra_size_source()}</p>
          </div>
        {/if}
        {#each snapshot as item (item.metricName)}
          <div class="rounded-xl border border-white/80 bg-white/80 p-3 shadow-sm backdrop-blur">
            <div class="flex items-start justify-between gap-2">
              <p class="text-xs font-medium text-slate-500">{item.label}</p>
              {#if item.derived}
                <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {m.derived_value()}
                </span>
              {/if}
            </div>
            <p class="mt-1 flex items-baseline gap-1">
              <span class="text-2xl font-semibold tracking-tight text-slate-900">{item.value}</span>
              {#if item.unit}<span class="text-sm text-slate-500">{item.unit}</span>{/if}
            </p>
            <p class="mt-1 text-xs text-slate-400">
              {#if item.delta !== null && item.delta !== 0}
                <span class="font-semibold text-slate-600">{formatDelta(item.delta)}</span> ·
              {/if}
              {formatDate(item.date, { dateStyle: 'medium' })}
            </p>
          </div>
        {/each}
        </div>
      </div>
    </div>

    <div>
      <p class="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{m.measurement_history()}</p>
      {#each orderedSessions as session (session.id)}
        {@const sessionDerived = derivedBySession.get(session.id) || []}
        <section id={`measurement-session-${session.id}`} class="border-t border-slate-100">
          <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <button
              type="button"
              onclick={() => toggleSession(session.id)}
              class="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
                class="h-4 w-4 shrink-0 text-slate-400 transition-transform {isExpanded(session.id) ? 'rotate-90' : ''}"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-slate-800">
                  {formatDate(session.measuredAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                {#if session.notes}
                  <p class="truncate text-xs text-slate-500">{session.notes}</p>
                {/if}
              </div>
            </button>

            <div class="flex items-center gap-2">
              <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                {session.records.length === 1
                  ? m.item_count_one({ count: session.records.length })
                  : m.item_count_other({ count: session.records.length })}
              </span>
              <button
                type="button"
                onclick={() => openSession(session.id)}
                class="rounded-full border px-3 py-1 text-xs font-semibold transition-colors {accentPill}"
              >
                {m.edit_session()}
              </button>
              <form
                method="POST"
                action="?/deleteMeasurement"
                use:enhance={(event) => {
                  const count = session.records.length;
                  const message =
                    count === 1 ? m.delete_session_confirm_one({ count }) : m.delete_session_confirm_other({ count });

                  if (!confirm(message)) event.cancel();
                }}
              >
                <input type="hidden" name="sessionId" value={session.id} />
                <button
                  type="submit"
                  class="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                >
                  {m.remove_session()}
                </button>
              </form>
            </div>
          </div>

          {#if isExpanded(session.id)}
            <div class="px-6 pb-5">
              <div class="overflow-hidden rounded-xl border border-slate-200">
                <table class="min-w-full divide-y divide-slate-200">
                  <thead class="bg-slate-50/70">
                    <tr>
                      <th scope="col" class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {m.metric()}
                      </th>
                      <th scope="col" class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {m.value()}
                      </th>
                      <th scope="col" class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        {m.unit()}
                      </th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 bg-white">
                    {#each sortedRecords(session.records) as item (item.id)}
                      <tr>
                        <td class="px-4 py-2.5 text-sm font-medium text-slate-800">
                          {getDefinitionLabel(getMetricDefinition(item.metricName))}
                        </td>
                        <td class="px-4 py-2.5 text-sm text-slate-900">{item.value}</td>
                        <td class="px-4 py-2.5 text-sm text-slate-500">{item.unit || '—'}</td>
                      </tr>
                    {/each}
                    {#each sessionDerived as point (point.definition.key)}
                      <tr class="bg-slate-50/60">
                        <td class="px-4 py-2.5 text-sm font-medium text-slate-600">
                          {getDefinitionLabel(point.definition)}
                          <span class="ml-2 rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            {m.derived_value()}
                          </span>
                        </td>
                        <td class="px-4 py-2.5 text-sm text-slate-700">{point.value.toFixed(point.precision)}</td>
                        <td class="px-4 py-2.5 text-sm text-slate-500">{point.unit || '—'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

{#if modalOpen}
  <MeasurementModal
    {domain}
    {patientId}
    sessionId={editingSession?.id ?? null}
    measuredAt={toLocalInput(editingSession?.measuredAt ?? null)}
    notes={editingSession?.notes ?? ''}
    {carriedValues}
    entries={(editingSession?.records ?? []).map((item) => ({
      metricKey: recordMetricKey(item),
      metricName: item.metricName,
      value: item.value,
      unit: item.unit,
    }))}
    onClose={() => {
      modalOpen = false;
      editingSessionId = null;
    }}
  />
{/if}
