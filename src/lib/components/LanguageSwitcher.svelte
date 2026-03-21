<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale, locales, setLocale } from '$lib/paraglide/runtime';

  type AppLocale = (typeof locales)[number];

  const currentLocale = $derived(getLocale());
  let pendingLocale = $state<AppLocale | null>(null);

  function getLanguageLabel(locale: string, displayLocale = locale) {
    try {
      return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(locale) ?? locale;
    } catch {
      return locale;
    }
  }

  const localeOptions = $derived(
    locales.map((locale) => ({
      locale,
      nativeLabel: getLanguageLabel(locale),
      currentLabel: getLanguageLabel(locale, currentLocale),
      tagLabel: locale.toUpperCase(),
      isActive: currentLocale === locale,
    })),
  );

  const activeLocale = $derived(localeOptions.find((option) => option.isActive) ?? localeOptions[0]);

  async function handleLocaleChange(locale: AppLocale) {
    if (locale === currentLocale || pendingLocale) return;

    pendingLocale = locale;

    try {
      await setLocale(locale);
    } finally {
      pendingLocale = null;
    }
  }
</script>

<nav aria-label={m.language_label()}>
  <details class="group relative">
    <summary class="flex list-none items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:bg-white marker:content-none">
      <div class="hidden min-w-0 sm:flex sm:flex-col">
        <span class="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">{m.language_label()}</span>
        <span class="truncate text-sm font-semibold text-slate-900">{activeLocale?.nativeLabel}</span>
      </div>
      <span class="rounded-full bg-teal-50 px-2 py-1 text-[10px] font-bold tracking-[0.2em] text-teal-700">
        {activeLocale?.tagLabel}
      </span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="h-4 w-4 text-slate-400 transition group-open:rotate-180"
      >
        <path
          fill-rule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
          clip-rule="evenodd"
        />
      </svg>
    </summary>

    <div class="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-2 shadow-2xl shadow-slate-900/10">
      {#each localeOptions as option}
        <button
          type="button"
          aria-current={option.isActive ? 'page' : undefined}
          aria-pressed={option.isActive}
          disabled={option.isActive || pendingLocale !== null}
          onclick={() => handleLocaleChange(option.locale)}
          class={`flex items-center justify-between rounded-xl px-3 py-3 transition-colors ${
            option.isActive ? 'bg-teal-600 text-white' : 'text-slate-700 hover:bg-slate-100'
          } ${option.isActive || pendingLocale !== null ? 'cursor-default' : ''} w-full text-left disabled:opacity-100`}
        >
          <span class="min-w-0">
            <span class="block truncate text-sm font-semibold">{option.nativeLabel}</span>
            <span class={`block truncate text-xs ${option.isActive ? 'text-teal-100' : 'text-slate-400'}`}>
              {option.currentLabel}
            </span>
          </span>
          <span
            class={`ml-3 rounded-full px-2 py-1 text-[10px] font-bold tracking-[0.2em] ${
              option.isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {option.tagLabel}
          </span>
        </button>
      {/each}
    </div>
  </details>
</nav>
