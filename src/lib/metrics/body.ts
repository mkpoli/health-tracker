import type { MetricDefinition } from './catalog';
import { toMeasurementField, type MeasurementField, type MeasurementFieldSource } from './measurement-fields';

// Body measurements are entered by hand rather than parsed out of a lab report,
// so each definition carries the input affordances the logging form needs: a
// default unit, the alternative units a scale or tape may report, and a sensible
// numeric step. Limb measurements are `sided`, which expands into a left and a
// right variant alongside the unsided base.

export type BodyMetricGroupKey = 'basics' | 'composition' | 'circumference' | 'skinfold' | 'index';

export type BodyMetricSource = MeasurementFieldSource & { group: BodyMetricGroupKey };

const MASS_UNITS = ['kg', 'lb'];
const LENGTH_UNITS = ['cm', 'in'];

const bodyMetricSources: BodyMetricSource[] = [
  // Basics
  {
    key: 'body-weight',
    canonicalLabel: 'Body Weight',
    group: 'basics',
    categories: ['anthropometry'],
    unit: 'kg',
    unitOptions: MASS_UNITS,
    step: 0.1,
    common: true,
    aliases: ['weight', 'body weight', 'body mass', '体重', '体重（kg）', '体 重'],
    wikidataId: 'Q620876',
  },
  {
    key: 'height',
    canonicalLabel: 'Height',
    group: 'basics',
    categories: ['anthropometry'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    common: true,
    aliases: ['height', 'body height', 'stature', '身長', '身高'],
    wikidataId: 'Q476112',
  },
  {
    key: 'sitting-height',
    canonicalLabel: 'Sitting Height',
    group: 'basics',
    categories: ['anthropometry'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    aliases: ['sitting height', '座高'],
  },
  {
    key: 'arm-span',
    canonicalLabel: 'Arm Span',
    group: 'basics',
    categories: ['anthropometry'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    aliases: ['arm span', 'wingspan', '指極', '両手を広げた長さ'],
  },
  {
    key: 'shoulder-width',
    canonicalLabel: 'Shoulder Width',
    group: 'basics',
    categories: ['anthropometry'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    aliases: ['shoulder width', 'biacromial breadth', '肩幅'],
  },
  {
    key: 'inseam',
    canonicalLabel: 'Inseam',
    group: 'basics',
    categories: ['anthropometry'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    aliases: ['inseam', 'inside leg', '股下'],
  },
  {
    key: 'foot-length',
    canonicalLabel: 'Foot Length',
    group: 'basics',
    categories: ['anthropometry'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['foot length', '足長'],
  },
  {
    key: 'hand-length',
    canonicalLabel: 'Hand Length',
    group: 'basics',
    categories: ['anthropometry'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['hand length', '手長'],
  },

  // Composition
  {
    key: 'body-fat-percentage',
    canonicalLabel: 'Body Fat Percentage',
    group: 'composition',
    categories: ['body-composition'],
    unit: '%',
    step: 0.1,
    common: true,
    aliases: ['body fat', 'body fat percentage', 'bodyfat', 'fat percentage', '体脂肪率', '体脂肪'],
    wikidataId: 'Q797258',
  },
  {
    key: 'fat-mass',
    canonicalLabel: 'Fat Mass',
    group: 'composition',
    categories: ['body-composition'],
    unit: 'kg',
    unitOptions: MASS_UNITS,
    step: 0.1,
    aliases: ['fat mass', '体脂肪量'],
  },
  {
    key: 'lean-body-mass',
    canonicalLabel: 'Lean Body Mass',
    group: 'composition',
    categories: ['body-composition'],
    unit: 'kg',
    unitOptions: MASS_UNITS,
    step: 0.1,
    common: true,
    aliases: ['lean body mass', 'lbm', 'fat free mass', 'ffm', '除脂肪体重'],
    wikidataId: 'Q17064264',
  },
  {
    key: 'skeletal-muscle-mass',
    canonicalLabel: 'Skeletal Muscle Mass',
    group: 'composition',
    categories: ['body-composition', 'muscle'],
    unit: 'kg',
    unitOptions: MASS_UNITS,
    step: 0.1,
    common: true,
    aliases: ['skeletal muscle mass', 'smm', 'muscle mass', '筋肉量', '骨格筋量'],
  },
  {
    key: 'muscle-mass-percentage',
    canonicalLabel: 'Muscle Mass Percentage',
    group: 'composition',
    categories: ['body-composition', 'muscle'],
    unit: '%',
    step: 0.1,
    aliases: ['muscle mass percentage', 'muscle percentage', '筋肉率'],
  },
  {
    key: 'body-water-percentage',
    canonicalLabel: 'Body Water Percentage',
    group: 'composition',
    categories: ['body-composition'],
    unit: '%',
    step: 0.1,
    aliases: ['body water percentage', 'total body water percentage', '体水分率'],
  },
  {
    key: 'total-body-water',
    canonicalLabel: 'Total Body Water',
    group: 'composition',
    categories: ['body-composition'],
    unit: 'L',
    step: 0.1,
    aliases: ['total body water', 'tbw', '体水分量'],
  },
  {
    key: 'bone-mass',
    canonicalLabel: 'Bone Mass',
    group: 'composition',
    categories: ['body-composition', 'mineral'],
    unit: 'kg',
    unitOptions: MASS_UNITS,
    step: 0.1,
    aliases: ['bone mass', '推定骨量', '骨量'],
  },
  {
    key: 'bone-mineral-density',
    canonicalLabel: 'Bone Mineral Density',
    group: 'composition',
    categories: ['body-composition', 'mineral'],
    unit: 'g/cm^2',
    step: 0.001,
    aliases: ['bone mineral density', 'bmd', '骨密度'],
    wikidataId: 'Q2304401',
  },
  {
    key: 'visceral-fat-level',
    canonicalLabel: 'Visceral Fat Level',
    group: 'composition',
    categories: ['body-composition'],
    unit: null,
    step: 0.5,
    common: true,
    aliases: ['visceral fat level', 'visceral fat rating', '内臓脂肪レベル'],
  },
  {
    key: 'visceral-fat-area',
    canonicalLabel: 'Visceral Fat Area',
    group: 'composition',
    categories: ['body-composition'],
    unit: 'cm^2',
    step: 0.1,
    aliases: ['visceral fat area', 'vfa', '内臓脂肪面積'],
  },
  {
    key: 'subcutaneous-fat-percentage',
    canonicalLabel: 'Subcutaneous Fat Percentage',
    group: 'composition',
    categories: ['body-composition'],
    unit: '%',
    step: 0.1,
    aliases: ['subcutaneous fat percentage', '皮下脂肪率'],
  },
  {
    key: 'protein-percentage',
    canonicalLabel: 'Protein Percentage',
    group: 'composition',
    categories: ['body-composition', 'protein'],
    unit: '%',
    step: 0.1,
    aliases: ['protein percentage', 'タンパク質率'],
  },
  {
    key: 'basal-metabolic-rate',
    canonicalLabel: 'Basal Metabolic Rate',
    group: 'composition',
    categories: ['body-composition', 'metabolism'],
    unit: 'kcal/day',
    step: 1,
    aliases: ['basal metabolic rate', 'bmr', '基礎代謝量'],
    wikidataId: 'Q623293',
  },
  {
    key: 'metabolic-age',
    canonicalLabel: 'Metabolic Age',
    group: 'composition',
    categories: ['body-composition', 'metabolism'],
    unit: 'years',
    step: 1,
    aliases: ['metabolic age', '体内年齢'],
  },
  {
    key: 'phase-angle',
    canonicalLabel: 'Phase Angle',
    group: 'composition',
    categories: ['body-composition'],
    unit: 'deg',
    step: 0.1,
    aliases: ['phase angle', '位相角'],
  },

  // Circumferences
  {
    key: 'neck-circumference',
    canonicalLabel: 'Neck Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    aliases: ['neck circumference', 'neck', '首囲'],
  },
  {
    key: 'shoulder-circumference',
    canonicalLabel: 'Shoulder Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    aliases: ['shoulder circumference', '肩囲'],
  },
  {
    key: 'chest-circumference',
    canonicalLabel: 'Chest Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    common: true,
    aliases: ['chest circumference', 'chest', '胸囲'],
  },
  {
    key: 'bust-circumference',
    canonicalLabel: 'Bust Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    common: true,
    aliases: ['bust circumference', 'bust', 'upper bust', 'top bust', 'upper chest', 'トップバスト', '上胸围'],
  },
  {
    key: 'underbust-circumference',
    canonicalLabel: 'Underbust Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    common: true,
    aliases: [
      'underbust circumference',
      'underbust',
      'under bust',
      'lower bust',
      'lower chest',
      'ribcage',
      'アンダーバスト',
      '下胸围',
    ],
  },
  {
    key: 'waist-circumference',
    canonicalLabel: 'Waist Circumference',
    group: 'circumference',
    categories: ['circumference', 'cardiometabolic'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    common: true,
    aliases: ['waist circumference', 'waist', 'ウエスト', '腰围'],
    wikidataId: 'Q811148',
  },
  {
    // 腹囲 in a Japanese checkup is taken at the navel, which is this metric
    // rather than the rib-to-hip midpoint above, and it is what the JASSO
    // metabolic-syndrome thresholds apply to.
    key: 'abdominal-circumference',
    canonicalLabel: 'Abdominal Circumference',
    group: 'circumference',
    categories: ['circumference', 'cardiometabolic'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    common: true,
    aliases: ['abdominal circumference', 'navel circumference', '腹囲', 'へそ周り', '腹围'],
  },
  {
    key: 'hip-circumference',
    canonicalLabel: 'Hip Circumference',
    group: 'circumference',
    categories: ['circumference', 'cardiometabolic'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    common: true,
    aliases: ['hip circumference', 'hips', 'ヒップ', '臀囲'],
  },
  {
    key: 'thigh-circumference',
    canonicalLabel: 'Thigh Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['thigh circumference', 'thigh', '大腿囲'],
  },
  {
    key: 'knee-circumference',
    canonicalLabel: 'Knee Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['knee circumference', '膝囲'],
  },
  {
    key: 'calf-circumference',
    canonicalLabel: 'Calf Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['calf circumference', 'calf', '下腿囲', 'ふくらはぎ'],
  },
  {
    key: 'upper-arm-circumference',
    canonicalLabel: 'Upper Arm Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['upper arm circumference', 'arm circumference', 'mid upper arm circumference', 'muac', '上腕囲'],
  },
  {
    key: 'flexed-arm-circumference',
    canonicalLabel: 'Flexed Arm Circumference',
    group: 'circumference',
    categories: ['circumference', 'muscle'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['flexed arm circumference', 'flexed bicep', '力こぶ周囲'],
  },
  {
    key: 'forearm-circumference',
    canonicalLabel: 'Forearm Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['forearm circumference', '前腕囲'],
  },
  {
    key: 'wrist-circumference',
    canonicalLabel: 'Wrist Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['wrist circumference', '手首囲'],
  },
  {
    key: 'ankle-circumference',
    canonicalLabel: 'Ankle Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    sided: true,
    aliases: ['ankle circumference', '足首囲'],
  },
  {
    key: 'head-circumference',
    canonicalLabel: 'Head Circumference',
    group: 'circumference',
    categories: ['circumference'],
    unit: 'cm',
    unitOptions: LENGTH_UNITS,
    step: 0.1,
    aliases: ['head circumference', '頭囲'],
    wikidataId: 'Q23303401',
  },

  // Skinfolds
  {
    key: 'skinfold-triceps',
    canonicalLabel: 'Triceps Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['triceps skinfold', '上腕三頭筋皮下脂肪厚'],
  },
  {
    key: 'skinfold-biceps',
    canonicalLabel: 'Biceps Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['biceps skinfold', '上腕二頭筋皮下脂肪厚'],
  },
  {
    key: 'skinfold-subscapular',
    canonicalLabel: 'Subscapular Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['subscapular skinfold', '肩甲骨下部皮下脂肪厚'],
  },
  {
    key: 'skinfold-suprailiac',
    canonicalLabel: 'Suprailiac Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['suprailiac skinfold', '腸骨上部皮下脂肪厚'],
  },
  {
    key: 'skinfold-abdominal',
    canonicalLabel: 'Abdominal Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['abdominal skinfold', '腹部皮下脂肪厚'],
  },
  {
    key: 'skinfold-chest',
    canonicalLabel: 'Chest Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['chest skinfold', 'pectoral skinfold', '胸部皮下脂肪厚'],
  },
  {
    key: 'skinfold-midaxillary',
    canonicalLabel: 'Midaxillary Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['midaxillary skinfold', '腋窩中線皮下脂肪厚'],
  },
  {
    key: 'skinfold-thigh',
    canonicalLabel: 'Thigh Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['thigh skinfold', '大腿皮下脂肪厚'],
  },
  {
    key: 'skinfold-calf',
    canonicalLabel: 'Calf Skinfold',
    group: 'skinfold',
    categories: ['skinfold', 'body-composition'],
    unit: 'mm',
    step: 0.1,
    aliases: ['calf skinfold', '下腿皮下脂肪厚'],
  },
];

// Derived indices. Height and weight are rarely recorded together — height gets
// measured once and then stays put — so the dependencies that persist between
// sessions are marked `carryForward` and may come from an earlier entry.
const bodyIndexSources: BodyMetricSource[] = [
  {
    key: 'bmi',
    canonicalLabel: 'BMI',
    group: 'index',
    categories: ['body-index', 'cardiometabolic'],
    unit: 'kg/m^2',
    aliases: ['bmi', 'body mass index', '体格指数', 'ボディマス指数'],
    wikidataId: 'Q131191',
    calculation: {
      dependencies: ['body-weight', 'height'],
      carryForward: ['height'],
      compute: (inputs) => {
        const weight = inputs['body-weight'];
        const heightCm = inputs['height'];
        if (!Number.isFinite(weight) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
        const heightM = heightCm / 100;
        return weight / (heightM * heightM);
      },
      unit: 'kg/m^2',
      precision: 1,
    },
  },
  {
    key: 'waist-to-hip-ratio',
    canonicalLabel: 'Waist-to-Hip Ratio',
    group: 'index',
    categories: ['body-index', 'cardiometabolic'],
    unit: null,
    aliases: ['waist to hip ratio', 'whr', 'ウエストヒップ比'],
    wikidataId: 'Q876152',
    calculation: {
      // Both measured in the same session: unlike height, hips change, and a
      // ratio built from a months-old hip would read as a fresh measurement.
      dependencies: ['waist-circumference', 'hip-circumference'],
      compute: (inputs) => {
        const waist = inputs['waist-circumference'];
        const hip = inputs['hip-circumference'];
        if (!Number.isFinite(waist) || !Number.isFinite(hip) || hip === 0) return null;
        return waist / hip;
      },
      unit: null,
      precision: 2,
    },
  },
  {
    key: 'waist-to-height-ratio',
    canonicalLabel: 'Waist-to-Height Ratio',
    group: 'index',
    categories: ['body-index', 'cardiometabolic'],
    unit: null,
    aliases: ['waist to height ratio', 'whtr', 'ウエスト身長比'],
    calculation: {
      dependencies: ['waist-circumference', 'height'],
      carryForward: ['height'],
      compute: (inputs) => {
        const waist = inputs['waist-circumference'];
        const height = inputs['height'];
        if (!Number.isFinite(waist) || !Number.isFinite(height) || height === 0) return null;
        return waist / height;
      },
      unit: null,
      precision: 2,
    },
  },
  {
    key: 'body-surface-area',
    canonicalLabel: 'Body Surface Area',
    group: 'index',
    categories: ['body-index'],
    unit: 'm^2',
    aliases: ['body surface area', 'bsa', '体表面積'],
    wikidataId: 'Q1796666',
    calculation: {
      // Du Bois & Du Bois (1916): BSA = 0.007184 × weight^0.425 × height^0.725
      dependencies: ['body-weight', 'height'],
      carryForward: ['height'],
      compute: (inputs) => {
        const weight = inputs['body-weight'];
        const height = inputs['height'];
        if (!Number.isFinite(weight) || !Number.isFinite(height) || weight <= 0 || height <= 0) return null;
        return 0.007184 * Math.pow(weight, 0.425) * Math.pow(height, 0.725);
      },
      unit: 'm^2',
      precision: 2,
    },
  },
  {
    key: 'bust-underbust-difference',
    canonicalLabel: 'Bust−Underbust Difference',
    group: 'index',
    categories: ['body-index'],
    unit: 'cm',
    aliases: ['bust underbust difference', 'top under difference', 'トップアンダー差'],
    calculation: {
      // Both measured together: breast size changes, so carrying either value
      // forward would report a difference that was never measured.
      dependencies: ['bust-circumference', 'underbust-circumference'],
      compute: (inputs) => {
        const bust = inputs['bust-circumference'];
        const underbust = inputs['underbust-circumference'];
        if (!Number.isFinite(bust) || !Number.isFinite(underbust)) return null;
        return bust - underbust;
      },
      unit: 'cm',
      precision: 1,
    },
  },
  {
    key: 'fat-free-mass-index',
    canonicalLabel: 'Fat-Free Mass Index',
    group: 'index',
    categories: ['body-index', 'muscle'],
    unit: 'kg/m^2',
    aliases: ['fat free mass index', 'ffmi', '除脂肪量指数'],
    calculation: {
      dependencies: ['lean-body-mass', 'height'],
      carryForward: ['height'],
      compute: (inputs) => {
        const lean = inputs['lean-body-mass'];
        const heightCm = inputs['height'];
        if (!Number.isFinite(lean) || !Number.isFinite(heightCm) || heightCm <= 0) return null;
        const heightM = heightCm / 100;
        return lean / (heightM * heightM);
      },
      unit: 'kg/m^2',
      precision: 1,
    },
  },
];

// The side goes in front rather than in a trailing "(Left)": the catalog's key
// normalizer drops parenthesised text, which would collapse both variants onto
// the base metric and make them indistinguishable.
function sidedVariant(source: BodyMetricSource, side: 'left' | 'right'): BodyMetricSource {
  const prefix = side === 'left' ? 'Left' : 'Right';

  return {
    ...source,
    key: `${source.key}-${side}`,
    canonicalLabel: `${prefix} ${source.canonicalLabel}`,
    sided: false,
    common: false,
    // Only the ASCII aliases take an English side suffix; appending " left" to
    // 上腕囲 would just put a form nobody writes into the match index.
    aliases: (source.aliases || [])
      .filter((alias) => /^[\x20-\x7e]+$/.test(alias))
      .map((alias) => `${alias} ${side}`),
  };
}

function toMetricDefinition(source: BodyMetricSource, sideOf?: { baseKey: string; side: 'left' | 'right' }): MetricDefinition {
  return {
    key: source.key,
    canonicalLabel: source.canonicalLabel,
    testType: 'body',
    categories: source.categories,
    aliases: source.aliases,
    wikidataId: source.wikidataId,
    unit: source.unit ?? null,
    unitOptions: source.unitOptions,
    step: source.step,
    calculation: source.calculation,
    sideOf,
  };
}

const expandedSources: Array<{ source: BodyMetricSource; sideOf?: { baseKey: string; side: 'left' | 'right' } }> = [];

for (const source of [...bodyMetricSources, ...bodyIndexSources]) {
  expandedSources.push({ source });

  if (source.sided) {
    expandedSources.push({
      source: sidedVariant(source, 'left'),
      sideOf: { baseKey: source.key, side: 'left' },
    });
    expandedSources.push({
      source: sidedVariant(source, 'right'),
      sideOf: { baseKey: source.key, side: 'right' },
    });
  }
}

export const bodyMetricDefinitions: MetricDefinition[] = expandedSources.map(({ source, sideOf }) =>
  toMetricDefinition(source, sideOf),
);

export const bodyMetricGroupOrder: BodyMetricGroupKey[] = [
  'basics',
  'composition',
  'circumference',
  'skinfold',
  'index',
];
export const bodyMetricFields: MeasurementField[] = bodyMetricSources.map(toMeasurementField);

// Groups the logging form can actually render. Derived indices carry a
// `calculation` and are therefore absent from `bodyMetricFields`, so their group
// would always come out empty.
export const bodyMetricFormGroups: BodyMetricGroupKey[] = bodyMetricGroupOrder.filter((group) =>
  bodyMetricFields.some((field) => field.group === group),
);
