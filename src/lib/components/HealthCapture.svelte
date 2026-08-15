<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import {
    MAX_CAPTURE_MESSAGE_CHARS,
    type HealthCaptureProposal,
  } from '$lib/health-capture';

  let {
    kind,
    patientId,
    onproposal,
  }: {
    kind: 'medicine' | 'energy';
    patientId: string;
    onproposal: (proposal: HealthCaptureProposal, sourceMessage: string) => void;
  } = $props();

  let message = $state('');
  let lastMessage = $state('');
  let proposal = $state<HealthCaptureProposal | null>(null);
  let submitting = $state(false);
  let error = $state('');

  function browserTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  function errorMessage(code: string) {
    if (code === 'capture_invalid_input') return m.capture_error_input();
    if (code === 'capture_unavailable') return m.capture_error_unavailable();
    return m.capture_error_failed();
  }

  async function submit() {
    const normalized = message.trim();
    if (!normalized || normalized.length > MAX_CAPTURE_MESSAGE_CHARS || submitting) {
      error = m.capture_error_input();
      return;
    }

    submitting = true;
    error = '';
    proposal = null;
    lastMessage = normalized;

    try {
      const response = await fetch('/api/health-capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          patientId,
          kind,
          message: normalized,
          timeZone: browserTimeZone(),
          locale: getLocale(),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        code?: string;
        proposal?: HealthCaptureProposal;
      };

      if (!response.ok || !result.proposal || result.proposal.kind !== kind) {
        error = errorMessage(result.code || 'capture_failed');
        return;
      }

      proposal = result.proposal;
      message = '';
    } catch {
      error = m.capture_error_failed();
    } finally {
      submitting = false;
    }
  }

  function review() {
    if (!proposal?.recognized) return;
    onproposal(proposal, lastMessage);
    proposal = null;
    lastMessage = '';
  }

  function clearResult() {
    proposal = null;
    lastMessage = '';
    error = '';
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<section
  class="rounded-2xl border {kind === 'medicine'
    ? 'border-blue-100 bg-blue-50/45'
    : 'border-orange-100 bg-orange-50/45'} p-4 sm:p-5"
  aria-labelledby={`${kind}-capture-title`}
>
  <div class="flex items-start gap-3">
    <div
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl {kind === 'medicine'
        ? 'bg-blue-100 text-blue-700'
        : 'bg-orange-100 text-orange-700'}"
      aria-hidden="true"
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="h-5 w-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.142-4.03 7.5-9 7.5a9.77 9.77 0 01-3.255-.542L3 20.25l1.482-3.705A6.958 6.958 0 013 12c0-4.142 4.03-7.5 9-7.5s9 3.358 9 7.5z" />
      </svg>
    </div>
    <div>
      <h4 id={`${kind}-capture-title`} class="text-sm font-semibold text-slate-900">
        {m.capture_title()}
      </h4>
      <p class="mt-0.5 text-xs leading-relaxed text-slate-600">
        {kind === 'medicine' ? m.capture_medicine_hint() : m.capture_energy_hint()}
      </p>
    </div>
  </div>

  {#if lastMessage}
    <div class="mt-4 flex justify-end">
      <p class="max-w-[88%] rounded-2xl rounded-br-md bg-slate-800 px-3.5 py-2.5 text-sm leading-relaxed text-white">
        {lastMessage}
      </p>
    </div>
  {/if}

  {#if proposal}
    <div class="mt-3 max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 shadow-sm" aria-live="polite">
      <p class="text-sm text-slate-700">
        {proposal.recognized ? m.capture_ready() : m.capture_unrecognized()}
      </p>
      {#if proposal.recognized && proposal.uncertainFields.length > 0}
        <p class="mt-1 text-xs text-amber-700">
          {m.capture_ready_uncertain({ count: proposal.uncertainFields.length })}
        </p>
      {/if}
      <div class="mt-3 flex flex-wrap gap-2">
        {#if proposal.recognized}
          <button
            type="button"
            onclick={review}
            class="rounded-lg {kind === 'medicine'
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-orange-600 hover:bg-orange-700'} px-3 py-2 text-xs font-semibold text-white transition-colors"
          >
            {m.capture_review()}
          </button>
        {/if}
        <button
          type="button"
          onclick={clearResult}
          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          {m.capture_clear()}
        </button>
      </div>
    </div>
  {/if}

  <form class="mt-4" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div class="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-slate-300 focus-within:ring-2 focus-within:ring-slate-200/70">
      <textarea
        bind:value={message}
        onkeydown={handleKeydown}
        rows="2"
        maxlength={MAX_CAPTURE_MESSAGE_CHARS}
        disabled={submitting}
        aria-label={kind === 'medicine' ? m.capture_medicine_hint() : m.capture_energy_hint()}
        placeholder={kind === 'medicine'
          ? m.capture_medicine_placeholder()
          : m.capture_energy_placeholder()}
        class="max-h-36 min-h-12 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:ring-0 disabled:opacity-60"
      ></textarea>
      <button
        type="submit"
        disabled={submitting || !message.trim()}
        aria-label={m.capture_send()}
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl {kind === 'medicine'
          ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300'
          : 'bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300'} text-white transition-colors disabled:cursor-not-allowed"
      >
        {#if submitting}
          <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true"></span>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-4 w-4" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.125A59.769 59.769 0 0121.485 12 59.768 59.768 0 013.27 20.875L5.999 12zm0 0h7.5" />
          </svg>
        {/if}
      </button>
    </div>
  </form>

  {#if submitting}
    <p class="mt-2 text-xs text-slate-500" aria-live="polite">{m.capture_working()}</p>
  {:else if error}
    <p class="mt-2 text-xs text-rose-700" role="alert">{error}</p>
  {/if}
  <p class="mt-2 text-[11px] leading-relaxed text-slate-500">{m.capture_source_notice()}</p>
</section>
