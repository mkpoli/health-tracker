<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import * as m from '$lib/paraglide/messages.js';
  import { readAppleHealthFile, type ImportSession, type ImportSummary } from '$lib/import/apple-health';
  import { getMetricDefinitionByKey } from '$lib/metrics/catalog';
  import { getDefinitionLabel } from '$lib/metrics/labels';

  let { patientId, onClose }: { patientId: string; onClose: () => void } = $props();

  type Stage = 'choose' | 'reading' | 'review' | 'importing' | 'done';

  let stage = $state<Stage>('choose');
  let fileName = $state('');
  let progress = $state(0);
  let summary = $state<ImportSummary | null>(null);
  let errorMessage = $state('');
  let importedCount = $state(0);
  let sessionsSent = $state(0);

  // The action is chunked so a decade of history does not arrive as one
  // multi-megabyte request the worker has to hold in memory.
  const BATCH_SIZE = 250;

  const metricCounts = $derived.by(() => {
    if (!summary) return [] as Array<{ key: string; label: string; count: number }>;

    const counts = new Map<string, number>();

    for (const session of summary.sessions) {
      for (const entry of session.entries) {
        counts.set(entry.key, (counts.get(entry.key) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([key, count]) => {
        const definition = getMetricDefinitionByKey(key);
        return { key, label: definition ? getDefinitionLabel(definition) : key, count };
      })
      .sort((a, b) => b.count - a.count);
  });

  const unmappedTypes = $derived.by(() => {
    if (!summary) return [] as Array<{ type: string; count: number }>;

    return Object.entries(summary.seen)
      .filter(([type]) => !metricCounts.some((item) => type.toLowerCase().includes(item.key.replace(/-/g, ''))))
      .map(([type, count]) => ({ type: type.replace('HKQuantityTypeIdentifier', ''), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  });

  function formatDate(value: string | null) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  async function handleFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    fileName = file.name;
    errorMessage = '';
    progress = 0;
    stage = 'reading';

    try {
      if (file.name.toLowerCase().endsWith('.json')) {
        errorMessage = m.import_json_unsupported();
        stage = 'choose';
        return;
      }

      const parsed = await readAppleHealthFile(file, (read, total) => {
        progress = total > 0 ? Math.min(read / total, 1) : 0;
      });

      if (parsed.sessions.length === 0) {
        errorMessage = m.import_nothing_found();
        stage = 'choose';
        return;
      }

      summary = parsed;
      stage = 'review';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m.import_failed();
      stage = 'choose';
    }
  }

  async function runImport() {
    if (!summary) return;

    stage = 'importing';
    importedCount = 0;
    sessionsSent = 0;
    errorMessage = '';

    const all = summary.sessions;

    try {
      for (let index = 0; index < all.length; index += BATCH_SIZE) {
        const batch: ImportSession[] = all.slice(index, index + BATCH_SIZE);
        const body = new FormData();
        body.set('patientId', patientId);
        body.set('source', 'apple-health');
        body.set('sessions', JSON.stringify(batch));

        const response = await fetch('?/importMeasurements', { method: 'POST', body });
        const payload = (await response.json()) as { type?: string };

        if (payload.type !== 'success') {
          errorMessage = m.import_failed();
          stage = 'review';
          return;
        }

        sessionsSent += batch.length;
        importedCount += batch.reduce((total, session) => total + session.entries.length, 0);
        progress = sessionsSent / all.length;
      }

      await invalidateAll();
      stage = 'done';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m.import_failed();
      stage = 'review';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && stage !== 'importing') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-8"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget && stage !== 'importing') onClose();
  }}
>
  <div
    class="my-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10"
    role="dialog"
    aria-modal="true"
    aria-label={m.import_data()}
  >
    <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-5">
      <div>
        <h2 class="text-xl font-semibold tracking-tight text-slate-900">{m.import_data()}</h2>
        <p class="mt-1 text-sm text-slate-500">{m.import_subtitle()}</p>
      </div>
      {#if stage !== 'importing'}
        <button
          type="button"
          onclick={onClose}
          class="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
          aria-label={m.close()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      {/if}
    </header>

    <div class="px-6 py-5">
      {#if stage === 'choose'}
        <ol class="mb-5 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-600">
          <li>1. {m.import_apple_step_1()}</li>
          <li>2. {m.import_apple_step_2()}</li>
          <li>3. {m.import_apple_step_3()}</li>
        </ol>

        <label
          class="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center transition-colors hover:border-teal-500"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="mb-2 h-10 w-10 text-slate-400"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 16.5V9.75m0 0l-3 3m3-3l3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
            />
          </svg>
          <span class="text-sm font-semibold text-teal-700">{m.import_choose_file()}</span>
          <span class="mt-1 text-xs text-slate-500">{m.import_file_hint()}</span>
          <input type="file" accept=".zip,.xml" class="sr-only" onchange={handleFile} />
        </label>

        {#if errorMessage}
          <p class="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {errorMessage}
          </p>
        {/if}
      {:else if stage === 'reading'}
        <div class="py-8 text-center">
          <p class="text-sm font-medium text-slate-700">{m.import_reading({ name: fileName })}</p>
          <div class="mx-auto mt-4 h-2 w-64 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-teal-500 transition-[width]" style={`width: ${Math.round(progress * 100)}%`}></div>
          </div>
          <p class="mt-2 text-xs text-slate-400">{Math.round(progress * 100)}%</p>
        </div>
      {:else if stage === 'review' && summary}
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-xs font-medium text-slate-500">{m.import_sessions()}</p>
            <p class="mt-1 text-2xl font-semibold text-slate-900">{summary.sessions.length}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-xs font-medium text-slate-500">{m.import_values()}</p>
            <p class="mt-1 text-2xl font-semibold text-slate-900">{summary.mapped}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-white p-3">
            <p class="text-xs font-medium text-slate-500">{m.import_range()}</p>
            <p class="mt-1 text-sm font-semibold text-slate-900">
              {formatDate(summary.earliest)} – {formatDate(summary.latest)}
            </p>
          </div>
        </div>

        <div class="mt-4 max-h-56 overflow-y-auto rounded-xl border border-slate-200">
          <table class="min-w-full divide-y divide-slate-200">
            <thead class="bg-slate-50/70">
              <tr>
                <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {m.metric()}
                </th>
                <th class="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {m.import_days()}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 bg-white">
              {#each metricCounts as item (item.key)}
                <tr>
                  <td class="px-4 py-2 text-sm text-slate-800">{item.label}</td>
                  <td class="px-4 py-2 text-right text-sm text-slate-600">{item.count}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <p class="mt-3 text-xs text-slate-500">{m.import_daily_note()}</p>

        {#if unmappedTypes.length > 0}
          <details class="mt-3">
            <summary class="cursor-pointer text-xs font-medium text-slate-500">{m.import_unmapped()}</summary>
            <p class="mt-2 text-xs text-slate-400">
              {unmappedTypes.map((item) => `${item.type} (${item.count})`).join(' · ')}
            </p>
          </details>
        {/if}

        {#if errorMessage}
          <p class="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {errorMessage}
          </p>
        {/if}
      {:else if stage === 'importing'}
        <div class="py-8 text-center">
          <p class="text-sm font-medium text-slate-700">{m.import_saving()}</p>
          <div class="mx-auto mt-4 h-2 w-64 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-teal-500 transition-[width]" style={`width: ${Math.round(progress * 100)}%`}></div>
          </div>
          <p class="mt-2 text-xs text-slate-400">{sessionsSent} / {summary?.sessions.length ?? 0}</p>
        </div>
      {:else if stage === 'done'}
        <div class="py-8 text-center">
          <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-6 w-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p class="text-sm font-semibold text-slate-800">
            {m.import_done({ sessions: sessionsSent, values: importedCount })}
          </p>
        </div>
      {/if}
    </div>

    <footer class="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
      {#if stage === 'review'}
        <button
          type="button"
          onclick={() => (stage = 'choose')}
          class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          {m.cancel()}
        </button>
        <button
          type="button"
          onclick={runImport}
          class="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          {m.import_confirm({ count: summary?.sessions.length ?? 0 })}
        </button>
      {:else if stage === 'done'}
        <button
          type="button"
          onclick={onClose}
          class="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          {m.close()}
        </button>
      {:else if stage === 'choose'}
        <button
          type="button"
          onclick={onClose}
          class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          {m.cancel()}
        </button>
      {/if}
    </footer>
  </div>
</div>
