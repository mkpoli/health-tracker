<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import { changedClaimFields, type MedicineClaimRevisionRecord } from '$lib/claim-revision';
  import type { MedicineClaimRecord, MedicineStatus } from '$lib/medicine';
  import ClaimRevisionTimeline from './ClaimRevisionTimeline.svelte';

  let {
    patientId,
    medicines = [],
    revisions = [],
  }: {
    patientId: string;
    medicines: MedicineClaimRecord[];
    revisions: MedicineClaimRevisionRecord[];
  } = $props();

  type Draft = {
    id: string;
    revision: number;
    name: string;
    genericName: string;
    form: string;
    strength: string;
    route: string;
    schedule: string;
    status: MedicineStatus;
    startDate: string;
    endDate: string;
    purpose: string;
    prescriber: string;
    notes: string;
  };

  const currentStatuses: MedicineStatus[] = ['active', 'planned', 'paused'];
  const pastStatuses: MedicineStatus[] = ['completed', 'stopped'];

  let editorOpen = $state(false);
  let saving = $state(false);
  let saveError = $state('');
  let draft = $state<Draft>(emptyDraft());

  const currentMedicines = $derived(
    medicines.filter((medicine) => currentStatuses.includes(medicine.status)),
  );
  const pastMedicines = $derived(
    medicines.filter((medicine) => pastStatuses.includes(medicine.status)),
  );
  const revisionsByMedicine = $derived.by(() => {
    const grouped = new Map<string, MedicineClaimRevisionRecord[]>();

    for (const revision of revisions) {
      const history = grouped.get(revision.claimId) || [];
      history.push(revision);
      grouped.set(revision.claimId, history);
    }

    for (const history of grouped.values()) {
      history.sort((a, b) => b.revision - a.revision);
    }

    return grouped;
  });

  function emptyDraft(): Draft {
    return {
      id: '',
      revision: 0,
      name: '',
      genericName: '',
      form: '',
      strength: '',
      route: '',
      schedule: '',
      status: 'active',
      startDate: '',
      endDate: '',
      purpose: '',
      prescriber: '',
      notes: '',
    };
  }

  function openCreate() {
    draft = emptyDraft();
    saveError = '';
    editorOpen = true;
  }

  function openEdit(medicine: MedicineClaimRecord) {
    draft = {
      id: medicine.id,
      revision: medicine.revision,
      name: medicine.name,
      genericName: medicine.genericName || '',
      form: medicine.form || '',
      strength: medicine.strength || '',
      route: medicine.route || '',
      schedule: medicine.schedule || '',
      status: medicine.status,
      startDate: medicine.startDate || '',
      endDate: medicine.endDate || '',
      purpose: medicine.purpose || '',
      prescriber: medicine.prescriber || '',
      notes: medicine.notes || '',
    };
    saveError = '';
    editorOpen = true;
  }

  function closeEditor() {
    if (saving) return;
    editorOpen = false;
    saveError = '';
  }

  const submitMedicine: SubmitFunction = () => {
    saving = true;
    saveError = '';

    return async ({ result, update }) => {
      if (result.type === 'success') {
        await update({ reset: true, invalidateAll: true });
        saving = false;
        editorOpen = false;
        draft = emptyDraft();
        return;
      }

      if (result.type === 'failure' && result.status === 409) {
        await invalidateAll();
        saveError = m.claim_revision_stale();
      } else {
        saveError = m.medicine_save_failed();
      }
      saving = false;
    };
  };

  function statusLabel(status: MedicineStatus) {
    if (status === 'active') return m.medicine_status_active();
    if (status === 'planned') return m.medicine_status_planned();
    if (status === 'paused') return m.medicine_status_paused();
    if (status === 'completed') return m.medicine_status_completed();
    return m.medicine_status_stopped();
  }

  function statusTone(status: MedicineStatus) {
    if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'planned') return 'border-blue-200 bg-blue-50 text-blue-700';
    if (status === 'paused') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (status === 'completed') return 'border-slate-200 bg-slate-50 text-slate-600';
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }

  function medicineSummary(medicine: MedicineClaimRecord) {
    return [medicine.strength, medicine.form].filter(Boolean).join(' · ');
  }

  function formatDateOnly(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(date);
  }

  function dateSummary(medicine: MedicineClaimRecord) {
    if (medicine.startDate && medicine.endDate) {
      return m.medicine_period_between({
        startDate: formatDateOnly(medicine.startDate),
        endDate: formatDateOnly(medicine.endDate),
      });
    }

    if (medicine.startDate) {
      return m.medicine_period_from({ date: formatDateOnly(medicine.startDate) });
    }

    if (medicine.endDate) {
      return m.medicine_period_until({ date: formatDateOnly(medicine.endDate) });
    }

    return '';
  }

  function medicineFieldLabel(field: string) {
    if (field === 'name') return m.medicine_name();
    if (field === 'genericName') return m.medicine_generic_name();
    if (field === 'form') return m.medicine_form();
    if (field === 'strength') return m.medicine_strength();
    if (field === 'route') return m.medicine_route();
    if (field === 'schedule') return m.medicine_schedule();
    if (field === 'status') return m.medicine_status();
    if (field === 'startDate') return m.medicine_start_date();
    if (field === 'endDate') return m.medicine_end_date();
    if (field === 'purpose') return m.medicine_purpose();
    if (field === 'prescriber') return m.medicine_prescriber();
    if (field === 'notes') return m.notes();
    if (field === 'originExternalId') return m.claim_field_source_reference();
    if (field === 'originKind' || field === 'originProvider') return m.claim_field_source();
    return field;
  }

  function medicineRevisionItems(medicine: MedicineClaimRecord) {
    const history = revisionsByMedicine.get(medicine.id) || [];

    return history.map((revision, index) => {
      const previous = history[index + 1]?.snapshot || null;
      const snapshot = revision.snapshot;
      const fields = changedClaimFields(snapshot, previous).map(medicineFieldLabel);

      return {
        id: revision.id,
        revision: revision.revision,
        changedAt: revision.changedAt,
        current: revision.revision === medicine.revision,
        changedFields: [...new Set(fields)],
        primary: [snapshot.name, medicineSummary(snapshot)].filter(Boolean).join(' · '),
        secondary: [statusLabel(snapshot.status), snapshot.schedule].filter(Boolean).join(' · '),
      };
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && editorOpen) closeEditor();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  <header class="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/60 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
    <div class="flex items-start gap-3">
      <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6.75l6.75 6.75m-9.9 3.15l9.3-9.3a3.182 3.182 0 00-4.5-4.5l-9.3 9.3a3.182 3.182 0 004.5 4.5zm0 0l-1.2 1.2a3.182 3.182 0 004.5 4.5l1.2-1.2" />
        </svg>
      </div>
      <div>
        <h3 class="text-lg font-semibold tracking-tight text-slate-900">{m.medicine_title()}</h3>
        <p class="mt-1 text-sm text-slate-500">{m.medicine_subtitle()}</p>
        {#if medicines.length > 0}
          <div class="mt-3 flex flex-wrap gap-2">
            {#each currentStatuses as status}
              <span class={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(status)}`}>
                {statusLabel(status)} {medicines.filter((medicine) => medicine.status === status).length}
              </span>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <button
      type="button"
      onclick={openCreate}
      class="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-4 w-4" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      {m.add_medicine()}
    </button>
  </header>

  {#if medicines.length === 0}
    <div class="flex flex-col items-center px-6 py-16 text-center">
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-500">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="h-7 w-7" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6.75l6.75 6.75m-9.9 3.15l9.3-9.3a3.182 3.182 0 00-4.5-4.5l-9.3 9.3a3.182 3.182 0 004.5 4.5zm0 0l-1.2 1.2a3.182 3.182 0 004.5 4.5l1.2-1.2" />
        </svg>
      </div>
      <h4 class="mt-4 font-semibold text-slate-800">{m.no_medicines()}</h4>
      <p class="mt-1 max-w-md text-sm text-slate-500">{m.no_medicines_hint()}</p>
      <button type="button" onclick={openCreate} class="mt-5 text-sm font-semibold text-blue-700 hover:text-blue-800">
        {m.add_medicine()}
      </button>
    </div>
  {:else}
    <div class="space-y-8 p-4 sm:p-6">
      {#if currentMedicines.length > 0}
        <div>
          <h4 class="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {m.medicine_current_plans()}
          </h4>
          <div class="grid gap-4 lg:grid-cols-2">
            {#each currentMedicines as medicine (medicine.id)}
              {@render medicineCard(medicine)}
            {/each}
          </div>
        </div>
      {/if}

      {#if pastMedicines.length > 0}
        <div>
          <h4 class="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {m.medicine_past()}
          </h4>
          <div class="grid gap-4 lg:grid-cols-2">
            {#each pastMedicines as medicine (medicine.id)}
              {@render medicineCard(medicine)}
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>

{#snippet medicineCard(medicine: MedicineClaimRecord)}
  <article class="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-colors hover:border-blue-200">
    <div class="p-4 sm:p-5">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h5 class="text-base font-semibold text-slate-900">{medicine.name}</h5>
          <span class={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusTone(medicine.status)}`}>
            {statusLabel(medicine.status)}
          </span>
        </div>
        {#if medicine.genericName}
          <p class="mt-1 text-sm text-slate-500">{medicine.genericName}</p>
        {/if}
        {#if medicineSummary(medicine)}
          <p class="mt-2 text-sm font-medium text-slate-700">{medicineSummary(medicine)}</p>
        {/if}
      </div>

      <button
        type="button"
        onclick={() => openEdit(medicine)}
        class="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
      >
        {m.edit_medicine()}
      </button>
    </div>

    {#if medicine.schedule}
      <div class="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-3">
        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">{m.medicine_schedule()}</p>
        <p class="mt-1 text-sm font-medium leading-relaxed text-blue-950">{medicine.schedule}</p>
      </div>
    {/if}

    {#if medicine.route || dateSummary(medicine) || medicine.purpose || medicine.prescriber}
      <dl class="mt-4 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        {#if medicine.route}
          <div>
            <dt class="text-xs font-medium text-slate-400">{m.medicine_route()}</dt>
            <dd class="mt-0.5 text-slate-700">{medicine.route}</dd>
          </div>
        {/if}
        {#if dateSummary(medicine)}
          <div>
            <dt class="text-xs font-medium text-slate-400">{m.medicine_period()}</dt>
            <dd class="mt-0.5 text-slate-700">{dateSummary(medicine)}</dd>
          </div>
        {/if}
        {#if medicine.purpose}
          <div>
            <dt class="text-xs font-medium text-slate-400">{m.medicine_purpose()}</dt>
            <dd class="mt-0.5 text-slate-700">{medicine.purpose}</dd>
          </div>
        {/if}
        {#if medicine.prescriber}
          <div>
            <dt class="text-xs font-medium text-slate-400">{m.medicine_prescriber()}</dt>
            <dd class="mt-0.5 text-slate-700">{medicine.prescriber}</dd>
          </div>
        {/if}
      </dl>
    {/if}

    {#if medicine.notes}
      <p class="mt-4 border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-600">{medicine.notes}</p>
    {/if}

    <div class="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
      <p class="text-xs text-slate-400">
        {m.medicine_updated({ date: formatDateOnly(medicine.updatedAt.slice(0, 10)) })}
      </p>
      <form
        method="POST"
        action="?/deleteMedicine"
        use:enhance={(submission) => {
          if (!confirm(m.medicine_delete_confirm({ name: medicine.name }))) submission.cancel();
        }}
      >
        <input type="hidden" name="id" value={medicine.id} />
        <button type="submit" class="text-xs font-semibold text-rose-600 transition-colors hover:text-rose-700">
          {m.medicine_delete()}
        </button>
      </form>
    </div>
    </div>
    <ClaimRevisionTimeline items={medicineRevisionItems(medicine)} />
  </article>
{/snippet}

{#if editorOpen}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/55 backdrop-blur-sm sm:items-center sm:p-6"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeEditor();
    }}
  >
    <div
      class="sheet-enter app-scroll flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:rounded-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="medicine-editor-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
        <div>
          <h2 id="medicine-editor-title" class="text-xl font-semibold tracking-tight text-slate-900">
            {draft.id ? m.edit_medicine() : m.add_medicine()}
          </h2>
          <p class="mt-1 text-sm text-slate-500">{m.medicine_editor_hint()}</p>
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

      <form
        method="POST"
        action={draft.id ? '?/updateMedicine' : '?/createMedicine'}
        use:enhance={submitMedicine}
        class="app-scroll flex-1 overflow-y-auto"
      >
        <input type="hidden" name="patientId" value={patientId} />
        {#if draft.id}
          <input type="hidden" name="id" value={draft.id} />
          <input type="hidden" name="revision" value={draft.revision} />
        {/if}

        <div class="space-y-7 px-5 py-5 sm:px-6 sm:py-6">
          <fieldset>
            <legend class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {m.medicine_details()}
            </legend>
            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              <label class="sm:col-span-2">
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_name()}</span>
                <input
                  name="name"
                  type="text"
                  bind:value={draft.name}
                  required
                  maxlength="200"
                  autocomplete="off"
                  placeholder={m.medicine_name_placeholder()}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>

              <label class="sm:col-span-2">
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_generic_name()}</span>
                <input
                  name="genericName"
                  type="text"
                  bind:value={draft.genericName}
                  maxlength="200"
                  autocomplete="off"
                  placeholder={m.medicine_generic_name_placeholder()}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>

              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_strength()}</span>
                <input
                  name="strength"
                  type="text"
                  bind:value={draft.strength}
                  maxlength="120"
                  placeholder={m.medicine_strength_placeholder()}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>

              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_form()}</span>
                <input
                  name="form"
                  type="text"
                  bind:value={draft.form}
                  maxlength="120"
                  placeholder={m.medicine_form_placeholder()}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>

              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_route()}</span>
                <input
                  name="route"
                  type="text"
                  bind:value={draft.route}
                  maxlength="120"
                  placeholder={m.medicine_route_placeholder()}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>

              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_prescriber()}</span>
                <input
                  name="prescriber"
                  type="text"
                  bind:value={draft.prescriber}
                  maxlength="200"
                  placeholder={m.medicine_prescriber_placeholder()}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>
            </div>
          </fieldset>

          <fieldset class="border-t border-slate-100 pt-6">
            <legend class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              {m.medicine_plan()}
            </legend>
            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_status()}</span>
                <select
                  name="status"
                  bind:value={draft.status}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="active">{m.medicine_status_active()}</option>
                  <option value="planned">{m.medicine_status_planned()}</option>
                  <option value="paused">{m.medicine_status_paused()}</option>
                  <option value="completed">{m.medicine_status_completed()}</option>
                  <option value="stopped">{m.medicine_status_stopped()}</option>
                </select>
              </label>

              <div class="hidden sm:block"></div>

              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_start_date()}</span>
                <input
                  name="startDate"
                  type="date"
                  bind:value={draft.startDate}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>

              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_end_date()}</span>
                <input
                  name="endDate"
                  type="date"
                  bind:value={draft.endDate}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>

              <label class="sm:col-span-2">
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_schedule()}</span>
                <textarea
                  name="schedule"
                  bind:value={draft.schedule}
                  rows="3"
                  maxlength="1000"
                  placeholder={m.medicine_schedule_placeholder()}
                  class="w-full resize-y rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                ></textarea>
              </label>

              <label class="sm:col-span-2">
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_purpose()}</span>
                <input
                  name="purpose"
                  type="text"
                  bind:value={draft.purpose}
                  maxlength="500"
                  placeholder={m.medicine_purpose_placeholder()}
                  class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </label>

              <label class="sm:col-span-2">
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.notes()}</span>
                <textarea
                  name="notes"
                  bind:value={draft.notes}
                  rows="3"
                  maxlength="4000"
                  placeholder={m.medicine_notes_placeholder()}
                  class="w-full resize-y rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                ></textarea>
              </label>
            </div>
          </fieldset>

          {#if saveError}
            <p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {saveError}
            </p>
          {/if}
        </div>

        <footer class="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-6" style="padding-bottom: calc(1rem + var(--safe-bottom))">
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
            {saving ? m.saving() : draft.id ? m.update_medicine() : m.save_medicine()}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}
