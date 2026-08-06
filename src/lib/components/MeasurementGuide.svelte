<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import BodyModel3D from './BodyModel3D.svelte';
  import type { MeasurementGuide } from '$lib/content/measurement-guides';

  interface Props {
    title: string;
    guide: MeasurementGuide;
    circumferences?: Record<string, number>;
    onClose?: () => void;
  }

  let { title, guide, circumferences = {}, onClose }: Props = $props();

  const site = $derived(guide.site);
  const steps = $derived(guide.steps);
  const tips = $derived(guide.tips);
  const mistakes = $derived(guide.mistakes);

  const labels = {
    steps: m.guide_steps(),
    tips: m.guide_tips(),
    mistakes: m.guide_mistakes(),
    close: m.close(),
    rotateHint: m.guide_rotate_hint(),
  };

  let dialogEl: HTMLDivElement;

  $effect(() => {
    dialogEl.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  });

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose?.();
  }
</script>

<div
  class="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/45 sm:items-center sm:p-6"
  role="presentation"
  onclick={onBackdropClick}
>
  <div
    bind:this={dialogEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby="measurement-guide-title"
    tabindex="-1"
    class="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl"
  >
    <div
      class="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4"
    >
      <div>
        <p class="text-xs font-semibold tracking-[0.18em] text-violet-700/80 uppercase">
          {m.how_to_measure()}
        </p>
        <h2 id="measurement-guide-title" class="mt-0.5 text-lg font-semibold text-slate-900">
          {title}
        </h2>
      </div>
      <button
        type="button"
        aria-label={labels.close}
        onclick={() => onClose?.()}
        class="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
      >
        <svg
          class="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="grid flex-1 overflow-y-auto md:grid-cols-2">
      <div
        class="flex flex-col justify-center border-b border-slate-100 bg-slate-50 p-4 md:border-r md:border-b-0"
      >
        <BodyModel3D {site} {circumferences} height={340} />
        <p class="mt-1 text-center text-xs text-slate-400">{labels.rotateHint}</p>
      </div>

      <div class="space-y-6 p-6">
        {#if steps.length > 0}
          <section>
            <h3
              class="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase"
            >
              {labels.steps}
            </h3>
            <ol class="space-y-3">
              {#each steps as step, i}
                <li class="flex items-start gap-3">
                  <span
                    class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-semibold text-white"
                  >
                    {i + 1}
                  </span>
                  <p class="text-sm leading-relaxed text-slate-700">{step}</p>
                </li>
              {/each}
            </ol>
          </section>
        {/if}

        {#if tips.length > 0}
          <section class="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
            <div class="flex items-center gap-2">
              <svg
                class="h-4 w-4 text-violet-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                />
              </svg>
              <h3 class="text-xs font-semibold tracking-wider text-violet-700 uppercase">
                {labels.tips}
              </h3>
            </div>
            <ul class="mt-3 space-y-2">
              {#each tips as tip}
                <li class="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
                  <svg
                    class="mt-0.5 h-4 w-4 shrink-0 text-violet-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {tip}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if mistakes.length > 0}
          <section class="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div class="flex items-center gap-2">
              <svg
                class="h-4 w-4 text-amber-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
              <h3 class="text-xs font-semibold tracking-wider text-amber-700 uppercase">
                {labels.mistakes}
              </h3>
            </div>
            <ul class="mt-3 space-y-2">
              {#each mistakes as mistake}
                <li class="flex items-start gap-2 text-sm leading-relaxed text-amber-900">
                  <svg
                    class="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 8v5m0 3h.01" />
                    <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
                  </svg>
                  {mistake}
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
