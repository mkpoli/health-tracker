<script lang="ts">
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';

  type PatientOption = {
    id: string;
    name: string;
  };

  let {
    patients,
    currentPatientId,
    label,
    emptyLabel,
  }: {
    patients: PatientOption[];
    currentPatientId: string | null | undefined;
    label: string;
    emptyLabel: string;
  } = $props();

  const selectorId = $props.id();
  const listboxId = `${selectorId}-listbox`;
  let open = $state(false);
  let activeIndex = $state(0);
  let root = $state<HTMLDivElement | null>(null);
  let optionElements = $state<Array<HTMLAnchorElement | null>>([]);
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  const selectedIndex = $derived.by(() => {
    const index = patients.findIndex((patient) => patient.id === currentPatientId);
    return index >= 0 ? index : 0;
  });
  const selectedPatient = $derived(patients[selectedIndex] ?? null);

  function optionId(index: number) {
    return `${selectorId}-option-${index}`;
  }

  function setActiveOption(index: number) {
    if (patients.length === 0) return;

    activeIndex = (index + patients.length) % patients.length;
    tick().then(() => optionElements[activeIndex]?.scrollIntoView({ block: 'nearest' }));
  }

  function showOptions(index = selectedIndex) {
    if (patients.length === 0) return;

    open = true;
    setActiveOption(index);
  }

  function hideOptions() {
    open = false;
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open ? setActiveOption(activeIndex + 1) : showOptions(selectedIndex);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      open ? setActiveOption(activeIndex - 1) : showOptions(selectedIndex);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      open ? setActiveOption(0) : showOptions(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      open ? setActiveOption(patients.length - 1) : showOptions(patients.length - 1);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) {
        selectPatient(activeIndex);
      } else {
        showOptions();
      }
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      hideOptions();
      return;
    }

    if (event.key === 'Tab') {
      open = false;
      return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      focusTypeaheadMatch(event.key);
    }
  }

  function focusTypeaheadMatch(key: string) {
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    const lower = key.toLocaleLowerCase();

    // Repeating the same letter cycles through same-initial names; any other
    // key extends the running query so multi-character prefixes still match.
    const sameLetterRepeat = typeahead.length > 0 && typeahead.split('').every((char) => char === lower);
    typeahead = sameLetterRepeat ? lower : typeahead + lower;

    const step = sameLetterRepeat || typeahead.length === 1 ? 1 : 0;
    const start = activeIndex + step;
    const orderedPatients = [...patients.slice(start), ...patients.slice(0, start)];
    const match = orderedPatients.find((patient) =>
      patient.name.toLocaleLowerCase().startsWith(typeahead),
    );

    if (match) {
      if (!open) open = true;
      setActiveOption(patients.indexOf(match));
    }

    typeaheadTimer = setTimeout(() => {
      typeahead = '';
      typeaheadTimer = null;
    }, 700);
  }

  function selectPatient(index: number) {
    const patient = patients[index];
    if (!patient) return;

    open = false;
    void goto(`/?patientId=${encodeURIComponent(patient.id)}`);
  }

  $effect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && root?.contains(target)) return;
      open = false;
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });
</script>

<div bind:this={root} class="relative">
  <button
    type="button"
    disabled={patients.length === 0}
    class="flex h-9 max-w-[9rem] items-center gap-2.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-800 transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-default disabled:text-slate-500 sm:max-w-[14rem]"
    role="combobox"
    aria-label={`${label}: ${selectedPatient?.name ?? emptyLabel}`}
    aria-haspopup="listbox"
    aria-controls={open ? listboxId : undefined}
    aria-expanded={open}
    aria-activedescendant={open ? optionId(activeIndex) : undefined}
    onclick={() => (open ? hideOptions() : showOptions())}
    onkeydown={handleTriggerKeydown}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke-width="1.8"
      stroke="currentColor"
      aria-hidden="true"
      class="hidden h-4 w-4 shrink-0 text-slate-400 sm:block"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.1a7.5 7.5 0 0115 0v.15H4.5v-.15z"
      />
    </svg>
    <span class="min-w-0 flex-1 truncate text-left">{selectedPatient?.name ?? emptyLabel}</span>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
      class="h-4 w-4 shrink-0 text-slate-400 transition-transform {open ? 'rotate-180' : ''}"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  </button>

  {#if open}
    <div
      id={listboxId}
      role="listbox"
      aria-label={label}
      class="absolute right-0 z-40 mt-2 max-h-[min(20rem,calc(100vh-5rem))] w-max min-w-full max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
    >
      {#each patients as patient, index (patient.id)}
        <a
          bind:this={optionElements[index]}
          id={optionId(index)}
          href={`/?patientId=${encodeURIComponent(patient.id)}`}
          role="option"
          aria-selected={patient.id === currentPatientId}
          tabindex="-1"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-50 {index === activeIndex ? 'bg-teal-50 text-teal-900' : ''} {patient.id === currentPatientId ? 'font-semibold' : 'font-medium'}"
          onclick={() => {
            open = false;
          }}
          onpointermove={() => {
            activeIndex = index;
          }}
        >
          <span class="min-w-0 flex-1 break-words">{patient.name}</span>
          {#if patient.id === currentPatientId}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.25"
              aria-hidden="true"
              class="h-4 w-4 shrink-0 text-teal-600"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m5 12 4 4L19 6" />
            </svg>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</div>
