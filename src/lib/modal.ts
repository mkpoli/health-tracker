import { tick, untrack } from 'svelte';
import * as m from '$lib/paraglide/messages.js';

type ModalOptions = {
  onClose: () => void;
  busy?: () => boolean;
  /** A selected import or capture proposal is unsaved even before it is edited. */
  dirty?: () => boolean;
  /** Use raw draft state for forms whose fields can be filtered or collapsed. */
  draft?: () => unknown;
  trackChanges?: boolean;
  allowBackdrop?: boolean;
};

type OpenModal = { node: HTMLElement; close: () => void };
const stack: OpenModal[] = [];

function onKeydown(event: KeyboardEvent) {
  const top = stack.at(-1);
  if (!top || event.defaultPrevented) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    top.close();
  } else if (event.key === 'Tab') {
    const controls = Array.from(top.node.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
      .filter((control) => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || (event.shiftKey && (document.activeElement === first || document.activeElement === top.node))) {
      event.preventDefault();
      (last ?? top.node).focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === top.node)) {
      event.preventDefault();
      first.focus();
    }
  }
}

function containFocus(event: FocusEvent) {
  const top = stack.at(-1);
  if (top && !top.node.contains(event.target as Node)) top.node.focus();
}

// Number bindings can turn "100" into 100 or an empty string into undefined.
// Compare their displayed values so reverting an edit restores a clean draft.
function draftState(value: unknown): unknown {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(draftState);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, item]) => item != null && item !== '')
      .map(([key, item]) => [key, draftState(item)]));
  }
  return value;
}

function formState(node: HTMLElement, filesOnly = false) {
  const fields = Array.from(node.querySelectorAll('input, select, textarea')) as unknown as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  return fields
    // Search only controls which fields are shown; it is not part of a draft.
    .filter((field) => field.type !== 'search' && (!filesOnly || field.type === 'file'))
    .map((field) => {
      if (field instanceof HTMLInputElement) {
        if (field.type === 'file') {
          return [field.name, Array.from(field.files ?? []).map((file) => [file.name, file.size, file.type, file.lastModified])];
        }
        if (field.type === 'checkbox' || field.type === 'radio') return [field.name, field.value, field.checked];
      }
      if (field instanceof HTMLSelectElement && field.multiple) {
        return [field.name, Array.from(field.selectedOptions).map((option) => option.value)];
      }
      return [field.name, field.value];
    });
}

/** Attach to the dialog itself. Only read-only/cancel-safe dialogs opt into backdrop dismissal. */
export function createModalController(options: ModalOptions) {
  let node: HTMLElement | undefined;
  let baseline = '';
  const snapshot = () => JSON.stringify(options.draft
    ? [draftState(options.draft()), node ? formState(node, true) : []]
    : node ? formState(node) : []);

  function confirmDiscard() {
    if (options.busy?.()) return false;
    const changed = options.dirty?.() || (options.trackChanges !== false && node && snapshot() !== baseline);
    return !changed || window.confirm(m.modal_discard_confirm());
  }

  function requestClose() {
    if (confirmDiscard()) options.onClose();
  }

  function attach(element: HTMLElement) {
    node = element;
    element.tabIndex = -1;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = { node: element, close: requestClose };
    stack.push(entry);
    if (stack.length === 1) {
      window.addEventListener('keydown', onKeydown);
      document.addEventListener('focusin', containFocus);
    }
    let mounted = true;
    // Svelte bindings and initial effects must settle before taking the baseline.
    void tick().then(() => {
      if (!mounted) return;
      baseline = untrack(snapshot);
      if (stack.at(-1) === entry && !element.contains(document.activeElement)) {
        element.focus();
      }
    });
    const backdrop = element.parentElement;
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === backdrop && options.allowBackdrop && stack.at(-1) === entry) requestClose();
    };
    backdrop?.addEventListener('click', onBackdrop);
    return {
      destroy() {
        mounted = false;
        const wasTop = stack.at(-1) === entry;
        stack.splice(stack.indexOf(entry), 1);
        if (!stack.length) {
          window.removeEventListener('keydown', onKeydown);
          document.removeEventListener('focusin', containFocus);
        }
        backdrop?.removeEventListener('click', onBackdrop);
        node = undefined;
        if (wasTop && opener?.isConnected) opener.focus();
      },
    };
  }

  return { attach, requestClose, confirmDiscard };
}

/** A committed save stays successful even if refreshing the page data fails. */
export async function refreshAfterSave(refresh: () => Promise<void>) {
  try {
    await refresh();
  } catch {
    window.alert(m.modal_refresh_failed());
  }
}
