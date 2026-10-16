<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import * as m from '$lib/paraglide/messages.js';
  import { createModalController, refreshAfterSave } from '$lib/modal';
  import { getLocale } from '$lib/paraglide/runtime';
  import {
    prepareNames,
    prepareIdentifiers,
    sourceFrom,
    sourceInstant,
    type SourceDraft,
    type NameDraft,
    type IdentifierDraft,
  } from '$lib/medicine-catalog-draft';
  import { fetchMedicineCatalogRevisions } from '$lib/medicine-catalog-client';
  import {
    localizedMedicineCatalogName,
    medicineIngredientStrength,
    type MedicineCatalogIdentifierRecord,
    type MedicineCatalogNameRecord,
    type MedicineCatalogRevisionRecord,
    type MedicineCatalogStatus,
    type MedicineIngredientRecord,
    type MedicineIngredientRole,
    type MedicineProductRecord,
    type MedicineProductType,
  } from '$lib/medicine-catalog';

  let {
    patientId,
    ingredients = [],
    products = [],
    versionCounts = {},
  }: {
    patientId: string;
    ingredients: MedicineIngredientRecord[];
    products: MedicineProductRecord[];
    versionCounts: Record<string, number>;
  } = $props();

  type ComponentDraft = SourceDraft & {
    localId: string;
    id: string | null;
    ingredientId: string;
    role: MedicineIngredientRole;
    numeratorValue: string;
    numeratorUnit: string;
    denominatorValue: string;
    denominatorUnit: string;
    strengthText: string;
    basisOfStrengthText: string;
  };

  type IngredientDraft = {
    id: string;
    revision: number;
    canonicalName: string;
    status: MedicineCatalogStatus;
    notes: string;
    names: NameDraft[];
    identifiers: IdentifierDraft[];
  };

  type ProductDraft = {
    id: string;
    revision: number;
    displayName: string;
    productType: MedicineProductType;
    status: MedicineCatalogStatus;
    doseFormText: string;
    doseFormSystem: string;
    doseFormCode: string;
    routeText: string;
    routeSystem: string;
    routeCode: string;
    strengthText: string;
    manufacturer: string;
    marketingAuthorizationHolder: string;
    marketCountry: string;
    packageDescription: string;
    imprint: string;
    color: string;
    shape: string;
    notes: string;
    names: NameDraft[];
    identifiers: IdentifierDraft[];
    ingredients: ComponentDraft[];
  };

  let editorKind = $state<'ingredient' | 'product' | null>(null);
  let ingredientDraft = $state<IngredientDraft>(emptyIngredient());
  let productDraft = $state<ProductDraft>(emptyProduct());
  let saving = $state(false);
  let saveError = $state('');
  let staleRevision = $state(false);

  const sortedProducts = $derived(
    [...products].sort((left, right) => left.displayName.localeCompare(right.displayName, getLocale())),
  );
  const sortedIngredients = $derived(
    [...ingredients].sort((left, right) =>
      left.canonicalName.localeCompare(right.canonicalName, getLocale()),
    ),
  );

  function localId() {
    return crypto.randomUUID();
  }

  function emptySource(): SourceDraft {
    return { sourceKind: 'manual', sourceProvider: '', sourceUrl: '', sourceRetrievedAt: '', retrievedAtBaseline: { instant: null, local: '' } };
  }

  function emptyName(name = '', preferred = false): NameDraft {
    return {
      localId: localId(),
      id: null,
      name,
      languageTag: 'und',
      nameType: preferred ? 'preferred' : 'synonym',
      jurisdiction: '',
      preferred,
      ...emptySource(),
    };
  }

  function emptyIdentifier(): IdentifierDraft {
    return {
      localId: localId(),
      id: null,
      system: '',
      code: '',
      jurisdiction: '',
      ...emptySource(),
    };
  }

  function emptyComponent(): ComponentDraft {
    return {
      localId: localId(),
      id: null,
      ingredientId: ingredients[0]?.id || '',
      role: 'active',
      numeratorValue: '',
      numeratorUnit: '',
      denominatorValue: '',
      denominatorUnit: '',
      strengthText: '',
      basisOfStrengthText: '',
      ...emptySource(),
    };
  }

  function emptyIngredient(): IngredientDraft {
    return {
      id: '',
      revision: 0,
      canonicalName: '',
      status: 'active',
      notes: '',
      names: [emptyName('', true)],
      identifiers: [],
    };
  }

  function emptyProduct(): ProductDraft {
    return {
      id: '',
      revision: 0,
      displayName: '',
      productType: 'other',
      status: 'active',
      doseFormText: '',
      doseFormSystem: '',
      doseFormCode: '',
      routeText: '',
      routeSystem: '',
      routeCode: '',
      strengthText: '',
      manufacturer: '',
      marketingAuthorizationHolder: '',
      marketCountry: '',
      packageDescription: '',
      imprint: '',
      color: '',
      shape: '',
      notes: '',
      names: [emptyName('', true)],
      identifiers: [],
      ingredients: [],
    };
  }

  function nameFrom(value: MedicineCatalogNameRecord): NameDraft {
    return {
      localId: localId(),
      id: value.id,
      name: value.name,
      languageTag: value.languageTag,
      nameType: value.nameType,
      jurisdiction: value.jurisdiction || '',
      preferred: value.preferred,
      ...sourceFrom(value),
    };
  }

  function identifierFrom(value: MedicineCatalogIdentifierRecord): IdentifierDraft {
    return {
      localId: localId(),
      id: value.id,
      system: value.system,
      code: value.code,
      jurisdiction: value.jurisdiction || '',
      ...sourceFrom(value),
    };
  }

  function openIngredient(value?: MedicineIngredientRecord) {
    ingredientDraft = value
      ? {
          id: value.id,
          revision: value.revision,
          canonicalName: value.canonicalName,
          status: value.status,
          notes: value.notes || '',
          names: value.names.map(nameFrom),
          identifiers: value.identifiers.map(identifierFrom),
        }
      : emptyIngredient();
    saveError = '';
    staleRevision = false;
    editorKind = 'ingredient';
  }

  function openProduct(value?: MedicineProductRecord) {
    productDraft = value
      ? {
          id: value.id,
          revision: value.revision,
          displayName: value.displayName,
          productType: value.productType,
          status: value.status,
          doseFormText: value.doseFormText || '',
          doseFormSystem: value.doseFormSystem || '',
          doseFormCode: value.doseFormCode || '',
          routeText: value.routeText || '',
          routeSystem: value.routeSystem || '',
          routeCode: value.routeCode || '',
          strengthText: value.strengthText || '',
          manufacturer: value.manufacturer || '',
          marketingAuthorizationHolder: value.marketingAuthorizationHolder || '',
          marketCountry: value.marketCountry || '',
          packageDescription: value.packageDescription || '',
          imprint: value.imprint || '',
          color: value.color || '',
          shape: value.shape || '',
          notes: value.notes || '',
          names: value.names.map(nameFrom),
          identifiers: value.identifiers.map(identifierFrom),
          ingredients: value.ingredients.map((ingredient) => ({
            localId: localId(),
            id: ingredient.id,
            ingredientId: ingredient.ingredientId,
            role: ingredient.role,
            numeratorValue: ingredient.numeratorValue || '',
            numeratorUnit: ingredient.numeratorUnit || '',
            denominatorValue: ingredient.denominatorValue || '',
            denominatorUnit: ingredient.denominatorUnit || '',
            strengthText: ingredient.strengthText || '',
            basisOfStrengthText: ingredient.basisOfStrengthText || '',
            ...sourceFrom(ingredient),
          })),
        }
      : emptyProduct();
    saveError = '';
    staleRevision = false;
    editorKind = 'product';
  }

  function closeEditor() {
    if (saving) return;
    editorKind = null;
    saveError = '';
  }

  const editorModal = createModalController({
    onClose: closeEditor,
    busy: () => saving,
    draft: () => editorKind === 'ingredient' ? ingredientDraft : productDraft,
  });

  const ingredientStructure = $derived(
    JSON.stringify({
      names: prepareNames(ingredientDraft.names, ingredientDraft.canonicalName),
      identifiers: prepareIdentifiers(ingredientDraft.identifiers),
    }),
  );

  const productStructure = $derived(
    JSON.stringify({
      names: prepareNames(productDraft.names, productDraft.displayName),
      identifiers: prepareIdentifiers(productDraft.identifiers),
      ingredients: productDraft.ingredients.map(({ localId: _localId, retrievedAtBaseline, ...ingredient }) => ({
        ...ingredient,
        numeratorValue: ingredient.numeratorValue.trim() || null,
        numeratorUnit: ingredient.numeratorUnit.trim() || null,
        denominatorValue: ingredient.denominatorValue.trim() || null,
        denominatorUnit: ingredient.denominatorUnit.trim() || null,
        strengthText: ingredient.strengthText.trim() || null,
        basisOfStrengthText: ingredient.basisOfStrengthText.trim() || null,
        sourceProvider: ingredient.sourceProvider.trim() || null,
        sourceUrl: ingredient.sourceUrl.trim() || null,
        sourceRetrievedAt: sourceInstant(ingredient.sourceRetrievedAt, retrievedAtBaseline),
      })),
    }),
  );

  function validationMessage(code: string) {
    switch (code) {
      case 'medicine_catalog_invalid_strength': return m.medicine_catalog_invalid_strength();
      case 'medicine_catalog_invalid_language': return m.medicine_catalog_invalid_language();
      case 'medicine_catalog_invalid_country': return m.medicine_catalog_invalid_country();
      case 'medicine_catalog_invalid_source': return m.medicine_catalog_invalid_source();
      case 'medicine_catalog_field_too_long': return m.medicine_catalog_field_too_long();
      default: return m.medicine_catalog_save_failed();
    }
  }

  const submitCatalog: SubmitFunction = ({ cancel }) => {
    if (saving || staleRevision) { cancel(); return; }
    saving = true;
    saveError = '';
    return async ({ result, update }) => {
      try {
        if (result.type === 'success') {
          await refreshAfterSave(() => update({ reset: false, invalidateAll: true }));
          editorKind = null;
          return;
        }
        if (result.type === 'failure' && result.status === 409) {
          const code = String(result.data?.code ?? '');
          staleRevision = code !== 'medicine_catalog_ingredient_in_use';
          saveError = code === 'medicine_catalog_ingredient_in_use'
            ? m.medicine_catalog_ingredient_in_use()
            : m.claim_revision_stale();
          await invalidateAll();
        } else {
          saveError = validationMessage(result.type === 'failure' ? String(result.data?.code ?? '') : '');
        }
      } catch {
        if (!saveError) saveError = m.medicine_catalog_save_failed();
      } finally {
        saving = false;
      }
    };
  };

  const submitDelete: SubmitFunction = (submission) => {
    if (saving || staleRevision) { submission.cancel(); return; }
    const message = editorKind === 'ingredient'
      ? m.medicine_catalog_delete_ingredient_confirm({ name: ingredientDraft.canonicalName })
      : m.medicine_catalog_delete_product_confirm({ name: productDraft.displayName });
    if (!confirm(message)) { submission.cancel(); return; }
    return submitCatalog(submission);
  };

  function statusLabel(status: MedicineCatalogStatus) {
    if (status === 'active') return m.medicine_catalog_status_active();
    if (status === 'inactive') return m.medicine_catalog_status_inactive();
    return m.medicine_catalog_status_archived();
  }

  function productTypeLabel(type: MedicineProductType) {
    if (type === 'branded') return m.medicine_catalog_type_branded();
    if (type === 'generic') return m.medicine_catalog_type_generic();
    if (type === 'compounded') return m.medicine_catalog_type_compounded();
    if (type === 'supplement') return m.medicine_catalog_type_supplement();
    return m.medicine_catalog_type_other();
  }

  function roleLabel(role: MedicineIngredientRole) {
    if (role === 'active') return m.medicine_catalog_role_active();
    if (role === 'inactive') return m.medicine_catalog_role_inactive();
    return m.medicine_catalog_role_unknown();
  }

  // Saved versions are read when a product's list is opened, not with the page.
  let loadedVersions = $state<Record<string, MedicineCatalogRevisionRecord[] | 'loading' | 'failed'>>({});

  $effect(() => {
    void versionCounts;
    loadedVersions = {};
  });

  const productCountLabel = $derived(
    products.length === 1
      ? m.medicine_catalog_product_count_one({ count: products.length })
      : m.medicine_catalog_product_count_other({ count: products.length }),
  );
  const ingredientCountLabel = $derived(
    ingredients.length === 1
      ? m.medicine_catalog_ingredient_count_one({ count: ingredients.length })
      : m.medicine_catalog_ingredient_count_other({ count: ingredients.length }),
  );

  function versionsLabel(count: number) {
    return count === 1
      ? m.medicine_catalog_versions_one({ count })
      : m.medicine_catalog_versions_other({ count });
  }

  function versionRows(id: string) {
    const rows = loadedVersions[id];
    return Array.isArray(rows) ? rows : [];
  }

  async function loadVersions(id: string) {
    if (loadedVersions[id] && loadedVersions[id] !== 'failed') return;
    loadedVersions[id] = 'loading';
    try {
      const rows = await fetchMedicineCatalogRevisions(patientId, 'product', id);
      loadedVersions[id] = rows.sort((left, right) => right.revision - left.revision);
    } catch {
      loadedVersions[id] = 'failed';
    }
  }

  function formatDateTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
