<script lang="ts">
  import ReportReviewWorkspace from '$lib/components/ReportReviewWorkspace.svelte';

  type ReviewMetric = {
    type: string;
    originalLabel: string;
    parsedLabel: string;
    value: string | number;
    unit?: string | null;
    comparableValue?: string | number | null;
    comparableUnit?: string | null;
    comparableReferenceRange?: string | null;
    referenceRange?: string | null;
    date?: string | null;
    status?: string | null;
    notes?: string | null;
    saveMode: 'create' | 'update';
    matchedRecordId: string | null;
  };

  let { data, form } = $props();
  let extractSubmitting = $state(false);

  function startExtractSubmit() {
    extractSubmitting = true;
  }

  const cancelHref = $derived(`/?patientId=${data.currentPatient.id}`);
  const saveAction = $derived(`?/save&patientId=${data.currentPatient.id}`);
  const extractAction = $derived(`/extract?/extract&patientId=${data.currentPatient.id}`);
  const initialMetrics = $derived(
    (form?.review?.metrics || []).map((metric: any) => ({
      ...metric,
      originalLabel: metric.originalLabel || metric.label || '',
      parsedLabel: metric.parsedLabel || metric.label || metric.type || 'Other',
      comparableValue: metric.comparableValue ?? metric.value ?? '',
      comparableUnit: metric.comparableUnit || metric.unit || '',
      comparableReferenceRange: metric.comparableReferenceRange || metric.referenceRange || '',
      saveMode: 'create' as const,
      matchedRecordId: null,
    })) as ReviewMetric[],
  );
</script>

<div class="mx-auto max-w-7xl px-6 py-10">
  {#if !form?.review}
    <div class="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 class="text-3xl font-bold tracking-tight text-slate-900">Review Extracted Records</h1>
      <p class="mt-2 text-slate-500">Upload a document or paste text, then review the extracted values on a dedicated page.</p>

      <form method="POST" action={extractAction} enctype="multipart/form-data" class="mt-8 space-y-5" onsubmit={startExtractSubmit}>
        <div>
          <span class="mb-1.5 block text-sm font-semibold text-slate-700">Upload document</span>
          <input type="file" name="file" accept="image/*,application/pdf" class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700" />
        </div>
        <div>
          <label for="extract-text" class="mb-1.5 block text-sm font-semibold text-slate-700">Paste raw text</label>
          <textarea id="extract-text" name="text" rows="6" placeholder="Paste lab results or report text" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700"></textarea>
        </div>
        {#if form?.error}
          <p class="text-sm text-rose-600">{form.error}</p>
        {/if}
        <div class="flex items-center gap-3">
          <a href={cancelHref} class="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700">Cancel</a>
          <button type="submit" disabled={extractSubmitting} class="rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:bg-teal-400">{extractSubmitting ? 'Preparing review...' : 'Extract data'}</button>
        </div>
        {#if extractSubmitting}
          <div class="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
            Uploading the document and extracting metrics. This can take a little while for larger files.
          </div>
        {/if}
      </form>
    </div>
  {:else}
    <ReportReviewWorkspace
      patientId={data.currentPatient.id}
      saveAction={saveAction}
      {cancelHref}
      initialMetrics={initialMetrics}
      initialFacilityName={form.review.facilityName}
      initialTestDate={form.review.reportDate}
      initialRawSource={form.review.rawSource}
      reportOptions={data.reports}
      allowTargetSelection={true}
    />
  {/if}
</div>
