<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import * as m from '$lib/paraglide/messages.js';
  import { downloadPatientArchive } from '$lib/export';

  let {
    patient,
    reports = [],
    records,
    medicines = [],
    energyEntries = [],
    energySources = [],
    onClose,
  }: {
    patient: { id: string; name: string; [key: string]: unknown };
    reports?: unknown[];
    records: unknown[];
    medicines?: unknown[];
    energyEntries?: unknown[];
    energySources?: unknown[];
    onClose: () => void;
  } = $props();

  // Mounted behind {#if showDeleteModal}, so this reads the prop once on
  // purpose: the export a person did in one opening does not carry to the next.
  const hasExportableData = untrack(
    () => records.length + reports.length + medicines.length + energyEntries.length + energySources.length > 0,
  );
  let hasExported = $state(!hasExportableData);
  let confirmName = $state('');
  let exporting = $state(false);
  let exportError = $state('');
  let skipArchive = $state(false);
  let deleteError = $state('');
  const deletionUnlocked = $derived(hasExported || skipArchive);

  async function exportPatientData() {
    exporting = true;
    exportError = '';

    try {
      await downloadPatientArchive(
        { patient, reports, records, medicines, energyEntries, energySources },
        patient?.name,
      );
      hasExported = true;
    } catch {
      exportError = m.export_archive_failed();
    } finally {
      exporting = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
  <div class="bg-white rounded-xl shadow-2xl border border-rose-200 max-w-lg w-full overflow-hidden">
    <div class="px-6 py-4 border-b border-rose-100 bg-rose-50 flex justify-between items-center">
      <h3 class="text-lg font-bold text-rose-800 flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2.5"
          stroke="currentColor"
          class="w-6 h-6"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          /></svg
        >
        {m.danger_zone()}
      </h3>
      <button
        type="button"
        onclick={onClose}
        class="text-slate-400 hover:text-slate-600 transition-colors"
        aria-label={m.cancel()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
        >
      </button>
    </div>

    <div class="p-6 space-y-6">
      <div class="bg-rose-50/50 p-4 border-l-4 border-rose-500 rounded-r-lg text-sm text-rose-800 leading-relaxed">
        {m.danger_description({ name: patient.name })}
      </div>

      <div class="space-y-4">
        {#if hasExportableData}
          <div class="bg-slate-50 p-5 rounded-xl border border-slate-200">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm font-bold text-slate-800 mb-1">{m.step_1_save_backup()}</p>
                <p class="text-xs text-slate-500 mb-3">{m.backup_description()}</p>
              </div>
              {#if hasExported}
                <span
                  class="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"
                    ><path
                      fill-rule="evenodd"
                      d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                      clip-rule="evenodd"
                    /></svg
                  >
                  {m.backed_up()}
                </span>
              {/if}
            </div>
            <button
              type="button"
              onclick={exportPatientData}
              disabled={exporting}
              class="w-full inline-flex justify-center items-center gap-2 bg-white border border-slate-300 shadow-sm px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
                class="w-5 h-5"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                /></svg
              >
              {exporting ? m.exporting_archive() : m.export_health_archive()}
            </button>
            {#if exportError}
              <p class="mt-2 text-xs font-medium text-rose-700" role="alert">{exportError}</p>
              <label class="mt-3 flex items-start gap-2 text-xs text-slate-600">
                <input type="checkbox" bind:checked={skipArchive} class="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
                <span>{m.delete_without_archive()}</span>
              </label>
            {/if}
          </div>
        {/if}

        <div
          class="border border-slate-200 p-5 rounded-xl transition-opacity duration-300"
          class:opacity-50={!deletionUnlocked}
        >
          <p class="text-sm font-bold text-slate-800 mb-1">{hasExportableData ? m.step_2_confirm_deletion() : m.confirm_deletion()}</p>
          <p class="text-xs text-slate-500 mb-3">
            {m.type_name_to_confirm({ name: patient.name })}
            <span class="font-bold font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-800 select-all"
              >{patient.name}</span
            >
          </p>
          <input
            type="text"
            bind:value={confirmName}
            disabled={!deletionUnlocked}
            placeholder={m.type_name_here()}
            class="w-full text-sm font-semibold border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500 px-3 py-2.5 transition-shadow"
          />
        </div>
      </div>

      <form
        method="POST"
        action="?/deletePatient"
        use:enhance={() => {
          deleteError = '';
          return async ({ result, update }) => {
            await update();
            if (result.type === 'success') {
              onClose();
            } else {
              deleteError = m.delete_profile_failed();
            }
          };
        }}
        class="pt-2 flex justify-end gap-3"
      >
        <input type="hidden" name="patientId" value={patient.id} />
        <button
          type="button"
          onclick={onClose}
          class="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 font-bold text-sm rounded-xl shadow-sm hover:bg-slate-50 transition-colors"
          >{m.cancel()}</button
        >

        <button
          type="submit"
          disabled={!deletionUnlocked || confirmName !== patient.name}
          class="px-5 py-2.5 bg-rose-600 text-white font-bold text-sm rounded-xl shadow-sm hover:bg-rose-700 transition-colors disabled:bg-rose-300 disabled:cursor-not-allowed border border-transparent"
        >
          {m.permanently_delete_data()}
        </button>
      </form>
      {#if deleteError}
        <p class="text-right text-xs font-medium text-rose-700" role="alert">{deleteError}</p>
      {/if}
    </div>
  </div>
</div>
