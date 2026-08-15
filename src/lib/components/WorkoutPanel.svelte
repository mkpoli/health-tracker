<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import { changedClaimFields, type WorkoutClaimRevisionRecord } from '$lib/claim-revision';
  import {
    normalizeTimeZone,
    resolveZonedDateTime,
    toDateTimeLocal,
    utcOffsetMinutesAt,
  } from '$lib/time-zone';
  import type {
    ExerciseDefinitionRecord,
    WorkoutKind,
    WorkoutPlanStatus,
    WorkoutRecord,
    WorkoutSessionStatus,
    WorkoutSetRecord,
    WorkoutSetStatus,
    WorkoutSetType,
    WorkoutStatus,
  } from '$lib/workout';
  import ClaimRevisionTimeline from './ClaimRevisionTimeline.svelte';

  let {
    patientId,
    patientTimeZone,
    workouts = [],
    exerciseDefinitions = [],
    revisions = [],
  }: {
    patientId: string;
    patientTimeZone: string;
    workouts: WorkoutRecord[];
    exerciseDefinitions: ExerciseDefinitionRecord[];
    revisions: WorkoutClaimRevisionRecord[];
  } = $props();

  type SetDraft = {
    key: string;
    id: string;
    setType: WorkoutSetType;
    status: WorkoutSetStatus;
    weightValue: string;
    weightUnit: string;
    repetitions: string;
    durationSeconds: string;
    distanceValue: string;
    distanceUnit: string;
    rpe: string;
    rir: string;
    notes: string;
  };

  type ExerciseDraft = {
    key: string;
    id: string;
    exerciseDefinitionId: string;
    name: string;
    category: string;
    equipment: string;
    notes: string;
    restSeconds: string;
    supersetGroup: string;
    sets: SetDraft[];
  };

  type WorkoutDraft = {
    id: string;
    revision: number;
    kind: WorkoutKind;
    title: string;
    status: WorkoutStatus;
    basedOnWorkoutId: string;
    startedLocal: string;
    endedLocal: string;
    timezone: string;
    timezoneOffsetMinutes: string;
    endedTimezoneOffsetMinutes: string;
    notes: string;
    exercises: ExerciseDraft[];
  };

  let editorOpen = $state(false);
  let saving = $state(false);
  let saveError = $state('');
  let deleteError = $state('');
  let draft = $state<WorkoutDraft>(newDraft('session'));

  const plans = $derived(workouts.filter((workout) => workout.kind === 'plan'));
  const sessions = $derived(workouts.filter((workout) => workout.kind === 'session'));
  const plansById = $derived(new Map(plans.map((plan) => [plan.id, plan])));
  const revisionsByWorkout = $derived.by(() => {
    const grouped = new Map<string, WorkoutClaimRevisionRecord[]>();
    for (const revision of revisions) {
      const values = grouped.get(revision.claimId) || [];
      values.push(revision);
      grouped.set(revision.claimId, values);
    }
    for (const values of grouped.values()) values.sort((left, right) => right.revision - left.revision);
    return grouped;
  });

  function key() {
    return crypto.randomUUID();
  }

  function emptySet(kind: WorkoutKind): SetDraft {
    return {
      key: key(),
      id: '',
      setType: 'normal',
      status: kind === 'plan' ? 'planned' : 'completed',
      weightValue: '',
      weightUnit: '',
      repetitions: '',
      durationSeconds: '',
      distanceValue: '',
      distanceUnit: '',
      rpe: '',
      rir: '',
      notes: '',
    };
  }

  function emptyExercise(kind: WorkoutKind): ExerciseDraft {
    return {
      key: key(),
      id: '',
      exerciseDefinitionId: '',
      name: '',
      category: '',
      equipment: '',
      notes: '',
      restSeconds: '',
      supersetGroup: '',
      sets: [emptySet(kind)],
    };
  }

  function nowLocal(timeZone: string) {
    return toDateTimeLocal(new Date().toISOString(), timeZone);
  }

  function newDraft(kind: WorkoutKind): WorkoutDraft {
    const timezone = normalizeTimeZone(patientTimeZone);
    return {
      id: '',
      revision: 0,
      kind,
      title: '',
      status: kind === 'plan' ? 'active' : 'completed',
      basedOnWorkoutId: '',
      startedLocal: kind === 'session' ? nowLocal(timezone) : '',
      endedLocal: '',
      timezone,
      timezoneOffsetMinutes: '',
      endedTimezoneOffsetMinutes: '',
      notes: '',
      exercises: [emptyExercise(kind)],
    };
  }

  function setFromRecord(set: WorkoutSetRecord, kind: WorkoutKind, copy: boolean): SetDraft {
    return {
      key: key(),
      id: copy ? '' : set.id,
      setType: set.setType,
      status: copy && kind === 'session' ? 'planned' : set.status,
      weightValue: set.weightValue === null ? '' : String(set.weightValue),
      weightUnit: set.weightUnit || '',
      repetitions: set.repetitions === null ? '' : String(set.repetitions),
      durationSeconds: set.durationSeconds === null ? '' : String(set.durationSeconds),
      distanceValue: set.distanceValue === null ? '' : String(set.distanceValue),
      distanceUnit: set.distanceUnit || '',
      rpe: set.rpe === null ? '' : String(set.rpe),
      rir: set.rir === null ? '' : String(set.rir),
      notes: set.notes || '',
    };
  }

  function exercisesFromRecord(workout: WorkoutRecord, kind: WorkoutKind, copy: boolean) {
    return workout.exercises.map((exercise) => ({
      key: key(),
      id: copy ? '' : exercise.id,
      exerciseDefinitionId: exercise.exerciseDefinitionId || '',
      name: exercise.name,
      category: exercise.category || '',
      equipment: exercise.equipment || '',
      notes: exercise.notes || '',
      restSeconds: exercise.restSeconds === null ? '' : String(exercise.restSeconds),
      supersetGroup: exercise.supersetGroup || '',
      sets: exercise.sets.map((set) => setFromRecord(set, kind, copy)),
    }));
  }

  function openCreate(kind: WorkoutKind) {
    draft = newDraft(kind);
    saveError = '';
    editorOpen = true;
  }

  function openEdit(workout: WorkoutRecord) {
    const timezone = normalizeTimeZone(workout.timezone, patientTimeZone);
    draft = {
      id: workout.id,
      revision: workout.revision,
      kind: workout.kind,
      title: workout.title,
      status: workout.status,
      basedOnWorkoutId: workout.basedOnWorkoutId || '',
      startedLocal: workout.startedAt ? toDateTimeLocal(workout.startedAt, timezone) : '',
      endedLocal: workout.endedAt ? toDateTimeLocal(workout.endedAt, timezone) : '',
      timezone,
      timezoneOffsetMinutes:
        workout.timezoneOffsetMinutes === null ? '' : String(workout.timezoneOffsetMinutes),
      endedTimezoneOffsetMinutes:
        workout.endedTimezoneOffsetMinutes === null
          ? ''
          : String(workout.endedTimezoneOffsetMinutes),
      notes: workout.notes || '',
      exercises: exercisesFromRecord(workout, workout.kind, false),
    };
    saveError = '';
    editorOpen = true;
  }

  function openFromPlan(plan: WorkoutRecord) {
    const next = newDraft('session');
    next.title = plan.title;
    next.status = 'draft';
    next.basedOnWorkoutId = plan.id;
    next.notes = plan.notes || '';
    next.exercises = exercisesFromRecord(plan, 'session', true);
    draft = next;
    saveError = '';
    editorOpen = true;
  }

  function closeEditor() {
    if (saving) return;
    editorOpen = false;
    saveError = '';
  }

  function addExercise() {
    draft.exercises.push(emptyExercise(draft.kind));
  }

  function removeExercise(index: number) {
    draft.exercises.splice(index, 1);
  }

  function addSet(exercise: ExerciseDraft) {
    exercise.sets.push(emptySet(draft.kind));
  }

  function removeSet(exercise: ExerciseDraft, index: number) {
    exercise.sets.splice(index, 1);
  }

  function applyDefinition(exercise: ExerciseDraft) {
    const normalized = exercise.name.trim().toLocaleLowerCase();
    const definition = exerciseDefinitions.find(
      (candidate) => candidate.name.trim().toLocaleLowerCase() === normalized,
    );
    exercise.exerciseDefinitionId = definition?.id || '';
    if (!definition) return;
    if (!exercise.category) exercise.category = definition.category || '';
    if (!exercise.equipment) exercise.equipment = definition.equipment || '';
  }

  function syncOffsets() {
    if (draft.kind === 'plan') {
      draft.timezoneOffsetMinutes = '';
      draft.endedTimezoneOffsetMinutes = '';
      return;
    }

    const started = resolveZonedDateTime(draft.startedLocal, draft.timezone);
    const startOffset = started ? utcOffsetMinutesAt(started.instant, draft.timezone) : null;
    draft.timezoneOffsetMinutes = startOffset === null ? '' : String(startOffset);

    const ended = draft.endedLocal
      ? resolveZonedDateTime(draft.endedLocal, draft.timezone)
      : null;
    const endOffset = ended ? utcOffsetMinutesAt(ended.instant, draft.timezone) : null;
    draft.endedTimezoneOffsetMinutes = endOffset === null ? '' : String(endOffset);
  }

  function structureValue() {
    return draft.exercises.map((exercise) => ({
      id: exercise.id || null,
      exerciseDefinitionId: exercise.exerciseDefinitionId || null,
      name: exercise.name,
      category: exercise.category,
      equipment: exercise.equipment,
      notes: exercise.notes,
      restSeconds: exercise.restSeconds,
      supersetGroup: exercise.supersetGroup,
      sets: exercise.sets.map((set) => ({
        id: set.id || null,
        setType: set.setType,
        status: set.status,
        weightValue: set.weightValue,
        weightUnit: set.weightUnit,
        repetitions: set.repetitions,
        durationSeconds: set.durationSeconds,
        distanceValue: set.distanceValue,
        distanceUnit: set.distanceUnit,
        rpe: set.rpe,
        rir: set.rir,
        notes: set.notes,
      })),
    }));
  }

  const submitWorkout: SubmitFunction = ({ formData }) => {
    syncOffsets();
    formData.set('timezoneOffsetMinutes', draft.timezoneOffsetMinutes);
    formData.set('endedTimezoneOffsetMinutes', draft.endedTimezoneOffsetMinutes);
    formData.set('structure', JSON.stringify(structureValue()));
    saving = true;
    saveError = '';

    return async ({ result, update }) => {
      if (result.type === 'success') {
        await update({ reset: true, invalidateAll: true });
        saving = false;
        editorOpen = false;
        return;
      }

      if (result.type === 'failure' && result.status === 409) {
        await invalidateAll();
        saveError = m.claim_revision_stale();
      } else {
        saveError = m.workouts_save_failed();
      }
      saving = false;
    };
  };

  const submitDelete: SubmitFunction = () => {
    deleteError = '';
    return async ({ result, update }) => {
      if (result.type === 'success') {
        await update({ reset: true, invalidateAll: true });
      } else {
        deleteError = m.workouts_delete_failed();
      }
    };
  };

  function statusLabel(status: WorkoutStatus) {
    if (status === 'completed') return m.workouts_status_completed();
    if (status === 'draft') return m.workouts_status_draft();
    if (status === 'excluded') return m.workouts_status_excluded();
    if (status === 'active') return m.workouts_status_active();
    return m.workouts_status_archived();
  }

  function statusTone(status: WorkoutStatus) {
    if (status === 'completed' || status === 'active') {
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    }
    if (status === 'draft') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-slate-200 bg-slate-50 text-slate-600';
  }

  function setTypeLabel(type: WorkoutSetType) {
    if (type === 'warmup') return m.workouts_set_type_warmup();
    if (type === 'drop') return m.workouts_set_type_drop();
    if (type === 'failure') return m.workouts_set_type_failure();
    if (type === 'superset') return m.workouts_set_type_superset();
    if (type === 'rest_pause') return m.workouts_set_type_rest_pause();
    if (type === 'other') return m.workouts_set_type_other();
    return m.workouts_set_type_normal();
  }

  function setStatusLabel(status: WorkoutSetStatus) {
    if (status === 'completed') return m.workouts_set_status_completed();
    if (status === 'planned') return m.workouts_set_status_planned();
    if (status === 'skipped') return m.workouts_set_status_skipped();
    if (status === 'failed') return m.workouts_set_status_failed();
    return m.workouts_set_status_unknown();
  }

  function workoutSummary(workout: WorkoutRecord) {
    return m.workouts_summary({
      exercises: workout.exercises.length,
      sets: workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0),
    });
  }

  function setSummary(set: WorkoutSetRecord) {
    const parts: string[] = [setTypeLabel(set.setType)];
    if (set.weightValue !== null) parts.push(`${set.weightValue} ${set.weightUnit || ''}`.trim());
    if (set.repetitions !== null) parts.push(`× ${set.repetitions}`);
    if (set.durationSeconds !== null) parts.push(`${set.durationSeconds} ${m.workouts_seconds()}`);
    if (set.distanceValue !== null) parts.push(`${set.distanceValue} ${set.distanceUnit || ''}`.trim());
    if (set.status !== 'completed') parts.push(setStatusLabel(set.status));
    return parts.join(' · ');
  }

  function formatWorkoutTime(workout: WorkoutRecord) {
    if (!workout.startedAt) return '';
    const timezone = normalizeTimeZone(workout.timezone, patientTimeZone);
    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(workout.startedAt));
  }

  function durationLabel(workout: WorkoutRecord) {
    if (!workout.startedAt || !workout.endedAt) return '';
    const minutes = Math.round((Date.parse(workout.endedAt) - Date.parse(workout.startedAt)) / 60_000);
    return minutes >= 0 ? m.workouts_duration_value({ minutes }) : '';
  }

  function revisionFieldLabel(field: string) {
    if (field === 'title') return m.workouts_title_label();
    if (field === 'status') return m.workouts_status();
    if (field === 'exercises') return m.workouts_revision_structure();
    if (field === 'startedAt' || field === 'endedAt' || field === 'localDate') {
      return m.workouts_revision_time();
    }
    if (field === 'timezone' || field.includes('TimezoneOffset')) return m.workouts_time_zone();
    if (field === 'basedOnWorkoutId') return m.workouts_revision_plan();
    if (field === 'notes') return m.notes();
    if (field === 'originKind' || field === 'originProvider') return m.claim_field_source();
    if (field === 'originExternalId') return m.claim_field_source_reference();
    return field;
  }

  function revisionItems(workout: WorkoutRecord) {
    const history = revisionsByWorkout.get(workout.id) || [];
    return history.map((revision, index) => {
      const snapshot = revision.snapshot;
      const previous = history[index + 1]?.snapshot || null;
      const secondary = [
        workoutSummary(snapshot),
        snapshot.kind === 'session' ? formatWorkoutTime(snapshot) : '',
      ].filter(Boolean).join(' · ');
      return {
        id: revision.id,
        revision: revision.revision,
        changedAt: revision.changedAt,
        current: revision.revision === workout.revision,
        changedFields: [...new Set(changedClaimFields(snapshot, previous).map(revisionFieldLabel))],
        primary: `${snapshot.title} · ${statusLabel(snapshot.status)}`,
        secondary,
      };
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && editorOpen) closeEditor();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  <header class="border-b border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-6">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div class="flex items-start gap-3">
        <div class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="h-5 w-5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h10.5M6.75 17.25h10.5M4.5 9v6m15-6v6M2.25 10.5v3m19.5-3v3" />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold tracking-tight text-slate-900">{m.workouts_title()}</h3>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">{m.workouts_subtitle()}</p>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:flex">
        <button type="button" onclick={() => openCreate('session')} class="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2">
          <span class="text-base leading-none">+</span>{m.workouts_record()}
        </button>
        <button type="button" onclick={() => openCreate('plan')} class="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 py-2.5 text-sm font-semibold text-violet-700 shadow-sm transition-colors hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2">
          <span class="text-base leading-none">+</span>{m.workouts_new_plan()}
        </button>
      </div>
    </div>
  </header>

  <div class="space-y-8 p-4 sm:p-6">
    <p class="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-xs leading-relaxed text-violet-800">
      {m.workouts_native_hint()}
    </p>

    {#if deleteError}
      <p class="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700" role="alert">{deleteError}</p>
    {/if}

    <section aria-labelledby="workout-plans-heading">
      <h4 id="workout-plans-heading" class="mb-3 text-sm font-semibold text-slate-800">{m.workouts_plans()}</h4>
      {#if plans.length === 0}
        <div class="rounded-xl border border-dashed border-slate-200 px-5 py-8 text-center">
          <p class="text-sm font-semibold text-slate-700">{m.workouts_empty_plans()}</p>
          <p class="mt-1 text-xs text-slate-500">{m.workouts_empty_plans_hint()}</p>
        </div>
      {:else}
        <div class="grid gap-4 lg:grid-cols-2">
          {#each plans as plan (plan.id)}
            <article class="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div class="p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <h5 class="truncate font-semibold text-slate-900">{plan.title}</h5>
                    <p class="mt-1 text-xs text-slate-500">{workoutSummary(plan)}</p>
                  </div>
                  <span class={`shrink-0 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold ${statusTone(plan.status)}`}>{statusLabel(plan.status)}</span>
                </div>
                <div class="mt-4 space-y-2">
                  {#each plan.exercises as exercise (exercise.id)}
                    <div class="rounded-lg bg-slate-50 px-3 py-2.5">
                      <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <span class="text-sm font-medium text-slate-800">{exercise.name}</span>
                        <span class="text-[0.7rem] text-slate-400">{[exercise.equipment, exercise.category].filter(Boolean).join(' · ')}</span>
                      </div>
                      <div class="mt-1.5 flex flex-wrap gap-1.5">
                        {#each exercise.sets as set (set.id)}
                          <span class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[0.7rem] text-slate-600">{setSummary(set)}</span>
                        {/each}
                        {#if exercise.sets.length === 0}<span class="text-xs text-slate-400">{m.workouts_no_sets()}</span>{/if}
                      </div>
                    </div>
                  {/each}
                </div>
                {#if plan.notes}<p class="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{plan.notes}</p>{/if}
                <div class="mt-4 flex flex-wrap gap-2">
                  <button type="button" onclick={() => openFromPlan(plan)} class="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700">{m.workouts_use_plan()}</button>
                  <button type="button" onclick={() => openEdit(plan)} class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{m.workouts_edit()}</button>
                  <form method="POST" action="?/deleteWorkout" use:enhance={submitDelete} onsubmit={(event) => { if (!confirm(m.workouts_delete_confirm({ name: plan.title }))) event.preventDefault(); }}>
                    <input type="hidden" name="id" value={plan.id} />
                    <button type="submit" class="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">{m.workouts_delete()}</button>
                  </form>
                </div>
              </div>
              <ClaimRevisionTimeline items={revisionItems(plan)} />
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section aria-labelledby="workout-sessions-heading">
      <h4 id="workout-sessions-heading" class="mb-3 text-sm font-semibold text-slate-800">{m.workouts_sessions()}</h4>
      {#if sessions.length === 0}
        <div class="rounded-xl border border-dashed border-slate-200 px-5 py-8 text-center">
          <p class="text-sm font-semibold text-slate-700">{m.workouts_empty_sessions()}</p>
          <p class="mt-1 text-xs text-slate-500">{m.workouts_empty_sessions_hint()}</p>
        </div>
      {:else}
        <div class="space-y-4">
          {#each sessions as session (session.id)}
            <article class="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div class="p-4 sm:p-5">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h5 class="font-semibold text-slate-900">{session.title}</h5>
                      <span class={`rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold ${statusTone(session.status)}`}>{statusLabel(session.status)}</span>
                    </div>
                    <p class="mt-1 text-xs text-slate-500">{[formatWorkoutTime(session), durationLabel(session), workoutSummary(session)].filter(Boolean).join(' · ')}</p>
                    {#if session.basedOnWorkoutId && plansById.get(session.basedOnWorkoutId)}
                      <p class="mt-1 text-xs text-violet-600">{m.workouts_based_on({ name: plansById.get(session.basedOnWorkoutId)?.title || '' })}</p>
                    {/if}
                  </div>
                  <div class="flex gap-2">
                    <button type="button" onclick={() => openEdit(session)} class="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{m.workouts_edit()}</button>
                    <form method="POST" action="?/deleteWorkout" use:enhance={submitDelete} onsubmit={(event) => { if (!confirm(m.workouts_delete_confirm({ name: session.title }))) event.preventDefault(); }}>
                      <input type="hidden" name="id" value={session.id} />
                      <button type="submit" class="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50">{m.workouts_delete()}</button>
                    </form>
                  </div>
                </div>
                <div class="mt-4 grid gap-2 md:grid-cols-2">
                  {#each session.exercises as exercise (exercise.id)}
                    <div class="rounded-lg bg-slate-50 px-3 py-2.5">
                      <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <span class="text-sm font-medium text-slate-800">{exercise.name}</span>
                        <span class="text-[0.7rem] text-slate-400">{[exercise.equipment, exercise.category].filter(Boolean).join(' · ')}</span>
                      </div>
                      <div class="mt-1.5 flex flex-wrap gap-1.5">
                        {#each exercise.sets as set (set.id)}
                          <span class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[0.7rem] text-slate-600">{setSummary(set)}</span>
                        {/each}
                        {#if exercise.sets.length === 0}<span class="text-xs text-slate-400">{m.workouts_no_sets()}</span>{/if}
                      </div>
                    </div>
                  {/each}
                </div>
                {#if session.notes}<p class="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">{session.notes}</p>{/if}
              </div>
              <ClaimRevisionTimeline items={revisionItems(session)} />
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</section>

{#if editorOpen}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation">
    <div class="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="workout-editor-title">
      <header class="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
        <div>
          <h3 id="workout-editor-title" class="text-lg font-semibold text-slate-900">
            {draft.kind === 'plan'
              ? draft.id ? m.workouts_edit_plan() : m.workouts_create_plan()
              : draft.id ? m.workouts_edit_session() : m.workouts_create_session()}
          </h3>
          <p class="mt-0.5 text-xs text-slate-500">{m.workouts_editor_hint()}</p>
        </div>
        <button type="button" onclick={closeEditor} aria-label={m.cancel()} class="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </header>

      <form method="POST" action={draft.id ? '?/updateWorkout' : '?/createWorkout'} use:enhance={submitWorkout} class="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="patientId" value={patientId} />
        <input type="hidden" name="id" value={draft.id} />
        <input type="hidden" name="revision" value={draft.revision} />
        <input type="hidden" name="kind" value={draft.kind} />
        <input type="hidden" name="basedOnWorkoutId" value={draft.basedOnWorkoutId} />
        <input type="hidden" name="timezone" value={draft.timezone} />
        <input type="hidden" name="timezoneOffsetMinutes" value={draft.timezoneOffsetMinutes} />
        <input type="hidden" name="endedTimezoneOffsetMinutes" value={draft.endedTimezoneOffsetMinutes} />
        <input type="hidden" name="structure" value={JSON.stringify(structureValue())} />

        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
          <fieldset class="rounded-xl border border-slate-200 p-4">
            <legend class="px-2 text-sm font-semibold text-slate-800">{m.workouts_details()}</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="sm:col-span-2">
                <span class="mb-1.5 block text-xs font-semibold text-slate-700">{m.workouts_title_label()}</span>
                <input name="title" required maxlength="300" bind:value={draft.title} placeholder={m.workouts_title_placeholder()} class="w-full rounded-lg border-slate-300 text-sm focus:border-violet-500 focus:ring-violet-500" />
              </label>
              <label>
                <span class="mb-1.5 block text-xs font-semibold text-slate-700">{m.workouts_status()}</span>
                {#if draft.kind === 'session'}
                  <select name="status" bind:value={draft.status as WorkoutSessionStatus} class="w-full rounded-lg border-slate-300 text-sm focus:border-violet-500 focus:ring-violet-500">
                    <option value="completed">{m.workouts_status_completed()}</option>
                    <option value="draft">{m.workouts_status_draft()}</option>
                    <option value="excluded">{m.workouts_status_excluded()}</option>
                  </select>
                {:else}
                  <select name="status" bind:value={draft.status as WorkoutPlanStatus} class="w-full rounded-lg border-slate-300 text-sm focus:border-violet-500 focus:ring-violet-500">
                    <option value="active">{m.workouts_status_active()}</option>
                    <option value="archived">{m.workouts_status_archived()}</option>
                  </select>
                {/if}
              </label>
              {#if draft.kind === 'session'}
                <div class="text-xs text-slate-500">
                  <span class="mb-1.5 block font-semibold text-slate-700">{m.workouts_time_zone()}</span>
                  <span class="block rounded-lg bg-slate-50 px-3 py-2.5 font-mono">{draft.timezone}</span>
                </div>
                <label>
                  <span class="mb-1.5 block text-xs font-semibold text-slate-700">{m.workouts_started()}</span>
                  <input type="datetime-local" name="startedLocal" required bind:value={draft.startedLocal} onchange={syncOffsets} class="w-full rounded-lg border-slate-300 text-sm focus:border-violet-500 focus:ring-violet-500" />
                </label>
                <label>
                  <span class="mb-1.5 block text-xs font-semibold text-slate-700">{m.workouts_ended()}</span>
                  <input type="datetime-local" name="endedLocal" bind:value={draft.endedLocal} onchange={syncOffsets} class="w-full rounded-lg border-slate-300 text-sm focus:border-violet-500 focus:ring-violet-500" />
                </label>
              {/if}
              <label class="sm:col-span-2">
                <span class="mb-1.5 block text-xs font-semibold text-slate-700">{m.notes()}</span>
                <textarea name="notes" maxlength="4000" rows="3" bind:value={draft.notes} class="w-full rounded-lg border-slate-300 text-sm focus:border-violet-500 focus:ring-violet-500"></textarea>
              </label>
            </div>
          </fieldset>

          <section aria-labelledby="workout-exercises-editor-heading">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h4 id="workout-exercises-editor-heading" class="text-sm font-semibold text-slate-800">{m.workouts_exercises()}</h4>
              <button type="button" onclick={addExercise} class="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100">+ {m.workouts_add_exercise()}</button>
            </div>

            <datalist id="workout-exercise-definitions">
              {#each exerciseDefinitions as definition (definition.id)}<option value={definition.name}></option>{/each}
            </datalist>

            <div class="space-y-4">
              {#each draft.exercises as exercise, exerciseIndex (exercise.key)}
                <fieldset class="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                  <legend class="px-2 text-xs font-semibold text-slate-600">{m.workouts_exercise_number({ number: exerciseIndex + 1 })}</legend>
                  <div class="mb-4 flex justify-end">
                    <button type="button" onclick={() => removeExercise(exerciseIndex)} class="text-xs font-semibold text-rose-600 hover:text-rose-700">{m.workouts_remove_exercise()}</button>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label class="sm:col-span-2">
                      <span class="mb-1 block text-xs font-medium text-slate-600">{m.workouts_exercise_name()}</span>
                      <input required maxlength="300" list="workout-exercise-definitions" bind:value={exercise.name} oninput={() => applyDefinition(exercise)} placeholder={m.workouts_exercise_name_placeholder()} class="w-full rounded-lg border-slate-300 bg-white text-sm focus:border-violet-500 focus:ring-violet-500" />
                    </label>
                    <label>
                      <span class="mb-1 block text-xs font-medium text-slate-600">{m.workouts_category()}</span>
                      <input maxlength="120" bind:value={exercise.category} placeholder={m.workouts_category_placeholder()} class="w-full rounded-lg border-slate-300 bg-white text-sm focus:border-violet-500 focus:ring-violet-500" />
                    </label>
                    <label>
                      <span class="mb-1 block text-xs font-medium text-slate-600">{m.workouts_equipment()}</span>
                      <input maxlength="120" bind:value={exercise.equipment} placeholder={m.workouts_equipment_placeholder()} class="w-full rounded-lg border-slate-300 bg-white text-sm focus:border-violet-500 focus:ring-violet-500" />
                    </label>
                    <label>
                      <span class="mb-1 block text-xs font-medium text-slate-600">{m.workouts_rest_seconds()}</span>
                      <div class="flex items-center gap-2"><input type="number" min="0" max="86400" step="1" bind:value={exercise.restSeconds} class="min-w-0 flex-1 rounded-lg border-slate-300 bg-white text-sm focus:border-violet-500 focus:ring-violet-500" /><span class="text-xs text-slate-500">{m.workouts_seconds()}</span></div>
                    </label>
                    <label class="sm:col-span-2 lg:col-span-3">
                      <span class="mb-1 block text-xs font-medium text-slate-600">{m.workouts_exercise_notes()}</span>
                      <input maxlength="2000" bind:value={exercise.notes} class="w-full rounded-lg border-slate-300 bg-white text-sm focus:border-violet-500 focus:ring-violet-500" />
                    </label>
                  </div>

                  <div class="mt-5">
                    <div class="mb-2 flex items-center justify-between">
                      <h5 class="text-xs font-semibold uppercase tracking-wide text-slate-500">{m.workouts_sets()}</h5>
                      <button type="button" onclick={() => addSet(exercise)} class="text-xs font-semibold text-violet-700 hover:text-violet-800">+ {m.workouts_add_set()}</button>
                    </div>
                    <div class="space-y-2">
                      {#each exercise.sets as set, setIndex (set.key)}
                        <fieldset class="rounded-lg border border-slate-200 bg-white p-3">
                          <legend class="px-1 text-[0.7rem] font-semibold text-slate-500">{m.workouts_set_number({ number: setIndex + 1 })}</legend>
                          <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                            <label>
                              <span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_set_type()}</span>
                              <select bind:value={set.setType} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500">
                                <option value="normal">{m.workouts_set_type_normal()}</option><option value="warmup">{m.workouts_set_type_warmup()}</option><option value="drop">{m.workouts_set_type_drop()}</option><option value="failure">{m.workouts_set_type_failure()}</option><option value="superset">{m.workouts_set_type_superset()}</option><option value="rest_pause">{m.workouts_set_type_rest_pause()}</option><option value="other">{m.workouts_set_type_other()}</option>
                              </select>
                            </label>
                            <label>
                              <span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_set_status()}</span>
                              <select bind:value={set.status} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500">
                                <option value="completed">{m.workouts_set_status_completed()}</option><option value="planned">{m.workouts_set_status_planned()}</option><option value="skipped">{m.workouts_set_status_skipped()}</option><option value="failed">{m.workouts_set_status_failed()}</option><option value="unknown">{m.workouts_set_status_unknown()}</option>
                              </select>
                            </label>
                            <label><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_weight()}</span><input type="number" min="0" step="any" bind:value={set.weightValue} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                            <label><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_unit()}</span><input maxlength="32" placeholder="kg / lb" bind:value={set.weightUnit} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                            <label><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_repetitions()}</span><input type="number" min="0" step="1" bind:value={set.repetitions} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                            <label><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_duration_seconds()}</span><input type="number" min="0" step="1" bind:value={set.durationSeconds} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                            <label><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_distance()}</span><input type="number" min="0" step="any" bind:value={set.distanceValue} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                            <label><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_unit()}</span><input maxlength="32" placeholder="km / mi" bind:value={set.distanceUnit} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                            <label><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_rpe()}</span><input type="number" min="0" max="10" step="0.5" bind:value={set.rpe} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                            <label><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_rir()}</span><input type="number" min="0" max="10" step="0.5" bind:value={set.rir} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                            <label class="sm:col-span-2"><span class="mb-1 block text-[0.7rem] font-medium text-slate-500">{m.workouts_set_notes()}</span><input maxlength="1000" bind:value={set.notes} class="w-full rounded-md border-slate-300 py-1.5 text-xs focus:border-violet-500 focus:ring-violet-500" /></label>
                          </div>
                          <div class="mt-2 text-right"><button type="button" onclick={() => removeSet(exercise, setIndex)} class="text-[0.7rem] font-semibold text-rose-600 hover:text-rose-700">{m.workouts_remove_set()}</button></div>
                        </fieldset>
                      {/each}
                    </div>
                  </div>
                </fieldset>
              {/each}
            </div>
          </section>

          {#if saveError}<p class="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700" role="alert">{saveError}</p>{/if}
        </div>

        <footer class="flex justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-6">
          <button type="button" onclick={closeEditor} disabled={saving} class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{m.cancel()}</button>
          <button type="submit" disabled={saving} class="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50">
            {draft.kind === 'plan'
              ? draft.id ? m.workouts_update_plan() : m.workouts_save_plan()
              : draft.id ? m.workouts_update_session() : m.workouts_save_session()}
          </button>
        </footer>
      </form>
    </div>
  </div>
{/if}
