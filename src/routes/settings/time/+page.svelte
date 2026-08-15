<script lang="ts">
  import { enhance } from '$app/forms';
  import * as m from '$lib/paraglide/messages.js';
  import TimeZoneField from '$lib/components/TimeZoneField.svelte';
  import { timeZoneLabel } from '$lib/time-zone';
  import { getLocale } from '$lib/paraglide/runtime';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: any } = $props();
  let browserTimeZone = $state('UTC');

  function initialSelectedZones() {
    return Object.fromEntries(data.profiles.map((profile) => [profile.id, profile.timeZone]));
  }

  let selectedZones = $state(initialSelectedZones());

  $effect(() => {
    browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  });
</script>

<svelte:head><title>{m.time_settings_title()}</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-8">
  <a href="/" class="text-sm font-medium text-teal-700 hover:text-teal-800">← {m.app_title()}</a>

  <h1 class="mt-3 text-2xl font-semibold text-slate-900">{m.time_settings_title()}</h1>
  <p class="mt-2 text-sm leading-6 text-slate-600">{m.time_settings_intro()}</p>

  <div class="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
    {m.browser_time_zone({
      zone: timeZoneLabel(browserTimeZone, new Date(), getLocale()),
    })}
  </div>

  <div class="mt-6 space-y-4">
    {#each data.profiles as profile (profile.id)}
      <form method="POST" action="?/save" use:enhance class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <input type="hidden" name="patientId" value={profile.id} />
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold text-slate-900">{profile.name}</h2>
            <p class="mt-1 text-xs text-slate-500">
              {profile.hasTimeZone ? m.profile_time_zone_saved() : m.profile_time_zone_missing()}
            </p>
          </div>
          {#if form?.success && form.patientId === profile.id}
            <span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              {m.time_zone_saved()}
            </span>
          {/if}
        </div>

        <div class="mt-4">
          <TimeZoneField id={`profile-time-zone-${profile.id}`} bind:value={selectedZones[profile.id]} />
        </div>

        {#if form?.code === 'invalid_time_zone' && form.patientId === profile.id}
          <p class="mt-2 text-sm text-rose-600">{m.time_zone_invalid()}</p>
        {/if}

        <p class="mt-3 text-sm leading-6 text-slate-600">{m.time_zone_hint()}</p>
        <button type="submit" class="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700">
          {m.save_time_zone()}
        </button>
      </form>
    {/each}
  </div>
</div>
