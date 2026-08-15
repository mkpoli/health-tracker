<script lang="ts">
  import { enhance } from '$app/forms';
  import * as m from '$lib/paraglide/messages.js';
  import { getMetricLabel } from '$lib/metrics/labels';
  import FileDropZone from './FileDropZone.svelte';
  import TimeZoneField from './TimeZoneField.svelte';

  // The lab equivalent of the measurement dialog: one dashed "+" opens it, and
  // the manual form and the document extractor live inside as two modes.
  let {
    patientId,
    timeZone,
    smartUploadActive = $bindable(true),
    recordType = $bindable('Blood Pressure'),
    valueLabel,
    valuePlaceholder,
    homepageExtractFile = null,
    homepageExtractInput = $bindable<HTMLInputElement | null>(null),
    homepageExtractSubmitting = false,
    onExtractFileSelect,
    onExtractPaste,
    onExtractSubmit,
    onClose,
  }: {
    patientId: string;
    timeZone: string;
    smartUploadActive?: boolean;
    recordType?: string;
    valueLabel: string;
    valuePlaceholder: string;
    homepageExtractFile?: File | null;
    homepageExtractInput?: HTMLInputElement | null;
    homepageExtractSubmitting?: boolean;
    onExtractFileSelect: (file: File, list: FileList) => void;
    onExtractPaste: (event: ClipboardEvent) => void;
    onExtractSubmit: (event: SubmitEvent) => void;
    onClose: () => void;
  } = $props();

  let manualDate = $state('');

  function initialTimeZone() {
    return timeZone;
  }

  let manualTimeZone = $state(initialTimeZone());

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/50 backdrop-blur-sm sm:items-start sm:p-8"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
>
  <div
    class="sheet-enter app-scroll flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:my-auto sm:max-h-none sm:rounded-2xl"
    role="dialog"
    aria-modal="true"
    aria-label={m.add_clinical_record()}
  >
    <header class="shrink-0 border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-6 sm:py-5">
      <div class="flex items-start justify-between gap-4">
        <h2 class="text-xl font-semibold tracking-tight text-slate-900">{m.add_clinical_record()}</h2>
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
      </div>
      <div class="mt-4 flex bg-slate-200/50 p-1 rounded-lg">
                  <button
                    class="flex-1 py-1.5 text-sm font-medium rounded-md transition-colors {!smartUploadActive
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'}"
                    onclick={() => (smartUploadActive = false)}
                  >
                    {m.manual()}
                  </button>
                  <button
                    class="flex-1 py-1.5 text-sm font-medium rounded-md transition-colors {smartUploadActive
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'}"
                    onclick={() => (smartUploadActive = true)}
                  >
                    {m.test_result()}
                  </button>
      </div>
    </header>

    <div class="app-scroll flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                {#if !smartUploadActive}
                  <form method="POST" action="?/addManualRecord" use:enhance class="space-y-5">
                    <input type="hidden" name="patientId" value={patientId} />
                    <div>
                      <label for="manual-facility" class="block text-sm font-semibold text-slate-700 mb-1.5"
                        >{m.lab_or_hospital()} <span class="text-slate-400 font-normal">({m.optional()})</span></label
                      >
                      <input
                        type="text"
                        name="facilityName"
                        id="manual-facility"
                        placeholder={m.facility_example()}
                        class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label for="metric-type" class="block text-sm font-semibold text-slate-700 mb-1.5"
                        >{m.metric_type()}</label
                      >
                      <div class="relative">
                        <select
                          id="metric-type"
                          name="type"
                          bind:value={recordType}
                          class="appearance-none w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 pl-3 pr-10 border outline-none transition-colors"
                        >
                          <option value="Blood Pressure">{getMetricLabel('Blood Pressure')}</option>
                          <option value="Blood Glucose">{getMetricLabel('Blood Glucose')}</option>
                          <option value="Cholesterol">{getMetricLabel('Cholesterol')}</option>
                          <option value="Other">{m.other_lab_metric()}</option>
                        </select>
                        <div
                          class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500"
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"
                            ></path></svg
                          >
                        </div>
                      </div>
                    </div>
                    <div>
                      <label for="metric-value" class="block text-sm font-semibold text-slate-700 mb-1.5"
                        >{valueLabel}</label
                      >
                      <input
                        type="text"
                        name="value"
                        id="metric-value"
                        placeholder={valuePlaceholder}
                        required
                        class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label for="date-time" class="block text-sm font-semibold text-slate-700 mb-1.5"
                        >{m.date_time()}</label
                      >
                      <input
                        type="datetime-local"
                        name="date"
                        id="date-time"
                        bind:value={manualDate}
                        class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors"
                      />
                    </div>
                    <TimeZoneField
                      id="manual-time-zone"
                      name="timeZone"
                      dateTime={manualDate}
                      bind:value={manualTimeZone}
                    />
                    <div>
                      <label for="notes" class="block text-sm font-semibold text-slate-700 mb-1.5"
                        >{m.clinical_notes()} <span class="text-slate-400 font-normal">({m.optional()})</span></label
                      >
                      <textarea
                        name="notes"
                        id="notes"
                        rows="3"
                        placeholder={m.condition_details()}
                        class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors resize-none placeholder-slate-400"
                      ></textarea>
                    </div>
                    <div class="pt-2">
                      <button
                        type="submit"
                        class="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-all active:scale-[0.98]"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke-width="2.5"
                          stroke="currentColor"
                          class="w-4 h-4 mr-2"
                          ><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg
                        >
                        {m.save_record()}
                      </button>
                    </div>
                  </form>
                {:else}
                  <form
                    method="POST"
                    action={`/extract?/extract&patientId=${patientId}`}
                    enctype="multipart/form-data"
                    class="space-y-5"
                    onsubmit={onExtractSubmit}
                  >
                    <div>
                      <span class="block text-sm font-semibold text-slate-700 mb-1.5">{m.upload_document()}</span>
                      <FileDropZone
                        name="file"
                        accept="image/*,application/pdf"
                        extensions={['.png', '.jpg', '.jpeg', '.webp', '.heic', '.gif', '.pdf']}
                        bind:inputRef={homepageExtractInput}
                        selectedFile={homepageExtractFile}
                        title={m.upload_file()}
                        hint={m.file_size_hint()}
                        onSelect={onExtractFileSelect}
                      />
                    </div>
                    <div>
                      <label for="homepage-extract-text" class="block text-sm font-semibold text-slate-700 mb-1.5"
                        >{m.paste_raw_text()}</label
                      >
                      <textarea
                        id="homepage-extract-text"
                        name="text"
                        rows="3"
                        placeholder={m.paste_lab_results()}
                        class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors resize-none placeholder-slate-400"
                        onpaste={onExtractPaste}
                      ></textarea>
                    </div>
                    <div class="pt-2">
                      <button
                        type="submit"
                        disabled={homepageExtractSubmitting}
                        class="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 disabled:cursor-wait focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-all active:scale-[0.98]"
                      >
                        {#if homepageExtractSubmitting}
                          <svg
                            class="-ml-1 mr-2 h-4 w-4 animate-spin text-white"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            ><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
                            ></circle><path
                              class="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path></svg
                          >
                          Preparing review...
                        {:else}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke-width="2.5"
                            stroke="currentColor"
                            class="w-4 h-4 mr-2"
                            ><path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
                            ></path></svg
                          >
                          {m.smart_extract()}
                        {/if}
                      </button>
                    </div>
                    {#if homepageExtractSubmitting}
                      <div class="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                        Uploading the document and extracting metrics. This can take a little while for larger files.
                      </div>
                    {/if}
                  </form>
                {/if}
    </div>
  </div>
</div>
