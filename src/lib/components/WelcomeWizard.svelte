<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  let { onCreateProfile }: { onCreateProfile: () => void } = $props();
</script>

<div class="flex flex-col items-center justify-center min-h-[65vh] text-center px-4 py-12">
  <div
    class="w-24 h-24 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center mb-8 shadow-sm border border-teal-100 relative"
  >
    <div
      class="absolute inset-0 rounded-full border border-teal-200 animate-[ping_3s_ease-out_infinite] opacity-40"
    ></div>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      class="w-12 h-12"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
      />
    </svg>
  </div>

  <h2 class="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight mb-6">
    {m.welcome_msg()}
    <span class="text-transparent bg-clip-text bg-linear-to-r from-teal-600 to-blue-600"
      >{m.app_title()} {m.app_pro()}</span
    >
  </h2>

  <p class="text-lg text-slate-500 max-w-2xl mb-12 leading-relaxed">
    {m.welcome_subtitle()}
  </p>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mb-14 text-left">
    <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      <div class="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-6 h-6"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
          /></svg
        >
      </div>
      <h3 class="text-lg font-bold text-slate-900 mb-2">{m.card1_title()}</h3>
      <p class="text-sm text-slate-500 leading-relaxed">{m.card1_desc()}</p>
    </div>

    <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      <div class="w-12 h-12 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center mb-5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-6 h-6"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
          /><path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
          /></svg
        >
      </div>
      <h3 class="text-lg font-bold text-slate-900 mb-2">{m.card2_title()}</h3>
      <p class="text-sm text-slate-500 leading-relaxed">{m.card2_desc()}</p>
    </div>

    <div class="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      <div class="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mb-5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-6 h-6"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
          /></svg
        >
      </div>
      <h3 class="text-lg font-bold text-slate-900 mb-2">{m.card3_title()}</h3>
      <p class="text-sm text-slate-500 leading-relaxed">{m.card3_desc()}</p>
    </div>
  </div>

  <div class="relative group">
    <div
      class="absolute -inset-1 bg-linear-to-r from-teal-500 to-blue-500 rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"
    ></div>
    <button
      onclick={onCreateProfile}
      class="relative inline-flex items-center justify-center px-10 py-4 text-lg font-bold text-white transition-all duration-200 bg-slate-900 border border-transparent rounded-xl hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 shadow-sm"
    >
      {m.hero_create_profile()}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="2.5"
        stroke="currentColor"
        class="w-5 h-5 ml-3"
        ><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" /></svg
      >
    </button>
  </div>
</div>
