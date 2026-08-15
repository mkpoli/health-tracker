<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let copied = $state(false);

  function formatDate(value: string | null) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? null
      : new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(parsed);
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(data.endpoint);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<svelte:head><title>{m.connections_title()}</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-8">
  <a href="/" class="text-sm font-medium text-teal-700 hover:text-teal-800">← {m.app_title()}</a>

  <h1 class="mt-3 text-2xl font-semibold text-slate-900">{m.connections_title()}</h1>
  <p class="mt-2 text-sm text-slate-600">{m.connections_intro()}</p>

  <div class="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold text-slate-900">{m.connections_endpoint_label()}</h2>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <code class="rounded-lg bg-slate-100 px-3 py-1.5 text-sm break-all text-slate-800">{data.endpoint}</code>
      <button
        type="button"
        onclick={copyEndpoint}
        class="tap-compact rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        {copied ? m.connections_copied() : m.connections_copy()}
      </button>
    </div>
    <p class="mt-2 text-sm text-slate-600">{m.connections_endpoint_help()}</p>
    {#if !data.configured}
      <p class="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{m.connections_unconfigured()}</p>
    {/if}
  </div>

  <h2 class="mt-8 text-sm font-semibold text-slate-900">{m.connections_list_title()}</h2>

  {#if data.connections.length === 0}
    <p class="mt-2 rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
      {m.connections_empty()}
    </p>
  {:else}
    <ul class="mt-2 space-y-3">
      {#each data.connections as connection (connection.id)}
        <li class="rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-semibold text-slate-900">{connection.clientName}</p>
              <p class="mt-1 text-sm text-slate-600">
                {m.connections_profiles({ names: connection.patients.join(m.connections_profiles_separator()) })}
              </p>
              <p class="mt-1 text-xs text-slate-500">
                {connection.shareDemographics
                  ? m.connections_demographics_on()
                  : m.connections_demographics_off()}
              </p>
              <p class="mt-1 text-xs text-slate-500">
                {connection.canWriteMeasurements
                  ? m.connections_measurement_write_on()
                  : m.connections_measurement_write_off()}
              </p>
              <p class="mt-1 text-xs text-slate-500">
                {connection.canWriteClaims
                  ? m.connections_claim_write_on()
                  : m.connections_claim_write_off()}
              </p>
              <p class="mt-1 text-xs text-slate-500">
                {m.connections_granted({ date: formatDate(connection.createdAt) ?? '—' })}
                ·
                {connection.lastUsedAt
                  ? m.connections_last_used({ date: formatDate(connection.lastUsedAt) ?? '—' })
                  : m.connections_never_used()}
              </p>
            </div>

            <form method="POST" action="?/revoke">
              <input type="hidden" name="grant_id" value={connection.id} />
              <button
                type="submit"
                class="tap-compact rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                {m.connections_revoke()}
              </button>
            </form>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>
