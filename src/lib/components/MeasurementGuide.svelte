<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import BodyModel3D from './BodyModel3D.svelte';
  import type { MeasurementGuide } from '$lib/content/measurement-guides';

  let {
    title,
    guide,
    circumferences = {},
    onClose,
  }: {
    title: string;
    guide: MeasurementGuide;
    circumferences?: Record<string, number>;
    onClose: () => void;
  } = $props();

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }

  function focusOnOpen(node: HTMLElement) {
    node.querySelector<HTMLButtonElement>('button')?.focus();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-8"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
>
  <div
    class="my-auto w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    use:focusOnOpen
  >
    <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-6 py-5">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700/80">{m.how_to_measure()}</p>
        <h2 class="mt-1 text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      </div>
      <button
        type="button"
        onclick={onClose}
        class="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
        aria-label={m.close()}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </header>

    <div class="grid gap-6 px-6 py-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div>
        <BodyModel3D site={guide.site} {circumferences} height={340} />
        <p class="mt-2 text-center text-xs text-slate-400">{m.guide_rotate_hint()}</p>
      </div>

      <div class="space-y-5">
        <section>
          <h3 class="mb-2 text-sm font-semibold text-slate-800">{m.guide_steps()}</h3>
          <ol class="space-y-2">
            {#each guide.steps as step, index}
              <li class="flex gap-3">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700"
                >
                  {index + 1}
                </span>
                <span class="text-sm text-slate-700">{step}</span>
              </li>
            {/each}
          </ol>
        </section>

        {#if guide.tips.length > 0}
          <section class="rounded-xl border border-teal-100 bg-teal-50/50 p-4">
            <h3 class="mb-2 text-sm font-semibold text-teal-900">{m.guide_tips()}</h3>
            <ul class="space-y-1.5">
              {#each guide.tips as tip}
                <li class="flex gap-2 text-sm text-teal-900/80">
                  <span aria-hidden="true">·</span>
                  <span>{tip}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if guide.mistakes.length > 0}
          <section class="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
            <h3 class="mb-2 text-sm font-semibold text-amber-900">{m.guide_mistakes()}</h3>
            <ul class="space-y-1.5">
              {#each guide.mistakes as mistake}
                <li class="flex gap-2 text-sm text-amber-900/80">
                  <span aria-hidden="true">·</span>
                  <span>{mistake}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <p class="text-xs text-slate-400">{m.guide_source({ source: guide.source })}</p>
      </div>
    </div>
  </div>
</div>
