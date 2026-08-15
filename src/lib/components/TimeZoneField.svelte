<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import {
    resolveZonedDateTime,
    supportedTimeZones,
    timeZoneLabel,
  } from '$lib/time-zone';

  let {
    id,
    name = 'timeZone',
    value = $bindable('UTC'),
    dateTime = '',
    showLabel = true,
  }: {
    id: string;
    name?: string;
    value?: string;
    dateTime?: string;
    showLabel?: boolean;
  } = $props();

  const zones = supportedTimeZones();
  const labelInstant = $derived(
    dateTime ? resolveZonedDateTime(dateTime, value)?.instant || new Date() : new Date(),
  );
  const resolvedLabel = $derived(timeZoneLabel(value, labelInstant, getLocale()));
</script>

<label for={id} class="block">
  {#if showLabel}
    <span class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
      {m.time_zone()}
    </span>
  {/if}
  <select
    {id}
    {name}
    bind:value
    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
  >
    {#each zones as zone}
      <option value={zone}>{zone}</option>
    {/each}
  </select>
  <span class="mt-1.5 block text-xs leading-5 text-slate-500">
    {m.time_zone_interpreted_as({ zone: resolvedLabel })}
  </span>
</label>
