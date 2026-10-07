<script lang="ts">
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages.js';
  import favicon from '$lib/assets/favicon.svg';

  const title = $derived(
    page.status === 404 ? m.error_not_found_title()
      : page.status === 401 || page.status === 403 ? m.error_access_title()
        : page.status >= 500 ? m.error_server_title()
          : m.error_request_title(),
  );
  const description = $derived(
    page.status === 404 ? m.error_not_found_description()
      : page.status === 401 || page.status === 403 ? m.error_access_description()
        : page.status >= 500 ? m.error_server_description()
          : m.error_request_description(),
  );
</script>

<svelte:head>
  <title>{title} · {m.app_title()}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="grid min-h-dvh place-items-center bg-slate-50 px-6 py-12 text-slate-900">
  <div class="w-full max-w-lg">
    <a href="/" data-sveltekit-reload class="mb-12 inline-flex items-center gap-3 rounded-lg text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">
      <img src={favicon} alt="" width="40" height="40" />
      {m.app_title()}
    </a>
    <p class="mb-4 font-mono text-sm font-semibold tracking-widest text-teal-700">{page.status}</p>
    <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
    <p class="mt-5 text-base leading-7 text-slate-600">{description}</p>
    <div class="mt-8 flex flex-wrap gap-3">
      {#if page.status >= 500 && !page.url.pathname.startsWith('/auth/')}
        <!-- A document GET avoids replaying a failed form submission. -->
        <a href={page.url.pathname + page.url.search} data-sveltekit-reload class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">
          {m.error_reopen()}
        </a>
      {/if}
      <a href="/" data-sveltekit-reload class="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700">
        {m.error_home()}
      </a>
    </div>
    {#if page.status >= 500}
      <p class="mt-8 text-sm leading-6 text-slate-500">{m.error_save_notice()}</p>
    {/if}
    {#if page.error?.errorId}
      <p class="mt-6 break-words text-xs leading-5 text-slate-500">{m.error_reference()}: <code>{page.error.errorId}</code></p>
    {/if}
  </div>
</main>