</script>

<details class="group border-b border-slate-100 bg-slate-50/40">
  <summary class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6">
    <div>
      <h4 class="text-sm font-semibold text-slate-800">{m.medicine_catalog_title()}</h4>
      <p class="mt-0.5 text-xs leading-relaxed text-slate-500">{m.medicine_catalog_subtitle()}</p>
    </div>
    <span class="flex shrink-0 items-center gap-2 text-xs font-semibold text-blue-700">
      {productCountLabel} · {ingredientCountLabel}
      <svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true">
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
      </svg>
    </span>
  </summary>

  <div class="space-y-6 border-t border-slate-100 px-4 py-5 sm:px-6">
    <section>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h5 class="text-sm font-semibold text-slate-900">{m.medicine_catalog_products()}</h5>
          <p class="mt-0.5 text-xs text-slate-500">{m.medicine_catalog_products_hint()}</p>
        </div>
        <button type="button" onclick={() => openProduct()} class="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
          {m.medicine_catalog_add_product()}
        </button>
      </div>

      {#if sortedProducts.length === 0}
        <p class="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm text-slate-500">
          {m.medicine_catalog_no_products()}
        </p>
      {:else}
        <div class="mt-3 grid gap-3 lg:grid-cols-2">
          {#each sortedProducts as product (product.id)}
            <article class="rounded-xl border border-slate-200 bg-white p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h6 class="font-semibold text-slate-900">{localizedMedicineCatalogName(product.names, getLocale(), product.displayName)}</h6>
                  <p class="mt-1 text-xs text-slate-500">
                    {[product.strengthText, product.doseFormText, product.routeText].filter(Boolean).join(' · ') || productTypeLabel(product.productType)}
                  </p>
                </div>
                <button type="button" onclick={() => openProduct(product)} class="shrink-0 text-xs font-semibold text-blue-700 hover:text-blue-800">
                  {m.medicine_catalog_edit_product()}
                </button>
              </div>
              {#if product.ingredients.length}
                <ul class="mt-3 space-y-1 text-xs text-slate-600">
                  {#each product.ingredients as component (component.id)}
                    <li>
                      {localizedMedicineCatalogName(component.ingredient.names, getLocale(), component.ingredient.canonicalName)}
                      {#if medicineIngredientStrength(component)} · {medicineIngredientStrength(component)}{/if}
                      <span class="text-slate-400">({roleLabel(component.role)})</span>
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if product.identifiers.length}
                <p class="mt-3 break-all text-[11px] text-slate-400">
                  {product.identifiers.map((identifier) => `${identifier.system}: ${identifier.code}`).join(' · ')}
                </p>
              {/if}
              <div class="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <span class="text-xs font-medium text-slate-500">{statusLabel(product.status)}</span>
                <details class="text-right" ontoggle={(event) => { if (event.currentTarget.open) void loadVersions(product.id); }}>
                  <summary class="cursor-pointer text-xs font-medium text-slate-500">
                    {versionsLabel(versionCounts[`product:${product.id}`] ?? 0)}
                  </summary>
                  {#if loadedVersions[product.id] === 'failed'}
                    <div class="mt-2 text-left text-xs text-rose-700" role="alert">
                      <p>{m.medicine_catalog_versions_failed()}</p>
                      <button type="button" onclick={() => loadVersions(product.id)} class="mt-1 font-semibold text-blue-700 hover:text-blue-800">{m.medicine_catalog_versions_retry()}</button>
                    </div>
                  {:else if versionRows(product.id).length}
                    <ol class="mt-2 space-y-1 text-left text-[11px] text-slate-500">
                      {#each versionRows(product.id) as revision (revision.id)}
                        <li>{m.medicine_catalog_version_entry({ revision: revision.revision, date: formatDateTime(revision.changedAt) })}</li>
                      {/each}
                    </ol>
                  {/if}
                </details>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="border-t border-slate-200 pt-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h5 class="text-sm font-semibold text-slate-900">{m.medicine_catalog_ingredients()}</h5>
          <p class="mt-0.5 text-xs text-slate-500">{m.medicine_catalog_ingredients_hint()}</p>
        </div>
        <button type="button" onclick={() => openIngredient()} class="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
          {m.medicine_catalog_add_ingredient()}
        </button>
      </div>
      {#if sortedIngredients.length === 0}
        <p class="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm text-slate-500">
          {m.medicine_catalog_no_ingredients()}
        </p>
      {:else}
        <div class="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {#each sortedIngredients as ingredient (ingredient.id)}
            <div class="flex items-start justify-between gap-4 px-4 py-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-slate-800">{localizedMedicineCatalogName(ingredient.names, getLocale(), ingredient.canonicalName)}</p>
                <p class="mt-0.5 break-all text-xs text-slate-500">
                  {statusLabel(ingredient.status)}
                  {#if ingredient.identifiers.length} · {ingredient.identifiers.map((identifier) => `${identifier.system}: ${identifier.code}`).join(' · ')}{/if}
                </p>
              </div>
              <button type="button" onclick={() => openIngredient(ingredient)} class="shrink-0 text-xs font-semibold text-blue-700 hover:text-blue-800">
                {m.medicine_catalog_edit_ingredient()}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</details>

{#if editorKind}
  <div class="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-slate-900/55 backdrop-blur-sm sm:items-center sm:p-6" role="presentation">
    <div class="sheet-enter app-scroll flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" use:editorModal.attach role="dialog" aria-modal="true" aria-labelledby="catalog-editor-title">
      <header class="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
        <div>
          <h2 id="catalog-editor-title" class="text-xl font-semibold text-slate-900">
            {editorKind === 'ingredient'
              ? ingredientDraft.id ? m.medicine_catalog_edit_ingredient() : m.medicine_catalog_add_ingredient()
              : productDraft.id ? m.medicine_catalog_edit_product() : m.medicine_catalog_add_product()}
          </h2>
          <p class="mt-1 text-sm text-slate-500">{m.medicine_catalog_editor_hint()}</p>
        </div>
        <button type="button" onclick={editorModal.requestClose} disabled={saving} class="rounded-full p-2 text-slate-400 hover:bg-white hover:text-slate-700" aria-label={m.close()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-5 w-5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      {#if editorKind === 'ingredient'}
        <form method="POST" action={ingredientDraft.id ? '?/updateMedicineIngredient' : '?/createMedicineIngredient'} use:enhance={submitCatalog} class="app-scroll flex-1 overflow-y-auto">
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="structure" value={ingredientStructure} />
          {#if ingredientDraft.id}<input type="hidden" name="id" value={ingredientDraft.id} /><input type="hidden" name="revision" value={ingredientDraft.revision} />{/if}
          <div class="space-y-6 px-5 py-5 sm:px-6">
            <div class="grid gap-4 sm:grid-cols-3">
              <label class="sm:col-span-2"><span class="field-label">{m.medicine_catalog_canonical_name()}</span><input name="canonicalName" bind:value={ingredientDraft.canonicalName} required maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
              {@render statusSelect(ingredientDraft)}
            </div>
            {@render namesEditor(ingredientDraft.names)}
            {@render identifiersEditor(ingredientDraft.identifiers)}
            <label><span class="field-label">{m.notes()}</span><textarea name="notes" bind:value={ingredientDraft.notes} rows="3" maxlength="4000" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500 resize-y"></textarea></label>
            {#if saveError}<p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{saveError}</p>{/if}
          </div>
          {@render editorFooter()}
        </form>
      {:else}
        <form method="POST" action={productDraft.id ? '?/updateMedicineProduct' : '?/createMedicineProduct'} use:enhance={submitCatalog} class="app-scroll flex-1 overflow-y-auto">
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="structure" value={productStructure} />
          {#if productDraft.id}<input type="hidden" name="id" value={productDraft.id} /><input type="hidden" name="revision" value={productDraft.revision} />{/if}
          <div class="space-y-7 px-5 py-5 sm:px-6">
            <fieldset>
              <legend class="section-label">{m.medicine_catalog_product_identity()}</legend>
              <div class="mt-4 grid gap-4 sm:grid-cols-3">
                <label class="sm:col-span-2"><span class="field-label">{m.medicine_catalog_display_name()}</span><input name="displayName" bind:value={productDraft.displayName} required maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                {@render statusSelect(productDraft)}
                <label><span class="field-label">{m.medicine_catalog_product_type()}</span><select name="productType" bind:value={productDraft.productType} class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500"><option value="branded">{m.medicine_catalog_type_branded()}</option><option value="generic">{m.medicine_catalog_type_generic()}</option><option value="compounded">{m.medicine_catalog_type_compounded()}</option><option value="supplement">{m.medicine_catalog_type_supplement()}</option><option value="other">{m.medicine_catalog_type_other()}</option></select></label>
                <label><span class="field-label">{m.medicine_strength()}</span><input name="strengthText" bind:value={productDraft.strengthText} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_dose_form()}</span><input name="doseFormText" bind:value={productDraft.doseFormText} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_route()}</span><input name="routeText" bind:value={productDraft.routeText} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_terminology_system()}</span><input name="doseFormSystem" bind:value={productDraft.doseFormSystem} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_terminology_code()}</span><input name="doseFormCode" bind:value={productDraft.doseFormCode} maxlength="500" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_route_system()}</span><input name="routeSystem" bind:value={productDraft.routeSystem} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_route_code()}</span><input name="routeCode" bind:value={productDraft.routeCode} maxlength="500" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
              </div>
            </fieldset>

            {@render componentsEditor()}
            {@render namesEditor(productDraft.names)}
            {@render identifiersEditor(productDraft.identifiers)}

            <fieldset class="border-t border-slate-100 pt-6">
              <legend class="section-label">{m.medicine_catalog_market_package()}</legend>
              <div class="mt-4 grid gap-4 sm:grid-cols-2">
                <label><span class="field-label">{m.medicine_catalog_manufacturer()}</span><input name="manufacturer" bind:value={productDraft.manufacturer} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_authorization_holder()}</span><input name="marketingAuthorizationHolder" bind:value={productDraft.marketingAuthorizationHolder} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_market_country()}</span><input name="marketCountry" bind:value={productDraft.marketCountry} maxlength="2" placeholder="JP" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500 uppercase" /></label>
                <label><span class="field-label">{m.medicine_catalog_package()}</span><input name="packageDescription" bind:value={productDraft.packageDescription} maxlength="1000" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_imprint()}</span><input name="imprint" bind:value={productDraft.imprint} maxlength="200" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_color()}</span><input name="color" bind:value={productDraft.color} maxlength="200" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label><span class="field-label">{m.medicine_catalog_shape()}</span><input name="shape" bind:value={productDraft.shape} maxlength="200" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
                <label class="sm:col-span-2"><span class="field-label">{m.notes()}</span><textarea name="notes" bind:value={productDraft.notes} rows="3" maxlength="4000" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500 resize-y"></textarea></label>
              </div>
            </fieldset>
            {#if saveError}<p class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{saveError}</p>{/if}
          </div>
          {@render editorFooter()}
        </form>
      {/if}
      {#if editorKind === 'ingredient' ? ingredientDraft.id : productDraft.id}
        <form
          method="POST"
          action={editorKind === 'ingredient' ? '?/deleteMedicineIngredient' : '?/deleteMedicineProduct'}
          use:enhance={submitDelete}
          class="border-t border-slate-100 px-5 py-3 sm:px-6"
        >
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="id" value={editorKind === 'ingredient' ? ingredientDraft.id : productDraft.id} />
          <input type="hidden" name="revision" value={editorKind === 'ingredient' ? ingredientDraft.revision : productDraft.revision} />
          <button type="submit" disabled={saving || staleRevision} class="text-sm font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50">{m.delete()}</button>
        </form>
      {/if}
    </div>
  </div>
{/if}

{#snippet statusSelect(target: { status: MedicineCatalogStatus })}
  <label><span class="field-label">{m.status()}</span><select name="status" bind:value={target.status} class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500"><option value="active">{m.medicine_catalog_status_active()}</option><option value="inactive">{m.medicine_catalog_status_inactive()}</option><option value="archived">{m.medicine_catalog_status_archived()}</option></select></label>
{/snippet}

{#snippet namesEditor(names: NameDraft[])}
  <fieldset class="border-t border-slate-100 pt-6">
    <legend class="section-label">{m.medicine_catalog_names()}</legend>
    <div class="mt-3 flex justify-end"><button type="button" onclick={() => names.push(emptyName())} class="text-xs font-semibold text-blue-700">{m.medicine_catalog_add_name()}</button></div>
    <div class="mt-4 space-y-3">
      {#each names as name, index (name.localId)}
        <div class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-6">
          <label class="sm:col-span-3"><span class="field-label">{m.medicine_catalog_name()}</span><input bind:value={name.name} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label><span class="field-label">{m.medicine_catalog_language()}</span><input bind:value={name.languageTag} maxlength="100" placeholder="ja" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label><span class="field-label">{m.medicine_catalog_name_type()}</span><select bind:value={name.nameType} class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500"><option value="preferred">{m.medicine_catalog_name_preferred()}</option><option value="brand">{m.medicine_catalog_name_brand()}</option><option value="generic">{m.medicine_catalog_name_generic()}</option><option value="synonym">{m.medicine_catalog_name_synonym()}</option></select></label>
          <label><span class="field-label">{m.medicine_catalog_jurisdiction()}</span><input bind:value={name.jurisdiction} maxlength="2" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500 uppercase" /></label>
          <label class="flex items-center gap-2 sm:col-span-2"><input type="checkbox" bind:checked={name.preferred} class="rounded border-slate-300 text-blue-600" /><span class="text-xs font-medium text-slate-700">{m.medicine_catalog_preferred()}</span></label>
          {@render sourceFields(name)}
          <div class="flex justify-end sm:col-span-6"><button type="button" onclick={() => names.splice(index, 1)} class="text-xs font-semibold text-rose-600">{m.delete()}</button></div>
        </div>
      {/each}
    </div>
  </fieldset>
{/snippet}

{#snippet identifiersEditor(identifiers: IdentifierDraft[])}
  <fieldset class="border-t border-slate-100 pt-6">
    <legend class="section-label">{m.medicine_catalog_identifiers()}</legend>
    <div class="mt-3 flex justify-end"><button type="button" onclick={() => identifiers.push(emptyIdentifier())} class="text-xs font-semibold text-blue-700">{m.medicine_catalog_add_identifier()}</button></div>
    <div class="mt-4 space-y-3">
      {#each identifiers as identifier, index (identifier.localId)}
        <div class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-6">
          <label class="sm:col-span-3"><span class="field-label">{m.medicine_catalog_identifier_system()}</span><input bind:value={identifier.system} maxlength="300" placeholder="RxNorm, YJ, GS1" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label class="sm:col-span-2"><span class="field-label">{m.medicine_catalog_identifier_code()}</span><input bind:value={identifier.code} maxlength="500" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label><span class="field-label">{m.medicine_catalog_jurisdiction()}</span><input bind:value={identifier.jurisdiction} maxlength="2" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500 uppercase" /></label>
          {@render sourceFields(identifier)}
          <div class="flex justify-end sm:col-span-6"><button type="button" onclick={() => identifiers.splice(index, 1)} class="text-xs font-semibold text-rose-600">{m.delete()}</button></div>
        </div>
      {/each}
    </div>
  </fieldset>
{/snippet}

{#snippet sourceFields(source: SourceDraft)}
  <details class="sm:col-span-6">
    <summary class="cursor-pointer text-xs font-medium text-slate-500">{m.medicine_catalog_source()}</summary>
    <div class="mt-3 grid gap-3 sm:grid-cols-4">
      <label><span class="field-label">{m.medicine_catalog_source_kind()}</span><input bind:value={source.sourceKind} maxlength="80" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
      <label><span class="field-label">{m.medicine_catalog_source_provider()}</span><input bind:value={source.sourceProvider} maxlength="200" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
      <label class="sm:col-span-2"><span class="field-label">{m.medicine_catalog_source_url()}</span><input type="url" bind:value={source.sourceUrl} maxlength="2000" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
      <label><span class="field-label">{m.medicine_catalog_retrieved_at()}</span><input type="datetime-local" bind:value={source.sourceRetrievedAt} class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
    </div>
  </details>
{/snippet}

{#snippet componentsEditor()}
  <fieldset class="border-t border-slate-100 pt-6">
    <legend class="section-label">{m.medicine_catalog_ingredients()}</legend>
    <div class="mt-3 flex justify-end"><button type="button" disabled={ingredients.length === 0} onclick={() => productDraft.ingredients.push(emptyComponent())} class="text-xs font-semibold text-blue-700 disabled:text-slate-400">{m.medicine_catalog_add_component()}</button></div>
    {#if ingredients.length === 0}<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{m.medicine_catalog_create_ingredient_first()}</p>{/if}
    <div class="mt-4 space-y-3">
      {#each productDraft.ingredients as component, index (component.localId)}
        <div class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-6">
          <label class="sm:col-span-3"><span class="field-label">{m.medicine_catalog_ingredient()}</span><select bind:value={component.ingredientId} required class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500">{#each sortedIngredients as ingredient (ingredient.id)}<option value={ingredient.id}>{localizedMedicineCatalogName(ingredient.names, getLocale(), ingredient.canonicalName)}</option>{/each}</select></label>
          <label class="sm:col-span-2"><span class="field-label">{m.medicine_catalog_role()}</span><select bind:value={component.role} class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500"><option value="active">{m.medicine_catalog_role_active()}</option><option value="inactive">{m.medicine_catalog_role_inactive()}</option><option value="unknown">{m.medicine_catalog_role_unknown()}</option></select></label>
          <label><span class="field-label">{m.medicine_catalog_strength_text()}</span><input bind:value={component.strengthText} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label><span class="field-label">{m.medicine_catalog_numerator_value()}</span><input inputmode="decimal" bind:value={component.numeratorValue} maxlength="64" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label><span class="field-label">{m.medicine_catalog_numerator_unit()}</span><input bind:value={component.numeratorUnit} maxlength="80" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label><span class="field-label">{m.medicine_catalog_denominator_value()}</span><input inputmode="decimal" bind:value={component.denominatorValue} maxlength="64" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label><span class="field-label">{m.medicine_catalog_denominator_unit()}</span><input bind:value={component.denominatorUnit} maxlength="80" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          <label class="sm:col-span-2"><span class="field-label">{m.medicine_catalog_basis_strength()}</span><input bind:value={component.basisOfStrengthText} maxlength="300" class="field-input shadow-sm focus:border-blue-500 focus:ring-blue-500" /></label>
          {@render sourceFields(component)}
          <div class="flex justify-end sm:col-span-6"><button type="button" onclick={() => productDraft.ingredients.splice(index, 1)} class="text-xs font-semibold text-rose-600">{m.delete()}</button></div>
        </div>
      {/each}
    </div>
  </fieldset>
{/snippet}

{#snippet editorFooter()}
  <footer class="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
    <button type="button" onclick={editorModal.requestClose} disabled={saving} class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{m.cancel()}</button>
    <button type="submit" disabled={saving || staleRevision} class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-400">{saving ? m.saving() : m.save()}</button>
  </footer>
{/snippet}

<style>
  .field-label { margin-bottom: 0.375rem; display: block; font-size: 0.75rem; font-weight: 500; color: rgb(51 65 85); }
  @layer components {
    .field-input { width: 100%; border-radius: 0.5rem; border-color: rgb(203 213 225); padding: 0.625rem 0.75rem; font-size: 0.875rem; }
  }
  .section-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; color: rgb(100 116 139); }
</style>
