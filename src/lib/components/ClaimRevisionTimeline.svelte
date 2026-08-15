<script module lang="ts">
  export interface ClaimRevisionTimelineItem {
    id: string;
    revision: number;
    changedAt: string;
    current: boolean;
    changedFields: string[];
    primary: string;
    secondary: string;
  }
</script>

<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';

  let { items }: { items: ClaimRevisionTimelineItem[] } = $props();

  function formatTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
</script>

{#if items.length > 0}
  <details class="group/history border-t border-slate-100">
    <summary
      class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 [&::-webkit-details-marker]:hidden"
    >
      <span class="flex min-w-0 items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="h-4 w-4 shrink-0" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8.25v3.75l2.25 2.25M21 12a9 9 0 11-9-9 8.97 8.97 0 016.364 2.636L21 8.25M21 3v5.25h-5.25" />
        </svg>
        <span class="font-semibold text-slate-700">{m.claim_revision_history()}</span>
        <span class="truncate">{m.claim_revision_count({ count: items.length })}</span>
      </span>
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-4 w-4 shrink-0 transition-transform group-open/history:rotate-180" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25L12 15.75 4.5 8.25" />
      </svg>
    </summary>

    <div class="border-t border-slate-100 bg-slate-50/70 px-4 py-4">
      <p class="mb-4 text-xs leading-relaxed text-slate-500">{m.claim_revision_retained_hint()}</p>
      <ol class="space-y-4">
        {#each items as item, index (item.id)}
          <li class="relative pl-5">
            {#if index < items.length - 1}
              <span class="absolute bottom-[-1rem] left-[0.28rem] top-2 w-px bg-slate-200" aria-hidden="true"></span>
            {/if}
            <span
              class={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white ring-1 ${item.current ? 'bg-blue-600 ring-blue-200' : 'bg-slate-300 ring-slate-200'}`}
              aria-hidden="true"
            ></span>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-xs font-semibold text-slate-800">
                {m.claim_revision_version({ revision: item.revision })}
              </span>
              {#if item.current}
                <span class="rounded-full bg-blue-50 px-2 py-0.5 text-[0.65rem] font-semibold text-blue-700">
                  {m.claim_revision_current()}
                </span>
              {/if}
              <span class="text-[0.7rem] text-slate-400">
                {m.claim_revision_saved({ date: formatTimestamp(item.changedAt) })}
              </span>
            </div>
            <p class="mt-1 text-sm font-medium text-slate-700">{item.primary}</p>
            {#if item.secondary}
              <p class="mt-0.5 text-xs leading-relaxed text-slate-500">{item.secondary}</p>
            {/if}
            <p class="mt-1 text-[0.7rem] text-slate-400">
              {item.changedFields.length > 0
                ? m.claim_revision_changed({ fields: item.changedFields.join(', ') })
                : m.claim_revision_first_retained()}
            </p>
          </li>
        {/each}
      </ol>
    </div>
  </details>
{/if}
