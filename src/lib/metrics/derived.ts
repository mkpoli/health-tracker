import { getCalculatedMetricDefinitions, type MetricDefinition } from './catalog';

export type DerivedPoint = {
  reportId: string;
  definition: MetricDefinition;
  value: number;
  precision: number;
  unit: string | null;
};

function reportTime(report: { testDate?: string | null }) {
  return report.testDate ? new Date(report.testDate).getTime() : 0;
}

/**
 * Computes every catalog metric that is defined as a calculation over other
 * metrics. Dependencies listed as `carryForward` may come from an earlier
 * report — height is measured once and still applies at the next weigh-in —
 * so reports are walked oldest first with a running memory of what is known.
 */
export function computeDerivedMetrics(
  reports: Array<{ id: string; testDate?: string | null }>,
  valuesByReport: Map<string, Map<string, number>>,
): DerivedPoint[] {
  const ordered = [...reports].sort((a, b) => reportTime(a) - reportTime(b));
  const derived: DerivedPoint[] = [];

  for (const definition of getCalculatedMetricDefinitions()) {
    const calculation = definition.calculation;
    if (!calculation) continue;

    const carryForward = new Set(calculation.carryForward || []);
    const lastKnown = new Map<string, number>();

    for (const report of ordered) {
      const values = valuesByReport.get(report.id);

      if (values) {
        for (const [key, value] of values) lastKnown.set(key, value);
      }

      // A directly recorded value always wins over the calculated one.
      if (values?.has(definition.key)) continue;

      const inputs: Record<string, number> = {};
      let missing = false;

      for (const dependency of calculation.dependencies) {
        const direct = values?.get(dependency);
        const value = direct ?? (carryForward.has(dependency) ? lastKnown.get(dependency) : undefined);

        if (value === undefined) {
          missing = true;
          break;
        }

        inputs[dependency] = value;
      }

      if (missing) continue;

      const computed = calculation.compute(inputs);
      if (computed === null || !Number.isFinite(computed)) continue;

      const precision = calculation.precision ?? 2;

      derived.push({
        reportId: report.id,
        definition,
        value: Number(computed.toFixed(precision)),
        precision,
        unit: calculation.unit ?? null,
      });
    }
  }

  return derived;
}
