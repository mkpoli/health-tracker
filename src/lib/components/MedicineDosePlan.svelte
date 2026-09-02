<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import {
    activeCourseOf,
    currentRegimenOf,
    doseAnchorKinds,
    doseAnchorMeals,
    type AdherenceCounts,
    type CourseStatus,
    type DoseAnchorKind,
    type DoseAnchorMeal,
    type DoseRegimenRecord,
    type MedicineCourseRecord,
    type RegimenRuleKind,
  } from '$lib/medicine-plan';
  import { anchorKindLabel, anchorMealLabel, regimenSummary, weekdayLabels } from '$lib/regimen-format';
  import { toDateTimeLocal } from '$lib/time-zone';

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

  type SlotDraft = {
    key: number | null;
    label: string;
    anchorKind: DoseAnchorKind | '';
    anchorMeal: DoseAnchorMeal;
    anchorOffsetMinutes: string;
    time: string;
    amountValue: string;
    amountUnit: string;
  };

  let saving = $state(false);
  let saveError = $state('');
  let courseEditorOpen = $state(false);
  let regimenEditorOpen = $state(false);
  let courseDraft = $state(emptyCourseDraft());
  let regimenDraft = $state(emptyRegimenDraft());

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

  function emptyRegimenDraft() {
    return {
      id: '',
      revision: 0,
      courseId: '',
      ruleKind: 'fixed_slots' as RegimenRuleKind,
      slots: [emptySlot()] as SlotDraft[],
      daysOfWeek: [] as number[],
      intervalHours: '',
      anchorAt: '',
      doseText: '',
      route: '',
      site: '',
      timezone: patientTimeZone,
      effectiveFrom: '',
      effectiveTo: '',
      remindMinutesBefore: '',
      notes: '',
    };
  }

  function emptySlot(): SlotDraft {
    return {
      key: null,
      label: '',
      anchorKind: '',
      anchorMeal: 'breakfast',
      anchorOffsetMinutes: '',
      time: '',
      amountValue: '',
      amountUnit: '',
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
      ...emptyRegimenDraft(),
      courseId: course.id,
      effectiveFrom: today >= course.startDate ? today : course.startDate,
    };
    saveError = '';
    regimenEditorOpen = true;
  }

  function openRegimenEdit(regimen: DoseRegimenRecord) {
    regimenDraft = {
      id: regimen.id,
      revision: regimen.revision,
      courseId: regimen.courseId,
      ruleKind: regimen.ruleKind,
      slots:
        regimen.slots.length > 0
          ? regimen.slots.map((slot) => ({
              key: slot.key,
              label: slot.label || '',
              anchorKind: slot.anchorKind || '',
              anchorMeal: slot.anchorMeal || 'breakfast',
              anchorOffsetMinutes:
                slot.anchorOffsetMinutes === null ? '' : String(slot.anchorOffsetMinutes),
              time: slot.time || '',
              amountValue: slot.amountValue === null ? '' : String(slot.amountValue),
              amountUnit: slot.amountUnit || '',
            }))
          : [emptySlot()],
      daysOfWeek: regimen.daysOfWeek ? [...regimen.daysOfWeek] : [],
      intervalHours: regimen.intervalHours === null ? '' : String(regimen.intervalHours),
      anchorAt: regimen.anchorAt ? toDateTimeLocal(regimen.anchorAt, regimen.timezone) : '',
      doseText: regimen.doseText || '',
      route: regimen.route || '',
      site: regimen.site || '',
      timezone: regimen.timezone,
      effectiveFrom: regimen.effectiveFrom,
      effectiveTo: regimen.effectiveTo || '',
      remindMinutesBefore:
        regimen.remindMinutesBefore === null ? '' : String(regimen.remindMinutesBefore),
      notes: regimen.notes || '',
    };
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

  const slotsJson = $derived(
    JSON.stringify(
      regimenDraft.slots
        .filter(
          (slot) =>
            slot.label || slot.time || slot.anchorKind || slot.amountValue || slot.amountUnit,
        )
        .map((slot) => ({
          key: slot.key,
          label: slot.label || null,
          anchorKind: slot.anchorKind || null,
          anchorMeal: slot.anchorKind === 'meal' ? slot.anchorMeal : null,
          anchorOffsetMinutes:
            slot.anchorKind && slot.anchorKind !== 'clock' && slot.anchorOffsetMinutes !== ''
              ? Number(slot.anchorOffsetMinutes)
              : null,
          time: slot.anchorKind === 'clock' || (!slot.anchorKind && slot.time) ? slot.time || null : null,
          amountValue: slot.amountValue === '' ? null : Number(slot.amountValue),
          amountUnit: slot.amountUnit || null,
        })),
    ),
  );

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

  const weekdays = $derived(weekdayLabels());

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
        <input type="hidden" name="slots" value={slotsJson} />
        <input type="hidden" name="timezone" value={regimenDraft.timezone} />

        <div class="space-y-5 px-5 py-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_rule()}</span>
              <select name="ruleKind" bind:value={regimenDraft.ruleKind} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500">
                <option value="fixed_slots">{m.regimen_rule_fixed()}</option>
                <option value="interval">{m.regimen_rule_interval()}</option>
                <option value="as_needed">{m.regimen_rule_as_needed()}</option>
              </select>
            </label>

            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_dose_text()}</span>
              <input name="doseText" type="text" bind:value={regimenDraft.doseText} maxlength="200" placeholder={m.regimen_dose_text_placeholder()} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
            </label>
          </div>

          {#if regimenDraft.ruleKind === 'fixed_slots'}
            <fieldset>
              <legend class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{m.regimen_slots()}</legend>
              <div class="mt-3 space-y-3">
                {#each regimenDraft.slots as slot, index (index)}
                  <div class="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-6">
                    <label class="sm:col-span-2">
                      <span class="mb-1 block text-xs font-medium text-slate-500">{m.regimen_slot_label()}</span>
                      <input type="text" bind:value={slot.label} maxlength="120" placeholder={m.regimen_slot_label_placeholder()} class="w-full rounded-md border-slate-300 px-2.5 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                    </label>
                    <label>
                      <span class="mb-1 block text-xs font-medium text-slate-500">{m.regimen_anchor()}</span>
                      <select bind:value={slot.anchorKind} class="w-full rounded-md border-slate-300 px-2.5 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500">
                        <option value="">{m.regimen_anchor_none()}</option>
                        {#each doseAnchorKinds as kind}
                          <option value={kind}>{anchorKindLabel(kind)}</option>
                        {/each}
                      </select>
                    </label>
                    {#if slot.anchorKind === 'clock' || (!slot.anchorKind && slot.time)}
                      <label>
                        <span class="mb-1 block text-xs font-medium text-slate-500">{m.regimen_slot_time()}</span>
                        <input type="time" bind:value={slot.time} class="w-full rounded-md border-slate-300 px-2.5 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                      </label>
                    {:else if slot.anchorKind === 'meal'}
                      <label>
                        <span class="mb-1 block text-xs font-medium text-slate-500">{m.anchor_meal()}</span>
                        <select bind:value={slot.anchorMeal} class="w-full rounded-md border-slate-300 px-2.5 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500">
                          {#each doseAnchorMeals as meal}
                            <option value={meal}>{anchorMealLabel(meal)}</option>
                          {/each}
                        </select>
                      </label>
                    {:else if slot.anchorKind}
                      <label>
                        <span class="mb-1 block text-xs font-medium text-slate-500">{m.regimen_anchor_offset()}</span>
                        <input type="number" bind:value={slot.anchorOffsetMinutes} min="-1440" max="1440" step="5" class="w-full rounded-md border-slate-300 px-2.5 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                      </label>
                    {:else}
                      <div class="hidden sm:block"></div>
                    {/if}
                    <label>
                      <span class="mb-1 block text-xs font-medium text-slate-500">{m.regimen_slot_amount()}</span>
                      <input type="number" bind:value={slot.amountValue} min="0" step="any" class="w-full rounded-md border-slate-300 px-2.5 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                    </label>
                    <div class="flex items-end gap-2">
                      <label class="flex-1">
                        <span class="mb-1 block text-xs font-medium text-slate-500">{m.regimen_slot_unit()}</span>
                        <input type="text" bind:value={slot.amountUnit} maxlength="40" placeholder={m.regimen_slot_unit_placeholder()} class="w-full rounded-md border-slate-300 px-2.5 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                      </label>
                      {#if regimenDraft.slots.length > 1}
                        <button
                          type="button"
                          onclick={() => {
                            regimenDraft.slots = regimenDraft.slots.filter((_, i) => i !== index);
                          }}
                          class="rounded-md border border-slate-200 px-2 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                          aria-label={m.regimen_slot_remove()}
                        >
                          ×
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
              <button
                type="button"
                onclick={() => {
                  regimenDraft.slots = [...regimenDraft.slots, emptySlot()];
                }}
                class="mt-2 text-xs font-semibold text-blue-700 hover:text-blue-800"
              >
                {m.regimen_slot_add()}
              </button>
            </fieldset>

            <fieldset>
              <legend class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{m.regimen_days()}</legend>
              <p class="mt-1 text-xs text-slate-500">{m.regimen_days_hint()}</p>
              <div class="mt-2 flex flex-wrap gap-2">
                {#each weekdays as label, day}
                  <label class={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${regimenDraft.daysOfWeek.includes(day) ? 'border-blue-300 bg-blue-100 text-blue-800' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200'}`}>
                    <input
                      type="checkbox"
                      name="daysOfWeek"
                      value={day}
                      checked={regimenDraft.daysOfWeek.includes(day)}
                      onchange={(event) => {
                        const checked = (event.currentTarget as HTMLInputElement).checked;
                        regimenDraft.daysOfWeek = checked
                          ? [...regimenDraft.daysOfWeek, day]
                          : regimenDraft.daysOfWeek.filter((value) => value !== day);
                      }}
                      class="sr-only"
                    />
                    {label}
                  </label>
                {/each}
              </div>
            </fieldset>
          {:else if regimenDraft.ruleKind === 'interval'}
            <div class="grid gap-4 sm:grid-cols-2">
              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_interval_hours()}</span>
                <input name="intervalHours" type="number" bind:value={regimenDraft.intervalHours} min="1" max="1080" step="any" required class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
              </label>
              <label>
                <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_anchor_time()}</span>
                <input name="anchorAt" type="datetime-local" bind:value={regimenDraft.anchorAt} required class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
              </label>
            </div>
          {/if}

          <div class="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_effective_from()}</span>
              <input name="effectiveFrom" type="date" bind:value={regimenDraft.effectiveFrom} required class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
            </label>
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_effective_to()}</span>
              <input name="effectiveTo" type="date" bind:value={regimenDraft.effectiveTo} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
            </label>
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_route()}</span>
              <input name="route" type="text" bind:value={regimenDraft.route} maxlength="120" class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
            </label>
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_site()}</span>
              <input name="site" type="text" bind:value={regimenDraft.site} maxlength="120" placeholder={m.regimen_site_placeholder()} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
            </label>
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_remind_before()}</span>
              <input name="remindMinutesBefore" type="number" bind:value={regimenDraft.remindMinutesBefore} min="0" max="1440" step="5" class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
            </label>
            <label>
              <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.notes()}</span>
              <input name="notes" type="text" bind:value={regimenDraft.notes} maxlength="4000" class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
            </label>
          </div>

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
