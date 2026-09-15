<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import {
    activeCourseOf,
    currentRegimenOf,
    type AdherenceCounts,
    type CourseStatus,
    type DoseRegimenRecord,
    type MedicineCourseRecord,
  } from '$lib/medicine-plan';
  import { emptyRegimenDraft, regimenDraftOf } from '$lib/regimen-draft';
  import { regimenSummary } from '$lib/regimen-format';
  import RegimenFields from './RegimenFields.svelte';

  let {
    medicineClaimId,
    courses = [],
    regimens = [],
    adherence = null,
    patientTimeZone,
    today,
  }: {
    medicineClaimId: string;
    courses: MedicineCourseRecord[];
    regimens: DoseRegimenRecord[];
    adherence: AdherenceCounts | null;
    patientTimeZone: string;
    today: string;
  } = $props();

  let saving = $state(false);
  let saveError = $state('');
  let courseEditorOpen = $state(false);
  let regimenEditorOpen = $state(false);
  let courseDraft = $state(emptyCourseDraft());
  let regimenDraft = $state(emptyRegimenDraft('UTC'));

  const sortedCourses = $derived(
    [...courses].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
  );
  const activeCourse = $derived(activeCourseOf(courses));
  const activeRegimen = $derived(
    activeCourse ? currentRegimenOf(activeCourse, regimens, today) : null,
  );

  function emptyCourseDraft() {
    return {
      id: '',
      revision: 0,
      kind: 'initial' as 'initial' | 'restart',
      status: 'active' as CourseStatus,
      previousCourseId: '',
      startDate: '',
      endDate: '',
      endReason: '',
      notes: '',
    };
  }

  function openCourseCreate() {
    courseDraft = {
      ...emptyCourseDraft(),
      kind: sortedCourses.length > 0 ? 'restart' : 'initial',
      previousCourseId:
        sortedCourses.find((course) => course.status === 'ended')?.id || '',
      startDate: today,
    };
    saveError = '';
    courseEditorOpen = true;
  }

  function openCourseEdit(course: MedicineCourseRecord) {
    courseDraft = {
      id: course.id,
      revision: course.revision,
      kind: course.kind,
      status: course.status,
      previousCourseId: course.previousCourseId || '',
      startDate: course.startDate,
      endDate: course.endDate || '',
      endReason: course.endReason || '',
      notes: course.notes || '',
    };
    saveError = '';
    courseEditorOpen = true;
  }

  function openRegimenCreate(course: MedicineCourseRecord) {
    regimenDraft = {
      ...emptyRegimenDraft(patientTimeZone),
      courseId: course.id,
      effectiveFrom: today >= course.startDate ? today : course.startDate,
    };
    saveError = '';
    regimenEditorOpen = true;
  }

  function openRegimenEdit(regimen: DoseRegimenRecord) {
    regimenDraft = regimenDraftOf(regimen);
    saveError = '';
    regimenEditorOpen = true;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && (courseEditorOpen || regimenEditorOpen)) closeEditors();
  }

  function closeEditors() {
    if (saving) return;
    courseEditorOpen = false;
    regimenEditorOpen = false;
    saveError = '';
  }

  const submitPlan: SubmitFunction = () => {
    saving = true;
    saveError = '';

    return async ({ result, update }) => {
      if (result.type === 'success') {
        await update({ reset: true, invalidateAll: true });
        saving = false;
        courseEditorOpen = false;
        regimenEditorOpen = false;
        return;
      }

      if (result.type === 'failure' && result.status === 409) {
        await invalidateAll();
        saveError = m.claim_revision_stale();
      } else {
        saveError = m.plan_save_failed();
      }
      saving = false;
    };
  };

  function courseKindLabel(kind: 'initial' | 'restart') {
    return kind === 'restart' ? m.course_kind_restart() : m.course_kind_initial();
  }

  function courseStatusLabel(status: CourseStatus) {
    if (status === 'planned') return m.course_status_planned();
    if (status === 'active') return m.course_status_active();
    if (status === 'held') return m.course_status_held();
    return m.course_status_ended();
  }

  function courseStatusTone(status: CourseStatus) {
    if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (status === 'planned') return 'border-blue-200 bg-blue-50 text-blue-700';
    if (status === 'held') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-slate-200 bg-slate-50 text-slate-600';
  }

  function formatDateOnly(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(date);
  }

  function coursePeriod(course: MedicineCourseRecord) {
    return course.endDate
      ? m.medicine_period_between({
          startDate: formatDateOnly(course.startDate),
          endDate: formatDateOnly(course.endDate),
        })
      : m.medicine_period_from({ date: formatDateOnly(course.startDate) });
  }


  function adherenceLine(counts: AdherenceCounts) {
    return m.adherence_summary({
      taken: counts.taken + counts.partial,
      due: counts.due,
      unrecorded: counts.unrecorded,
    });
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
  <div class="flex items-center justify-between gap-2">
    <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
      {m.dose_plan_title()}
    </p>
    <button
      type="button"
      onclick={openCourseCreate}
      class="text-xs font-semibold text-blue-700 transition-colors hover:text-blue-800"
    >
      {sortedCourses.length > 0 ? m.course_add_restart() : m.course_start()}
    </button>
  </div>

  {#if sortedCourses.length === 0}
    <p class="mt-2 text-sm text-slate-500">{m.dose_plan_empty()}</p>
  {:else}
    <ul class="mt-2 space-y-2">
      {#each sortedCourses as course (course.id)}
        <li class="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class={`rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${courseStatusTone(course.status)}`}>
                {courseStatusLabel(course.status)}
              </span>
              <span class="font-medium text-slate-700">{courseKindLabel(course.kind)}</span>
              <span class="text-slate-500">{coursePeriod(course)}</span>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onclick={() => openRegimenCreate(course)}
                class="text-xs font-semibold text-blue-700 hover:text-blue-800"
              >
                {m.regimen_change()}
              </button>
              <button
                type="button"
                onclick={() => openCourseEdit(course)}
                class="text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                {m.edit()}
              </button>
            </div>
          </div>

          {#if course.endReason}
            <p class="mt-1 text-xs text-slate-500">{m.course_end_reason()}: {course.endReason}</p>
          {/if}

          {#each regimens.filter((regimen) => regimen.courseId === course.id) as regimen (regimen.id)}
            <div class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-100 bg-blue-50/60 px-2.5 py-2">
              <div class="min-w-0 text-xs text-blue-900">
                <p class="font-semibold">{regimenSummary(regimen)}</p>
                <p class="mt-0.5 text-blue-700/80">
                  {regimen.effectiveTo
                    ? m.medicine_period_between({
                        startDate: formatDateOnly(regimen.effectiveFrom),
                        endDate: formatDateOnly(regimen.effectiveTo),
                      })
                    : m.medicine_period_from({ date: formatDateOnly(regimen.effectiveFrom) })}
                  {#if regimen.route}
                    · {regimen.route}{regimen.site ? ` (${regimen.site})` : ''}
                  {/if}
                </p>
              </div>
              <button
                type="button"
                onclick={() => openRegimenEdit(regimen)}
                class="text-xs font-semibold text-blue-700 hover:text-blue-800"
              >
                {m.edit()}
              </button>
            </div>
          {/each}
        </li>
      {/each}
    </ul>

    {#if adherence && adherence.due > 0}
      <p class="mt-3 text-xs text-slate-600">
        {adherenceLine(adherence)}
      </p>
    {/if}

    {#if activeCourse && (!activeRegimen || activeRegimen.ruleKind === 'as_needed')}
      <form method="POST" action="?/recordDose" use:enhance={submitPlan} class="mt-3">
        <input type="hidden" name="courseId" value={activeCourse.id} />
        <input type="hidden" name="timezone" value={activeRegimen?.timezone || patientTimeZone} />
        <input type="hidden" name="status" value="taken" />
        <button
          type="submit"
          disabled={saving}
          class="text-xs font-semibold text-emerald-700 transition-colors hover:text-emerald-800 disabled:opacity-50"
        >
          {m.dose_record_now()}
        </button>
      </form>
    {/if}
  {/if}

  {#if saveError && !courseEditorOpen && !regimenEditorOpen}
    <p class="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
      {saveError}
    </p>
  {/if}
</div>

{#if courseEditorOpen}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/55 backdrop-blur-sm sm:items-center sm:p-6"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeEditors();
    }}
  >
    <div
      class="sheet-enter app-scroll flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:rounded-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-editor-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <h2 id="course-editor-title" class="text-lg font-semibold tracking-tight text-slate-900">
          {courseDraft.id ? m.course_edit() : m.course_start()}
        </h2>
        <button type="button" onclick={closeEditors} disabled={saving} class="rounded-full p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-40" aria-label={m.close()}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <form
        method="POST"
        action={courseDraft.id ? '?/updateMedicineCourse' : '?/createMedicineCourse'}
        use:enhance={submitPlan}
        class="app-scroll flex-1 overflow-y-auto"
      >
        <input type="hidden" name="medicineClaimId" value={medicineClaimId} />
        {#if courseDraft.id}
          <input type="hidden" name="id" value={courseDraft.id} />
          <input type="hidden" name="revision" value={courseDraft.revision} />
        {/if}

        <div class="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.course_kind()}</span>
            <select name="kind" bind:value={courseDraft.kind} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500">
              <option value="initial">{m.course_kind_initial()}</option>
              <option value="restart">{m.course_kind_restart()}</option>
            </select>
          </label>

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_status()}</span>
            <select name="status" bind:value={courseDraft.status} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500">
              <option value="planned">{m.course_status_planned()}</option>
              <option value="active">{m.course_status_active()}</option>
              <option value="held">{m.course_status_held()}</option>
              <option value="ended">{m.course_status_ended()}</option>
            </select>
          </label>

          {#if courseDraft.kind === 'restart'}
            <label class="sm:col-span-2">
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.course_previous()}</span>
              <select name="previousCourseId" bind:value={courseDraft.previousCourseId} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500">
                <option value="">{m.course_previous_none()}</option>
                {#each sortedCourses.filter((course) => course.id !== courseDraft.id) as course (course.id)}
                  <option value={course.id}>{coursePeriod(course)} · {courseStatusLabel(course.status)}</option>
                {/each}
              </select>
            </label>
          {/if}

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_start_date()}</span>
            <input name="startDate" type="date" bind:value={courseDraft.startDate} required class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
          </label>

          <label>
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_end_date()}</span>
            <input name="endDate" type="date" bind:value={courseDraft.endDate} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
          </label>

          <label class="sm:col-span-2">
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.course_end_reason()}</span>
            <input name="endReason" type="text" bind:value={courseDraft.endReason} maxlength="500" placeholder={m.course_end_reason_placeholder()} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
          </label>

          <label class="sm:col-span-2">
            <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.notes()}</span>
            <textarea name="notes" bind:value={courseDraft.notes} rows="2" maxlength="4000" class="w-full resize-y rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"></textarea>
          </label>

          {#if saveError}
            <p class="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{saveError}</p>
          {/if}
        </div>

        <footer class="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur" style="padding-bottom: calc(1rem + var(--safe-bottom))">
          <button type="button" onclick={closeEditors} disabled={saving} class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{m.cancel()}</button>
          <button type="submit" disabled={saving} class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:bg-blue-400">
            {saving ? m.saving() : m.save()}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}

{#if regimenEditorOpen}
  <div
    class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/55 backdrop-blur-sm sm:items-center sm:p-6"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeEditors();
    }}
  >
    <div
      class="sheet-enter app-scroll flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 sm:rounded-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="regimen-editor-title"
    >
      <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div>
          <h2 id="regimen-editor-title" class="text-lg font-semibold tracking-tight text-slate-900">
            {regimenDraft.id ? m.regimen_edit() : m.regimen_change()}
          </h2>
          <p class="mt-1 text-sm text-slate-500">{m.regimen_editor_hint()}</p>
        </div>
        <button type="button" onclick={closeEditors} disabled={saving} class="rounded-full p-2 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-40" aria-label={m.close()}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <form
        method="POST"
        action={regimenDraft.id ? '?/updateDoseRegimen' : '?/createDoseRegimen'}
        use:enhance={submitPlan}
        class="app-scroll flex-1 overflow-y-auto"
      >
        <input type="hidden" name="courseId" value={regimenDraft.courseId} />
        {#if regimenDraft.id}
          <input type="hidden" name="id" value={regimenDraft.id} />
          <input type="hidden" name="revision" value={regimenDraft.revision} />
        {/if}
        <div class="space-y-5 px-5 py-5">
          <RegimenFields bind:draft={regimenDraft} />

          {#if saveError}
            <p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{saveError}</p>
          {/if}
        </div>

        <footer class="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur" style="padding-bottom: calc(1rem + var(--safe-bottom))">
          <button type="button" onclick={closeEditors} disabled={saving} class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{m.cancel()}</button>
          <button type="submit" disabled={saving} class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:bg-blue-400">
            {saving ? m.saving() : m.save()}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}
