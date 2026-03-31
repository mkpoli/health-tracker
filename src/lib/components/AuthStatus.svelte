<script lang="ts">
  import type { AuthUser } from '$lib/server/auth0';

  let { user, compact = false } = $props<{ user?: AuthUser | null; compact?: boolean }>();
</script>

<div class="flex items-center gap-3">
  {#if user}
    {#if !compact}
      <div class="hidden items-center gap-3 lg:flex">
      <div class="text-right">
        <p class="text-sm font-semibold text-slate-900">{user.name || 'Signed in'}</p>
        <p class="text-xs text-slate-500">{user.email || 'Auth0 session active'}</p>
      </div>
    </div>
    {/if}
    <a
      href="/auth/logout"
      class="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
    >
      Log out
    </a>
  {:else}
    <a
      href="/auth/login"
      class="rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700"
    >
      Log in
    </a>
  {/if}
</div>
