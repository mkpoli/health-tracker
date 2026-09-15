<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { doseAnchorKinds, doseAnchorMeals } from '$lib/medicine-plan';
  import { emptySlot, slotsJsonOf, type RegimenDraft } from '$lib/regimen-draft';
  import { anchorKindLabel, anchorMealLabel, weekdayLabels } from '$lib/regimen-format';

  /**
   * The fields of one dose rule, for any form that saves a regimen. `prefix`
   * keeps the input names apart from a medicine's own when both travel in
   * one submission.
   */
  let {
    draft = $bindable(),
    prefix = '',
  }: {
    draft: RegimenDraft;
    prefix?: string;
  } = $props();

  const weekdays = $derived(weekdayLabels());
  const slotsJson = $derived(slotsJsonOf(draft));
  const name = (field: string) => `${prefix}${field}`;
</script>

<input type="hidden" name={name('slots')} value={slotsJson} />
<input type="hidden" name={name('timezone')} value={draft.timezone} />

<div class="grid gap-4 sm:grid-cols-2">
  <label>
    <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_rule()}</span>
    <select name={name('ruleKind')} bind:value={draft.ruleKind} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500">
      <option value="fixed_slots">{m.regimen_rule_fixed()}</option>
      <option value="interval">{m.regimen_rule_interval()}</option>
      <option value="as_needed">{m.regimen_rule_as_needed()}</option>
    </select>
  </label>

  <label>
    <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_dose_text()}</span>
    <input name={name('doseText')} type="text" bind:value={draft.doseText} maxlength="200" placeholder={m.regimen_dose_text_placeholder()} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
  </label>
</div>

{#if draft.ruleKind === 'fixed_slots'}
  <fieldset>
    <legend class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{m.regimen_slots()}</legend>
    <div class="mt-3 space-y-3">
      {#each draft.slots as slot, index (index)}
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
            {#if draft.slots.length > 1}
              <button
                type="button"
                onclick={() => {
                  draft.slots = draft.slots.filter((_, i) => i !== index);
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
        draft.slots = [...draft.slots, emptySlot()];
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
        <label class={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${draft.daysOfWeek.includes(day) ? 'border-blue-300 bg-blue-100 text-blue-800' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200'}`}>
          <input
            type="checkbox"
            name={name('daysOfWeek')}
            value={day}
            checked={draft.daysOfWeek.includes(day)}
            onchange={(event) => {
              const checked = (event.currentTarget as HTMLInputElement).checked;
              draft.daysOfWeek = checked
                ? [...draft.daysOfWeek, day]
                : draft.daysOfWeek.filter((value) => value !== day);
            }}
            class="sr-only"
          />
          {label}
        </label>
      {/each}
    </div>
  </fieldset>
{:else if draft.ruleKind === 'interval'}
  <div class="grid gap-4 sm:grid-cols-2">
    <label>
      <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_interval_hours()}</span>
      <input name={name('intervalHours')} type="number" bind:value={draft.intervalHours} min="1" max="1080" step="any" required class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
    </label>
    <label>
      <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_anchor_time()}</span>
      <input name={name('anchorAt')} type="datetime-local" bind:value={draft.anchorAt} required class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
    </label>
  </div>
{/if}

<div class="grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
  <label>
    <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_effective_from()}</span>
    <input name={name('effectiveFrom')} type="date" bind:value={draft.effectiveFrom} required class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
  </label>
  <label>
    <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_effective_to()}</span>
    <input name={name('effectiveTo')} type="date" bind:value={draft.effectiveTo} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
  </label>
  <label>
    <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.medicine_route()}</span>
    <input name={name('route')} type="text" bind:value={draft.route} maxlength="120" class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
  </label>
  <label>
    <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_site()}</span>
    <input name={name('site')} type="text" bind:value={draft.site} maxlength="120" placeholder={m.regimen_site_placeholder()} class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
  </label>
  <label>
    <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.regimen_remind_before()}</span>
    <input name={name('remindMinutesBefore')} type="number" bind:value={draft.remindMinutesBefore} min="0" max="1440" step="5" class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
  </label>
  <label>
    <span class="mb-1.5 block text-sm font-medium text-slate-700">{m.notes()}</span>
    <input name={name('notes')} type="text" bind:value={draft.notes} maxlength="4000" class="w-full rounded-lg border-slate-300 px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
  </label>
</div>
