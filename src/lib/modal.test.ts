// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { createModalController, refreshAfterSave } from './modal';

beforeEach(() => { window.confirm = vi.fn(() => true); });

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.reverse().forEach((cleanup) => cleanup());
  cleanups.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function open(options: Partial<Parameters<typeof createModalController>[0]> = {}, html = '<input name="notes"><button>Close</button>') {
  const backdrop = document.createElement('div');
  const node = document.createElement('div');
  node.innerHTML = html;
  backdrop.appendChild(node);
  document.body.appendChild(backdrop);
  const onClose = vi.fn();
  const modal = createModalController({ onClose, ...options });
  const action = modal.attach(node);
  let destroyed = false;
  const destroy = () => { if (!destroyed) { destroyed = true; action.destroy(); backdrop.remove(); } };
  cleanups.push(destroy);
  await tick();
  await Promise.resolve();
  return { ...modal, backdrop, node, onClose, destroy };
}
const escape = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

describe('modal dismissal', () => {
  it('ignores editor backdrops, even before editing', async () => {
    const modal = await open();
    modal.backdrop.click();
    expect(modal.onClose).not.toHaveBeenCalled();
    modal.requestClose();
    expect(modal.onClose).toHaveBeenCalledOnce();
  });

  it('keeps the form when discard is declined, then allows explicit discard', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const modal = await open();
    modal.node.querySelector('input')!.value = 'unfinished';
    escape();
    expect(confirm).toHaveBeenCalledOnce();
    expect(modal.onClose).not.toHaveBeenCalled();
    expect(modal.node.querySelector('input')!.value).toBe('unfinished');
    confirm.mockReturnValue(true);
    modal.requestClose();
    expect(modal.onClose).toHaveBeenCalledOnce();
  });

  it('does not prompt after restoring raw form values or changing search', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const modal = await open({}, '<input name="notes" value="saved"><input type="search">');
    const input = modal.node.querySelector('input')!;
    input.value = 'changed';
    input.value = 'saved';
    modal.node.querySelector<HTMLInputElement>('[type=search]')!.value = 'filter';
    modal.requestClose();
    expect(confirm).not.toHaveBeenCalled();
    expect(modal.onClose).toHaveBeenCalledOnce();
  });

  it('tracks incomplete and hidden draft fields', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const draft = { rows: [] as Array<{ name: string; value: string }> };
    const modal = await open({ draft: () => draft });
    draft.rows.push({ name: 'Custom measurement', value: '' });
    modal.requestClose();
    expect(confirm).toHaveBeenCalledOnce();
    expect(modal.onClose).not.toHaveBeenCalled();
  });

  it('treats restored Svelte numeric bindings and cleared fields as unchanged', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    let draft: Record<string, unknown> = { quantity: '100', blank: '' };
    const modal = await open({ draft: () => draft });
    draft = { quantity: 100, blank: undefined, addedThenCleared: null };
    modal.requestClose();
    expect(confirm).not.toHaveBeenCalled();
    expect(modal.onClose).toHaveBeenCalledOnce();
  });

  it('tracks a selected photo even when the text draft is unchanged', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const modal = await open({ draft: () => ({ label: '' }) }, '<input name="photo" type="file">');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['photo'], 'food.png', { type: 'image/png' }));
    modal.node.querySelector('input')!.files = transfer.files;
    modal.requestClose();
    expect(confirm).toHaveBeenCalledOnce();
    expect(modal.onClose).not.toHaveBeenCalled();
  });

  it('prompts for prefilled proposals/imports, but lets completed imports close', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let complete = false;
    const modal = await open({ dirty: () => !complete, trackChanges: false });
    modal.requestClose();
    expect(confirm).toHaveBeenCalledOnce();
    expect(modal.onClose).not.toHaveBeenCalled();
    complete = true;
    modal.requestClose();
    expect(modal.onClose).toHaveBeenCalledOnce();
  });

  it('blocks every close path while busy and unlocks after failure', async () => {
    let busy = true;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const modal = await open({ busy: () => busy, dirty: () => true, allowBackdrop: true });
    modal.backdrop.click();
    escape();
    modal.requestClose();
    expect(modal.onClose).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    busy = false;
    modal.requestClose();
    expect(modal.onClose).toHaveBeenCalledOnce();
  });

  it('allows safe backdrops but ignores clicks inside the dialog', async () => {
    const modal = await open({ trackChanges: false, allowBackdrop: true });
    modal.node.click();
    expect(modal.onClose).not.toHaveBeenCalled();
    modal.backdrop.click();
    expect(modal.onClose).toHaveBeenCalledOnce();
  });

  it('closes only the top dialog, then restores focus to its opener', async () => {
    const parent = await open();
    const opener = parent.node.querySelector('button')!;
    opener.focus();
    const guide = await open({ trackChanges: false, allowBackdrop: true });
    escape();
    expect(guide.onClose).toHaveBeenCalledOnce();
    expect(parent.onClose).not.toHaveBeenCalled();
    guide.destroy();
    expect(document.activeElement).toBe(opener);
    escape();
    expect(parent.onClose).toHaveBeenCalledOnce();
  });

  it('keeps background controls from receiving focus and removes listeners on close', async () => {
    const background = document.createElement('button');
    document.body.appendChild(background);
    background.focus();
    const modal = await open();
    background.focus();
    expect(document.activeElement).toBe(modal.node);
    modal.destroy();
    expect(document.activeElement).toBe(background);
    escape();
    expect(modal.onClose).not.toHaveBeenCalled();
  });
});

describe('refresh after a committed save', () => {
  it('allows the successful editor to close if only the refresh fails', async () => {
    window.alert = vi.fn();
    const closeSavedEditor = vi.fn();
    await refreshAfterSave(() => Promise.reject(new Error('offline')));
    closeSavedEditor();
    expect(window.alert).toHaveBeenCalledOnce();
    expect(closeSavedEditor).toHaveBeenCalledOnce();
  });

  it('does not alert when the refresh succeeds', async () => {
    window.alert = vi.fn();
    await refreshAfterSave(() => Promise.resolve());
    expect(window.alert).not.toHaveBeenCalled();
  });
});
