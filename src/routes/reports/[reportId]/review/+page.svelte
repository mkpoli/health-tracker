<script lang="ts">
  import ReportReviewWorkspace from '$lib/components/ReportReviewWorkspace.svelte';
  import { getMetricDefinition, getMetricTags } from '$lib/metrics/catalog';

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

  let { data } = $props();

  function parseJsonLike(value: unknown) {
    if (!value) return {} as Record<string, unknown>;
    if (typeof value === 'object') return value as Record<string, unknown>;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    }
    return {} as Record<string, unknown>;
  }

  function normalizeDateTimeLocal(value?: string | null) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function getReportTitle() {
    const title = typeof metadata.title === 'string' ? metadata.title.trim() : '';
    if (title) return title;

    const facility = typeof metadata.facilityName === 'string' && metadata.facilityName.trim() ? metadata.facilityName.trim() : 'Report';
    return `${facility} ${normalizeDateTimeLocal(data.report.testDate).slice(0, 10)}`;
  }

  const metadata = $derived(parseJsonLike(data.report.extraData));
  const cancelHref = $derived(`/?patientId=${data.currentPatient.id}`);
  const initialMetrics = $derived(
    data.records.map((record: any) => {
      const extraData = parseJsonLike(record.extraData);
      const comparableValue =
        typeof extraData.comparableValue === 'string' || typeof extraData.comparableValue === 'number'
          ? extraData.comparableValue
          : '';
      const derivedCategory = getMetricTags(getMetricDefinition(record.metricName)).categories[0] || 'other';

      return {
        type: typeof extraData.derivedCategory === 'string' ? extraData.derivedCategory : derivedCategory,
        originalLabel: typeof extraData.originalLabel === 'string' ? extraData.originalLabel : record.metricName,
        parsedLabel: typeof extraData.parsedLabel === 'string' ? extraData.parsedLabel : record.metricName,
        value: record.value,
        unit: record.unit || '',
        comparableValue,
        comparableUnit: typeof extraData.comparableUnit === 'string' ? extraData.comparableUnit : record.unit || '',
        comparableReferenceRange:
          typeof extraData.comparableReferenceRange === 'string' ? extraData.comparableReferenceRange : record.refRange || '',
        referenceRange: record.refRange || '',
        date: data.report.testDate,
        status: record.status || 'Review Required',
        notes: typeof extraData.notes === 'string' ? extraData.notes : '',
        saveMode: 'update' as const,
        matchedRecordId: record.id,
      } satisfies ReviewMetric;
    }) as ReviewMetric[],
  );
</script>

<div class="mx-auto max-w-7xl px-6 py-10">
  <ReportReviewWorkspace
    patientId={data.currentPatient.id}
    saveAction="?/save"
    {cancelHref}
    heading={`Review report: ${getReportTitle()}`}
    subtitle="Inspect the original source and update this report side by side."
    initialMetrics={initialMetrics}
    initialFacilityName={typeof metadata.facilityName === 'string' ? metadata.facilityName : ''}
    initialTestDate={normalizeDateTimeLocal(data.report.testDate)}
    initialTargetReportId={data.report.id}
    initialRawSource={typeof data.report.rawData === 'string' ? data.report.rawData : ''}
    reportOptions={[data.report]}
    allowTargetSelection={false}
    allowManualAdd={true}
  />
</div>
