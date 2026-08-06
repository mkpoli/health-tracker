import * as m from '$lib/paraglide/messages.js';
import {
  getMetricDefinition,
  getMetricDefinitionByKey,
  getMetricMessageKey,
  type MetricDefinition,
} from './catalog';

// Message ids are derived from catalog keys, so the lookup has to be dynamic.
function getMetricMessage(messageKey: string) {
  const lookup = m as unknown as Record<string, (inputs?: Record<string, never>) => string>;
  const message = lookup[messageKey];
  return typeof message === 'function' ? message({}) : '';
}

export function getCategoryLabel(category: string) {
  return getMetricMessage(`metric_category_${category.replace(/-/g, '_')}`) || category;
}

export function getTestTypeLabel(testType: string) {
  return getMetricMessage(`metric_test_type_${testType.replace(/-/g, '_')}`) || testType;
}

export function getDefinitionLabel(definition: MetricDefinition): string {
  if (definition.sideOf) {
    const base = getMetricDefinitionByKey(definition.sideOf.baseKey);
    const baseLabel = base ? getDefinitionLabel(base) : definition.canonicalLabel;

    return definition.sideOf.side === 'left'
      ? m.body_side_left({ metric: baseLabel })
      : m.body_side_right({ metric: baseLabel });
  }

  return getMetricMessage(getMetricMessageKey(definition, 'label')) || definition.canonicalLabel;
}

export function getDefinitionDescription(definition: MetricDefinition): string {
  const base = definition.sideOf ? getMetricDefinitionByKey(definition.sideOf.baseKey) : null;
  const target = base || definition;

  return getMetricMessage(getMetricMessageKey(target, 'description')) || m.custom_metric_description();
}

export function getMetricLabel(label?: string | null) {
  return getDefinitionLabel(getMetricDefinition(label));
}

export function getMetricDescription(label?: string | null) {
  return getDefinitionDescription(getMetricDefinition(label));
}
