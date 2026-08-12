<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { fitImageForUpload } from '$lib/image-fit';
  import { MAX_INLINE_IMAGE_BYTES } from '$lib/upload-limits';

  // One upload surface for the whole app: click to browse, drag onto it, or
  // drop a file anywhere inside it. Every zone stops its own drop from reaching
  // the page-level handler, so a file never lands in a different uploader than
  // the one it was dropped on.

  let {
    accept,
    /** Extensions the zone will take, lower case and with the dot. */
    extensions = [],
    name,
    inputRef = $bindable<HTMLInputElement | null>(null),
    selectedFile = null,
    title,
    hint,
    tone = 'teal',
    onSelect,
  }: {
    accept: string;
    extensions?: string[];
    name?: string;
    inputRef?: HTMLInputElement | null;
    selectedFile?: File | null;
    title: string;
    hint: string;
    tone?: 'teal' | 'violet';
    onSelect: (file: File, list: FileList) => void;
  } = $props();

  let dragging = $state(false);
  let rejected = $state('');
  /** Set when a photograph was redrawn small enough to send. */
  let resized = $state('');

  const toneRing = $derived(tone === 'teal' ? 'border-teal-500 bg-teal-50/60' : 'border-violet-500 bg-violet-50/60');
  const toneText = $derived(tone === 'teal' ? 'text-teal-700' : 'text-violet-700');
  const toneHover = $derived(tone === 'teal' ? 'hover:border-teal-500' : 'hover:border-violet-500');

  function accepts(file: File) {
    if (extensions.length === 0) return true;
    const lower = file.name.toLowerCase();
    return extensions.some((extension) => lower.endsWith(extension));
  }

  async function take(original: File | undefined, list: FileList | null) {
    if (!original) return;

    if (!accepts(original)) {
      rejected = m.file_type_not_accepted({ types: extensions.join(', ') });
      return;
    }

    rejected = '';
    resized = '';

    // A phone photograph of a report routinely exceeds what the server can
    // hold. Redrawing it here is the difference between a scan that works and
    // a refusal the person cannot act on.
    const fitted = await fitImageForUpload(original, MAX_INLINE_IMAGE_BYTES);
    const file = fitted.file;

    if (fitted.resizedFrom) {
      resized = m.file_resized_to_fit({
        before: String(Math.round(fitted.resizedFrom.bytes / 1024 / 1024)),
        after: String(Math.round((file.size / 1024 / 1024) * 10) / 10),
      });
    }

    // A dropped file has to end up on the input itself, or the surrounding
    // form submits with nothing attached. DataTransfer is the only way to
    // build a FileList that `input.files` will accept.
    let files = fitted.resizedFrom ? null : list;

    if (!files) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      files = transfer.files;
    }

    if (inputRef && inputRef.files !== files) {
      try {
        inputRef.files = files;
      } catch {
        // Safari refuses the assignment for some sources; the callback below
        // still receives the file, so only native form submission is affected.
      }
    }

    onSelect(file, files);
  }

  function onDrop(event: DragEvent) {
    // The zone owns this drop; the window handler must not see it.
    event.preventDefault();
    event.stopPropagation();
    dragging = false;

    const files = event.dataTransfer?.files;
    take(files?.[0], files ?? null);
  }
</script>

<div
  data-dropzone="true"
  role="presentation"
  ondragenter={(event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer?.types.includes('Files')) dragging = true;
  }}
  ondragover={(event) => {
    event.preventDefault();
    event.stopPropagation();
  }}
  ondragleave={(event) => {
    event.stopPropagation();
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) dragging = false;
  }}
  ondrop={onDrop}
>
  <label
    class="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors {dragging
      ? toneRing
      : `border-slate-300 bg-white ${toneHover}`}"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.5"
      stroke="currentColor"
      class="mb-2 h-9 w-9 {dragging ? toneText : 'text-slate-400'}"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M12 16.5V9.75m0 0l-3 3m3-3l3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
      />
    </svg>

    <span class="text-sm font-semibold {toneText}">{title}</span>
    <span class="mt-1 text-xs text-slate-500">{hint}</span>
    <span class="mt-1 text-xs text-slate-400">{m.or_drop_file_here()}</span>

    <input
      bind:this={inputRef}
      {name}
      type="file"
      {accept}
      class="sr-only"
      onchange={(event) => {
        const input = event.currentTarget;
        take(input.files?.[0], input.files);
      }}
    />
  </label>

  {#if selectedFile}
    <p class="mt-2 text-sm font-medium {toneText}">{m.selected_file({ name: selectedFile.name })}</p>
  {/if}

  {#if rejected}
    <p class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
      {rejected}
    </p>
  {/if}

  {#if resized}
    <p class="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">
      {resized}
    </p>
  {/if}
</div>
