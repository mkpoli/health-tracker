import type { MetricDefinition } from './catalog';
import type { MeasurementFieldSource } from './measurement-fields';

// Vital signs: measured at home with a cuff, thermometer or oximeter, or read
// off a clinic monitor. Blood pressure is two numbers rather than one "120/80"
// string so each side trends on its own and the derived pressures can be
// computed from them.

export const vitalMetricSources: MeasurementFieldSource[] = [
  {
    key: 'systolic-blood-pressure',
    canonicalLabel: 'Systolic Blood Pressure',
    group: 'circulation',
    categories: ['blood-pressure', 'cardiometabolic'],
    unit: 'mmHg',
    step: 1,
    common: true,
    aliases: ['systolic', 'systolic blood pressure', 'sbp', '収縮期血圧', '最高血圧', '收缩压'],
    wikidataId: 'Q82984',
  },
  {
    key: 'diastolic-blood-pressure',
    canonicalLabel: 'Diastolic Blood Pressure',
    group: 'circulation',
    categories: ['blood-pressure', 'cardiometabolic'],
    unit: 'mmHg',
    step: 1,
    common: true,
    aliases: ['diastolic', 'diastolic blood pressure', 'dbp', '拡張期血圧', '最低血圧', '舒张压'],
  },
  {
    key: 'pulse-rate',
    canonicalLabel: 'Pulse Rate',
    group: 'circulation',
    categories: ['heart', 'cardiometabolic'],
    unit: 'bpm',
    step: 1,
    common: true,
    aliases: ['pulse', 'pulse rate', 'heart rate', 'hr', '脈拍', '心拍数', '脉搏', '心率'],
    wikidataId: 'Q13350736',
  },
  {
    key: 'resting-heart-rate',
    canonicalLabel: 'Resting Heart Rate',
    group: 'circulation',
    categories: ['heart', 'cardiometabolic'],
    unit: 'bpm',
    step: 1,
    aliases: ['resting heart rate', 'rhr', '安静時心拍数', '静息心率'],
  },
  {
    key: 'heart-rate-variability',
    canonicalLabel: 'Heart Rate Variability',
    group: 'circulation',
    categories: ['heart'],
    unit: 'ms',
    step: 1,
    aliases: ['heart rate variability', 'hrv', 'sdnn', '心拍変動', '心率变异性'],
  },
  {
    key: 'oxygen-saturation',
    canonicalLabel: 'Oxygen Saturation',
    group: 'respiration',
    categories: ['respiratory'],
    unit: '%',
    step: 1,
    common: true,
    aliases: ['oxygen saturation', 'spo2', 'sao2', '酸素飽和度', '血氧饱和度'],
    wikidataId: 'Q1094504',
  },
  {
    key: 'respiratory-rate',
    canonicalLabel: 'Respiratory Rate',
    group: 'respiration',
    categories: ['respiratory'],
    unit: '/min',
    step: 1,
    aliases: ['respiratory rate', 'breathing rate', '呼吸数', '呼吸频率'],
  },
  {
    key: 'body-temperature',
    canonicalLabel: 'Body Temperature',
    group: 'general',
    categories: ['temperature'],
    unit: '°C',
    unitOptions: ['°C', '°F'],
    step: 0.1,
    common: true,
    aliases: ['body temperature', 'temperature', 'temp', '体温', '検温'],
    wikidataId: 'Q1417571',
  },
  {
    key: 'blood-glucose-self-measured',
    canonicalLabel: 'Self-Measured Blood Glucose',
    group: 'general',
    categories: ['glucose', 'diabetes'],
    unit: 'mg/dL',
    unitOptions: ['mg/dL', 'mmol/L'],
    step: 1,
    aliases: ['self measured blood glucose', 'smbg', 'fingerstick glucose', '自己測定血糖', '自测血糖'],
  },

  // Read off an ECG report rather than measured directly.
  {
    key: 'ecg-heart-rate',
    canonicalLabel: 'ECG Heart Rate',
    group: 'ecg',
    categories: ['heart', 'ecg'],
    unit: 'bpm',
    step: 1,
    aliases: ['ecg heart rate', 'ekg heart rate', '心電図心拍数'],
  },
  {
    key: 'pr-interval',
    canonicalLabel: 'PR Interval',
    group: 'ecg',
    categories: ['heart', 'ecg'],
    unit: 'ms',
    step: 1,
    aliases: ['pr interval', 'pq interval', 'pr間隔'],
  },
  {
    key: 'qrs-duration',
    canonicalLabel: 'QRS Duration',
    group: 'ecg',
    categories: ['heart', 'ecg'],
    unit: 'ms',
    step: 1,
    aliases: ['qrs duration', 'qrs幅'],
  },
  {
    key: 'qt-interval',
    canonicalLabel: 'QT Interval',
    group: 'ecg',
    categories: ['heart', 'ecg'],
    unit: 'ms',
    step: 1,
    aliases: ['qt interval', 'qt間隔'],
  },
  {
    key: 'qtc-interval',
    canonicalLabel: 'QTc Interval',
    group: 'ecg',
    categories: ['heart', 'ecg'],
    unit: 'ms',
    step: 1,
    aliases: ['qtc', 'corrected qt interval', '補正qt間隔'],
  },
];

export const vitalIndexSources: MeasurementFieldSource[] = [
  {
    key: 'pulse-pressure',
    canonicalLabel: 'Pulse Pressure',
    group: 'index',
    categories: ['blood-pressure', 'cardiometabolic'],
    unit: 'mmHg',
    aliases: ['pulse pressure', '脈圧', '脉压'],
    calculation: {
      dependencies: ['systolic-blood-pressure', 'diastolic-blood-pressure'],
      compute: (inputs) => {
        const systolic = inputs['systolic-blood-pressure'];
        const diastolic = inputs['diastolic-blood-pressure'];
        if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return null;
        return systolic - diastolic;
      },
      unit: 'mmHg',
      precision: 0,
    },
  },
  {
    key: 'mean-arterial-pressure',
    canonicalLabel: 'Mean Arterial Pressure',
    group: 'index',
    categories: ['blood-pressure', 'cardiometabolic'],
    unit: 'mmHg',
    aliases: ['mean arterial pressure', 'map', '平均血圧', '平均动脉压'],
    calculation: {
      // The standard bedside estimate: diastolic + one third of pulse pressure.
      dependencies: ['systolic-blood-pressure', 'diastolic-blood-pressure'],
      compute: (inputs) => {
        const systolic = inputs['systolic-blood-pressure'];
        const diastolic = inputs['diastolic-blood-pressure'];
        if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return null;
        return diastolic + (systolic - diastolic) / 3;
      },
      unit: 'mmHg',
      precision: 0,
    },
  },
];

export const vitalMetricDefinitions: MetricDefinition[] = [...vitalMetricSources, ...vitalIndexSources].map(
  (source) => ({
    key: source.key,
    canonicalLabel: source.canonicalLabel,
    testType: 'vital',
    categories: source.categories,
    aliases: source.aliases,
    wikidataId: source.wikidataId,
    unit: source.unit ?? null,
    unitOptions: source.unitOptions,
    step: source.step,
    calculation: source.calculation,
  }),
);
