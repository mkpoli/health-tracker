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
      tagLabel: locale.toUpperCase(),
      isActive: currentLocale === locale,
    })),
  );

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
  <p class="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">{m.language_label()}</p>
  {#each localeOptions as option}
    <button
      type="button"
      aria-current={option.isActive ? 'true' : undefined}
      disabled={pendingLocale !== null}
      onclick={() => handleLocaleChange(option.locale)}
      class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors {option.isActive
        ? 'bg-teal-50 text-teal-800'
        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}"
    >
      <span class="truncate text-sm font-medium">{option.nativeLabel}</span>
      <span
        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.16em] {option.isActive
          ? 'bg-teal-600 text-white'
          : 'bg-slate-100 text-slate-500'}"
      >
        {option.tagLabel}
      </span>
    </button>
  {/each}
</nav>
