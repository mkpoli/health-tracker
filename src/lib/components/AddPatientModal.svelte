<script lang="ts">
  import { enhance } from '$app/forms';
  import * as m from '$lib/paraglide/messages.js';
  let { onClose }: { onClose: () => void } = $props();
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4">
  <div class="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
    <div class="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
      <h3 class="text-lg font-semibold text-slate-800">{m.add_new_patient()}</h3>
      <button onclick={onClose} aria-label={m.close()} class="text-slate-400 hover:text-slate-600">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="2"
          stroke="currentColor"
          class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
        >
      </button>
    </div>
    <form
      method="POST"
      action="?/createPatient"
      use:enhance={() => {
        return async ({ update }) => {
          await update();
          onClose();
        };
      }}
      class="p-6 space-y-4"
    >
      <div>
        <label for="name" class="block text-sm font-semibold text-slate-700 mb-1.5">{m.full_name()}</label>
        <input
          type="text"
          id="name"
          name="name"
          required
          class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2 px-3 border outline-none"
        />
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="agab" class="block text-sm font-semibold text-slate-700 mb-1.5">{m.sex()}</label>
          <select
            id="agab"
            name="agab"
            class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2 px-3 border outline-none"
          >
            <option value="Male">{m.male()}</option>
            <option value="Female">{m.female()}</option>
            <option value="Other">{m.other()}</option>
          </select>
        </div>
        <div>
          <label for="birthday" class="block text-sm font-semibold text-slate-700 mb-1.5">{m.date_of_birth()}</label>
          <input
            type="date"
            id="birthday"
            name="birthday"
            class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2 px-3 border outline-none"
          />
        </div>
      </div>
      <div class="pt-4 flex justify-end gap-3">
        <button
          type="button"
          onclick={onClose}
          class="px-4 py-2 border border-slate-300 rounded-lg shadow-sm text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors"
          >{m.cancel()}</button
        >
        <button
          type="submit"
          class="px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 transition-colors"
          >{m.save_patient()}</button
        >
      </div>
    </form>
  </div>
</div>
