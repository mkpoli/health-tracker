<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // Nothing is granted until it is picked. A household account holds other
  // people's records, and a pre-ticked list turns one reflexive click into
  // access to all of them.
  let selected = $state<string[]>([]);
  let shareDemographics = $state(false);
  // Writing is never implied by connecting; it is ticked on purpose or not at all.
  let allowWrite = $state(false);

  function toggle(id: string, checked: boolean) {
    selected = checked ? [...new Set([...selected, id])] : selected.filter((item) => item !== id);
  }
</script>

<svelte:head><title>{m.consent_title()}</title></svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10">
  <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
    <h1 class="text-xl font-semibold text-slate-900">{m.consent_title()}</h1>
    <p class="mt-2 text-sm text-slate-600">
      {m.consent_intro({ client: data.client.name })}
    </p>
    <div class="mt-3 rounded-xl border border-slate-200 px-3 py-2">
      <p class="text-xs text-slate-500">{m.consent_destination_label()}</p>
      <p class="text-sm font-medium break-all text-slate-900">{data.client.redirectOrigin}</p>
      {#if data.client.uri}
        <p class="mt-1 text-xs break-all text-slate-500">{data.client.uri}</p>
      {/if}
    </div>
    <p class="mt-2 text-xs text-slate-500">{m.consent_client_unverified()}</p>

    {#if form?.error}
      <p class="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{m.consent_error({ code: form.error })}</p>
    {/if}

    <form method="POST" action="?/approve{data.query.replace('?', '&')}" class="mt-6 space-y-6">
      <fieldset>
        <legend class="text-sm font-semibold text-slate-900">{m.consent_profiles_label()}</legend>

        {#if data.patients.length === 0}
          <p class="mt-2 text-sm text-slate-600">{m.consent_no_profiles()}</p>
        {:else}
          <div class="mt-2 space-y-2">
            {#each data.patients as item (item.id)}
              <label class="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  name="patient_id"
                  value={item.id}
                  checked={selected.includes(item.id)}
                  onchange={(event) => toggle(item.id, event.currentTarget.checked)}
                  class="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span>{item.name}</span>
              </label>
            {/each}
          </div>
        {/if}
      </fieldset>

      <label class="flex gap-3 rounded-xl border border-slate-200 px-3 py-3">
        <input
          type="checkbox"
          name="allow_write"
          bind:checked={allowWrite}
          class="mt-0.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span class="text-sm">
          <span class="font-medium text-slate-900">{m.consent_write_label()}</span>
          <span class="mt-1 block text-slate-600">{m.consent_write_help()}</span>
        </span>
      </label>

      <label class="flex gap-3 rounded-xl border border-slate-200 px-3 py-3">
        <input
          type="checkbox"
          name="share_demographics"
          bind:checked={shareDemographics}
          class="mt-0.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span class="text-sm">
          <span class="font-medium text-slate-900">{m.consent_demographics_label()}</span>
          <span class="mt-1 block text-slate-600">{m.consent_demographics_help()}</span>
        </span>
      </label>

      <div class="space-y-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
        <div>
          <p class="font-medium text-slate-900">{m.consent_reads_title()}</p>
          <p class="mt-0.5">{m.consent_reads_body()}</p>
        </div>
        <div>
          <p class="font-medium text-slate-900">{m.consent_never_title()}</p>
          <p class="mt-0.5">{allowWrite ? m.consent_never_body_with_write() : m.consent_never_body()}</p>
        </div>
        <p class="text-slate-600">{m.consent_provider_warning()}</p>
      </div>

      <div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="submit"
          formaction="?/deny{data.query.replace('?', '&')}"
          class="tap-target rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {m.consent_deny()}
        </button>
        <button
          type="submit"
          disabled={selected.length === 0}
          class="tap-target rounded-full bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {m.consent_approve()}
        </button>
      </div>
    </form>

    <p class="mt-4 text-xs text-slate-500">{m.consent_revoke_hint()}</p>
  </div>
</div>
