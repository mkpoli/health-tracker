<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import * as m from '$lib/paraglide/messages.js';
  import { readAppleHealthFile, type ImportSession, type ImportSummary } from '$lib/import/apple-health';
  import {
    chunkArchiveItems,
    forEachArchiveMedia,
    HealthArchiveError,
    readHealthArchiveFile,
    type HealthArchiveMediaFile,
    type ReadHealthArchiveResult,
  } from '$lib/health-archive';
  import { getMetricDefinitionByKey } from '$lib/metrics/catalog';
  import { getDefinitionLabel } from '$lib/metrics/labels';
  import FileDropZone from './FileDropZone.svelte';

  let {
    patientId,
    initialFile = null,
    onClose,
  }: {
    patientId: string;
    initialFile?: File | null;
    onClose: () => void;
  } = $props();

  type Stage = 'choose' | 'reading' | 'review' | 'importing' | 'done';

  let stage = $state<Stage>('choose');
  let fileName = $state('');
  let progress = $state(0);
  let summary = $state<ImportSummary | null>(null);
  let healthArchive = $state<ReadHealthArchiveResult | null>(null);
  let sourceFile = $state<File | null>(null);
  let importKind = $state<'apple-health' | 'health-archive' | null>(null);
  let errorMessage = $state('');
  let importedCount = $state(0);
  let sessionsSent = $state(0);
  let mediaRestored = $state(0);
  let mediaMissing = $state(0);
  let restoreProfile = $state(false);

  // Chunked actions cap Worker request size for long histories.
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

  const archiveStructuredCount = $derived(
    healthArchive
      ? healthArchive.data.reports.length +
          healthArchive.data.records.length +
          healthArchive.data.medicines.length +
          healthArchive.data.energyEntries.length +
          healthArchive.data.exerciseDefinitions.length +
          healthArchive.data.workouts.length +
          healthArchive.data.claimRevisions.length
      : 0,
  );
  const archiveSelectedCount = $derived(archiveStructuredCount + (restoreProfile ? 1 : 0));

  const archiveEnergySources = $derived.by(() => {
    const claims = new Map<
      string,
      { originProvider?: string; originExternalId?: string }
    >();
    const byId = new Map<
      string,
      { energyClaimId: string; originProvider?: string; originExternalId?: string }
    >();
    if (!healthArchive) return byId;

    for (const value of healthArchive.data.energyEntries) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const claim = value as Record<string, unknown>;
      if (typeof claim.id !== 'string') continue;
      claims.set(claim.id, {
        ...(typeof claim.originProvider === 'string' ? { originProvider: claim.originProvider } : {}),
        ...(typeof claim.originExternalId === 'string' ? { originExternalId: claim.originExternalId } : {}),
      });
    }

    for (const value of healthArchive.data.energySources) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const source = value as Record<string, unknown>;
      if (typeof source.id === 'string' && typeof source.energyClaimId === 'string') {
        byId.set(source.id, {
          energyClaimId: source.energyClaimId,
          ...claims.get(source.energyClaimId),
        });
      }
    }

    return byId;
  });

  function formatDate(value: string | null) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  async function readFile(file: File) {
    fileName = file.name;
    sourceFile = file;
    errorMessage = '';
    progress = 0;
    summary = null;
    healthArchive = null;
    importKind = null;
    restoreProfile = false;
    stage = 'reading';

    try {
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.json')) {
        healthArchive = await readHealthArchiveFile(file, (read, total) => {
          progress = total > 0 ? Math.min(read / total, 1) : 0;
        });
        importKind = 'health-archive';
      } else if (lowerName.endsWith('.zip')) {
        try {
          healthArchive = await readHealthArchiveFile(file, (read, total) => {
            progress = total > 0 ? Math.min(read / total, 1) : 0;
          });
          importKind = 'health-archive';
        } catch (error) {
          if (!(error instanceof HealthArchiveError) || error.code !== 'manifest_missing') throw error;

          summary = await readAppleHealthFile(file, (read, total) => {
            progress = total > 0 ? Math.min(read / total, 1) : 0;
          });
          importKind = 'apple-health';
        }
      } else {
        summary = await readAppleHealthFile(file, (read, total) => {
          progress = total > 0 ? Math.min(read / total, 1) : 0;
        });
        importKind = 'apple-health';
      }

      if (importKind === 'apple-health' && summary?.sessions.length === 0) {
        errorMessage = m.import_nothing_found();
        stage = 'choose';
        return;
      }
      stage = 'review';
    } catch (error) {
      errorMessage = error instanceof HealthArchiveError ? m.import_archive_invalid() : error instanceof Error ? error.message : m.import_failed();
      stage = 'choose';
    }
  }

  let initialFileHandled = false;
  $effect(() => {
    if (!initialFile || initialFileHandled) return;
    initialFileHandled = true;
    void readFile(initialFile);
  });

  async function runImport() {
    if (importKind === 'health-archive') {
      await runArchiveImport();
      return;
    }
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

  type ArchiveBatch = {
    kind:
      | 'profile'
      | 'reports'
      | 'records'
      | 'medicines'
      | 'energy'
      | 'exerciseDefinitions'
      | 'workouts'
      | 'revisions';
    items: unknown[];
  };

  function archiveBatches() {
    if (!healthArchive) return [] as ArchiveBatch[];

    const batches: ArchiveBatch[] = [];
    const add = (kind: ArchiveBatch['kind'], items: unknown[], size: number) => {
      for (const batch of chunkArchiveItems(items, size)) batches.push({ kind, items: batch });
    };

    if (restoreProfile) add('profile', [healthArchive.data.patient], 1);
    add('reports', healthArchive.data.reports, 100);
    add('records', healthArchive.data.records, 200);
    add('medicines', healthArchive.data.medicines, 100);
    add('energy', healthArchive.data.energyEntries, 100);
    add('exerciseDefinitions', healthArchive.data.exerciseDefinitions, 20);
    add(
      'workouts',
      [...healthArchive.data.workouts].sort((left, right) => {
        const leftKind = left && typeof left === 'object' && !Array.isArray(left) && 'kind' in left
          ? String(left.kind)
          : '';
        const rightKind = right && typeof right === 'object' && !Array.isArray(right) && 'kind' in right
          ? String(right.kind)
          : '';
        return Number(rightKind === 'plan') - Number(leftKind === 'plan');
      }),
      5,
    );
    add('revisions', healthArchive.data.claimRevisions, 200);
    return batches;
  }

  type LinkedArchiveMedia = HealthArchiveMediaFile & {
    energyClaimId?: string;
    originProvider?: string;
    originExternalId?: string;
  };

  function mediaWithSourceLinks() {
    if (!healthArchive) return [] as LinkedArchiveMedia[];

    return healthArchive.data.mediaFiles.flatMap((media) => {
      if (!healthArchive?.availableMediaPaths.has(media.archivePath)) return [];
      if (media.sourceKind === 'report-source') return [media];

      const source = archiveEnergySources.get(media.sourceId);
      return source ? [{ ...media, energyClaimId: source.energyClaimId }] : [];
    });
  }

  async function postArchiveBatch(batch: ArchiveBatch) {
    if (!healthArchive) return;

    const body = new FormData();
    body.set('patientId', patientId);
    body.set('sourcePatientId', String(healthArchive.data.patient.id));
    body.set('kind', batch.kind);
    body.set('version', String(healthArchive.data.version));
    body.set('items', JSON.stringify(batch.items));

    const response = await fetch('?/importArchiveBatch', { method: 'POST', body });
    const payload = (await response.json()) as { type?: string };
    if (!response.ok || payload.type !== 'success') throw new Error(m.import_archive_failed());
  }

  async function uploadArchiveMedia(
    media: LinkedArchiveMedia,
    bytes: Uint8Array,
  ) {
    const file = new File(
      [Uint8Array.from(bytes).buffer],
      media.fileName || media.archivePath.split('/').at(-1) || 'archive-file',
      { type: media.mimeType || 'application/octet-stream' },
    );
    const body = new FormData();
    body.set('patientId', patientId);
    body.set('sourcePatientId', String(healthArchive?.data.patient.id || ''));
    body.set('metadata', JSON.stringify(media));
    body.set('file', file);

    const response = await fetch('?/importArchiveMedia', { method: 'POST', body });
    const payload = (await response.json()) as { type?: string };
    if (!response.ok || payload.type !== 'success') throw new Error(m.import_archive_failed());
  }

  async function runArchiveImport() {
    if (!healthArchive || !sourceFile) return;

    stage = 'importing';
    importedCount = 0;
    mediaRestored = 0;
    errorMessage = '';
    progress = 0;

    const batches = archiveBatches();
    const linkedMedia = mediaWithSourceLinks();
    mediaMissing =
      healthArchive.missingMediaPaths.length +
      healthArchive.data.mediaFiles.filter(
        (media) =>
          media.sourceKind === 'energy-photo' &&
          healthArchive?.availableMediaPaths.has(media.archivePath) &&
          !archiveEnergySources.has(media.sourceId),
      ).length;
    const totalSteps = Math.max(1, batches.length + linkedMedia.length);
    let completedSteps = 0;

    try {
      for (const batch of batches) {
        await postArchiveBatch(batch);
        importedCount += batch.items.length;
        completedSteps += 1;
        progress = completedSteps / totalSteps;
      }

      if (healthArchive.kind === 'zip' && linkedMedia.length > 0) {
        const completedMedia = await forEachArchiveMedia(sourceFile, linkedMedia, async (media, bytes) => {
          const linked = linkedMedia.find((item) => item.archivePath === media.archivePath);
          if (!linked) return;
          await uploadArchiveMedia(linked, bytes);
          mediaRestored += 1;
          completedSteps += 1;
          progress = completedSteps / totalSteps;
        });
        mediaMissing += linkedMedia.length - completedMedia.size;
      }

      await invalidateAll();
      progress = 1;
      stage = 'done';
    } catch (error) {
      errorMessage = error instanceof HealthArchiveError ? m.import_archive_invalid() : m.import_archive_failed();
      stage = 'review';
    }
  }

  let removing = $state(false);

  // Imported sessions carry the source tag used by undo. Hand-entered sessions
  // have separate provenance.
  async function removeImported() {
    if (!confirm(m.import_undo_confirm())) return;

    removing = true;

    const body = new FormData();
    body.set('patientId', patientId);
    body.set('source', 'apple-health');

    const response = await fetch('?/removeImportedMeasurements', { method: 'POST', body });
    const payload = (await response.json()) as { type?: string };

    removing = false;

    if (payload.type === 'success') {
      await invalidateAll();
      onClose();
    } else {
      errorMessage = m.import_failed();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && stage !== 'importing') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/50 backdrop-blur-sm sm:items-start sm:p-8"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget && stage !== 'importing') onClose();
  }}
>
  <div
    class="sheet-enter app-scroll flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:my-auto sm:max-h-none sm:rounded-2xl"
    role="dialog"
    aria-modal="true"
    aria-label={m.import_data()}
  >
    <header class="shrink-0 flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-6 sm:py-5">
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

    <div class="app-scroll flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      {#if stage === 'choose'}
        <div class="mb-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-xl border border-teal-200 bg-teal-50/60 p-4">
            <p class="text-sm font-semibold text-teal-900">{m.import_health_archive_title()}</p>
            <p class="mt-1 text-xs leading-relaxed text-teal-800">{m.import_health_archive_hint()}</p>
          </div>
          <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p class="text-sm font-semibold text-slate-800">{m.import_apple_health_title()}</p>
            <p class="mt-1 text-xs leading-relaxed text-slate-600">{m.import_apple_health_hint()}</p>
          </div>
        </div>

        <FileDropZone
          accept=".zip,.xml,.json,application/zip,application/json,text/xml,application/xml"
          extensions={['.zip', '.xml', '.json']}
          title={m.import_choose_file()}
          hint={m.import_archive_file_hint()}
          onSelect={(file) => readFile(file)}
        />

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
      {:else if stage === 'review'}
        {#if importKind === 'apple-health' && summary}
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
        {:else if importKind === 'health-archive' && healthArchive}
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-sm font-semibold text-slate-900">{m.import_health_archive_title()}</p>
              <p class="mt-0.5 text-xs text-slate-500">{fileName}</p>
            </div>
            <span class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {m.import_archive_version({ version: healthArchive.data.version })}
            </span>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div class="rounded-xl border border-slate-200 bg-white p-3">
              <p class="text-xs font-medium text-slate-500">{m.import_archive_reports()}</p>
              <p class="mt-1 text-2xl font-semibold text-slate-900">{healthArchive.data.reports.length}</p>
            </div>
            <div class="rounded-xl border border-slate-200 bg-white p-3">
              <p class="text-xs font-medium text-slate-500">{m.import_archive_values()}</p>
              <p class="mt-1 text-2xl font-semibold text-slate-900">{healthArchive.data.records.length}</p>
            </div>
            <div class="rounded-xl border border-blue-200 bg-blue-50/60 p-3">
              <p class="text-xs font-medium text-blue-700">{m.tab_medicine()}</p>
              <p class="mt-1 text-2xl font-semibold text-blue-950">{healthArchive.data.medicines.length}</p>
            </div>
            <div class="rounded-xl border border-orange-200 bg-orange-50/60 p-3">
              <p class="text-xs font-medium text-orange-700">{m.tab_calories()}</p>
              <p class="mt-1 text-2xl font-semibold text-orange-950">{healthArchive.data.energyEntries.length}</p>
            </div>
            <div class="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
              <p class="text-xs font-medium text-violet-700">{m.workouts_title()}</p>
              <p class="mt-1 text-2xl font-semibold text-violet-950">{healthArchive.data.workouts.length}</p>
            </div>
            <div class="rounded-xl border border-slate-200 bg-white p-3">
              <p class="text-xs font-medium text-slate-500">{m.import_archive_versions()}</p>
              <p class="mt-1 text-2xl font-semibold text-slate-900">{healthArchive.data.claimRevisions.length}</p>
            </div>
            <div class="rounded-xl border border-slate-200 bg-white p-3">
              <p class="text-xs font-medium text-slate-500">{m.import_archive_media()}</p>
              <p class="mt-1 text-2xl font-semibold text-slate-900">{healthArchive.availableMediaPaths.size}</p>
            </div>
          </div>

          <div class="mt-4 space-y-2 text-xs leading-relaxed">
            <label class="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-slate-700">
              <input
                type="checkbox"
                bind:checked={restoreProfile}
                class="mt-0.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>
                <span class="block font-semibold text-slate-800">{m.import_archive_restore_profile()}</span>
                <span class="mt-0.5 block text-slate-500">
                  {m.import_archive_restore_profile_hint({ name: String(healthArchive.data.patient.name || '') })}
                </span>
              </span>
            </label>
            <p class="rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-teal-800">
              {m.import_archive_merge_hint()}
            </p>
            {#if healthArchive.kind === 'json' && healthArchive.data.mediaFiles.length > 0}
              <p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                {m.import_archive_json_media_warning({ count: healthArchive.data.mediaFiles.length })}
              </p>
            {:else if healthArchive.missingMediaPaths.length > 0}
              <p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                {m.import_archive_missing_media({ count: healthArchive.missingMediaPaths.length })}
              </p>
            {:else if healthArchive.availableMediaPaths.size > 0}
              <p class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
                {m.import_archive_media_ready({ count: healthArchive.availableMediaPaths.size })}
              </p>
            {/if}
          </div>
        {/if}

        {#if errorMessage}
          <p class="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {errorMessage}
          </p>
        {/if}
      {:else if stage === 'importing'}
        <div class="py-8 text-center">
          <p class="text-sm font-medium text-slate-700">
            {importKind === 'health-archive' ? m.import_archive_saving() : m.import_saving()}
          </p>
          <div class="mx-auto mt-4 h-2 w-64 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-teal-500 transition-[width]" style={`width: ${Math.round(progress * 100)}%`}></div>
          </div>
          <p class="mt-2 text-xs text-slate-400">
            {importKind === 'health-archive'
              ? `${importedCount} · ${m.import_archive_media_restored({ count: mediaRestored })}`
              : `${sessionsSent} / ${summary?.sessions.length ?? 0}`}
          </p>
        </div>
      {:else if stage === 'done'}
        <div class="py-8 text-center">
          <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-6 w-6">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          {#if importKind === 'health-archive'}
            <p class="text-sm font-semibold text-slate-800">
              {m.import_archive_done({ items: importedCount, media: mediaRestored })}
            </p>
            {#if mediaMissing > 0}
              <p class="mt-2 text-xs text-amber-700">{m.import_archive_missing_media({ count: mediaMissing })}</p>
            {/if}
          {:else}
            <p class="text-sm font-semibold text-slate-800">
              {m.import_done({ sessions: sessionsSent, values: importedCount })}
            </p>
            <button
              type="button"
              onclick={removeImported}
              disabled={removing}
              class="mt-4 text-sm font-medium text-rose-600 underline underline-offset-2 transition-colors hover:text-rose-700 disabled:text-slate-400"
            >
              {removing ? m.saving() : m.import_undo()}
            </button>
            <p class="mt-1 text-xs text-slate-400">{m.import_undo_hint()}</p>
          {/if}
        </div>
      {/if}
    </div>

    <footer class="shrink-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-6 sm:py-4" style="padding-bottom: calc(0.75rem + var(--safe-bottom))">
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
          disabled={importKind === 'health-archive' && archiveSelectedCount === 0}
          class="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {importKind === 'health-archive'
            ? m.import_archive_confirm({ count: archiveSelectedCount })
            : m.import_confirm({ count: summary?.sessions.length ?? 0 })}
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
