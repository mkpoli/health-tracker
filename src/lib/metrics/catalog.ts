export type MetricDefinition = {
  key: string;
  canonicalLabel: string;
  testType?: 'blood' | 'urine' | 'other';
  categories?: string[];
  aliases?: string[];
  wikidataId?: string;
  custom?: boolean;
};

const metricCatalog: MetricDefinition[] = [
  { key: 'triglycerides', canonicalLabel: 'Triglycerides', testType: 'blood', categories: ['fat', 'metabolism'], aliases: ['triglyceride', 'tg', '中性脂肪', 'tg 中性脂肪'] },
  { key: 'acth', canonicalLabel: 'ACTH', testType: 'blood', categories: ['hormone', 'endocrine'], aliases: ['acth'] },
  { key: 'ckd-stage', canonicalLabel: 'CKD Stage', testType: 'other', categories: ['kidney', 'renal'], aliases: ['ckd stage', 'ckdステージ'] },
  { key: 'cortisol', canonicalLabel: 'Cortisol', testType: 'blood', categories: ['hormone', 'adrenal', 'endocrine'], aliases: ['cortisol', 'ｺﾙﾁｿﾞｰﾙ'] },
  { key: 'd-dimer', canonicalLabel: 'D-Dimer', testType: 'blood', categories: ['coagulation'], aliases: ['d dimer', 'd-ダイマー'] },
  { key: 'fib-4-index', canonicalLabel: 'FIB-4 Index', testType: 'other', categories: ['liver', 'fibrosis'], aliases: ['fib-4 index', 'fib 4 index'] },
  { key: 'free-t3', canonicalLabel: 'Free T3', testType: 'blood', categories: ['hormone', 'thyroid', 'endocrine'], aliases: ['free t3', 'ft3'] },
  { key: 'free-t4', canonicalLabel: 'Free T4', testType: 'blood', categories: ['hormone', 'thyroid', 'endocrine'], aliases: ['free t4', 'ft4'] },
  { key: 'fsh', canonicalLabel: 'FSH', testType: 'blood', categories: ['hormone', 'sexual', 'endocrine'], aliases: ['fsh'] },
  { key: 'growth-hormone', canonicalLabel: 'Growth Hormone', testType: 'blood', categories: ['hormone', 'pituitary', 'endocrine'], aliases: ['growth hormone', 'gh', '血中gh'] },
  { key: 'igf-1', canonicalLabel: 'IGF-1', testType: 'blood', categories: ['hormone', 'growth', 'endocrine'], aliases: ['igf-1', 'igf 1', 'igf-1 ｿﾏﾄﾒｼﾞﾝc'] },
  { key: 'lh', canonicalLabel: 'LH', testType: 'blood', categories: ['hormone', 'sexual', 'endocrine'], aliases: ['lh'] },
  { key: 'lymphocyte-count', canonicalLabel: 'Lymphocyte Count', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['lymphocyte count', 'ﾘﾝﾊﾟ球数'] },
  { key: 'metamyelocytes', canonicalLabel: 'Metamyelocytes', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['metamyelocytes', '後骨髄球'] },
  { key: 'myelocytes', canonicalLabel: 'Myelocytes', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['myelocytes', '骨髄球'] },
  { key: 'neutrophil-count', canonicalLabel: 'Neutrophil Count', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['neutrophil count', '好中球数'] },
  { key: 'nitrite', canonicalLabel: 'Nitrite', testType: 'urine', categories: ['urinalysis', 'infection'], aliases: ['nitrite', '亜硝酸塩'] },
  { key: 'occult-blood', canonicalLabel: 'Occult Blood', testType: 'urine', categories: ['urinalysis'], aliases: ['occult blood', '潜血'] },
  { key: 'prolactin', canonicalLabel: 'Prolactin', testType: 'blood', categories: ['hormone', 'pituitary', 'endocrine'], aliases: ['prolactin', 'ﾌﾟﾛﾗｸﾁﾝ'] },
  { key: 'testosterone', canonicalLabel: 'Testosterone', testType: 'blood', categories: ['hormone', 'sexual', 'endocrine'], aliases: ['testosterone', '血中ﾃｽﾄｽﾃﾛﾝ'] },
  { key: 'total-cholesterol', canonicalLabel: 'Total Cholesterol', testType: 'blood', categories: ['fat', 'cardiometabolic'], aliases: ['total cholesterol', '総ｺﾚｽﾃﾛｰﾙ'] },
  { key: 'tsh', canonicalLabel: 'TSH', testType: 'blood', categories: ['hormone', 'thyroid', 'endocrine'], aliases: ['tsh'] },
  { key: 'urine-bilirubin', canonicalLabel: 'Urine Bilirubin', testType: 'urine', categories: ['urinalysis', 'liver'], aliases: ['urine bilirubin', 'bilirubin urine', 'ﾋﾞﾘﾙﾋﾞﾝ'] },
  { key: 'urine-glucose', canonicalLabel: 'Urine Glucose', testType: 'urine', categories: ['urinalysis', 'glucose'], aliases: ['urine glucose', 'glucose urine', '糖'] },
  { key: 'urine-ketones', canonicalLabel: 'Urine Ketones', testType: 'urine', categories: ['urinalysis', 'metabolism'], aliases: ['urine ketones', 'ketones urine', 'ｹﾄﾝ体'] },
  { key: 'urine-ph', canonicalLabel: 'Urine pH', testType: 'urine', categories: ['urinalysis'], aliases: ['urine ph', 'ph urine', 'ph'] },
  { key: 'urine-protein', canonicalLabel: 'Urine Protein', testType: 'urine', categories: ['urinalysis', 'kidney'], aliases: ['urine protein', 'protein urine', '蛋白'] },
  { key: 'urine-specific-gravity', canonicalLabel: 'Urine Specific Gravity', testType: 'urine', categories: ['urinalysis', 'kidney'], aliases: ['urine specific gravity', 'specific gravity urine', '比重'] },
  { key: 'urine-white-blood-cells', canonicalLabel: 'Urine White Blood Cells', testType: 'urine', categories: ['urinalysis', 'infection', 'blood-cell'], aliases: ['urine white blood cells', 'white blood cells urine', '白血球'] },
  { key: 'urobilinogen', canonicalLabel: 'Urobilinogen', testType: 'urine', categories: ['urinalysis', 'liver'], aliases: ['urobilinogen', 'ｳﾛﾋﾞﾘﾉｰｹﾞﾝ'] },
  { key: 'eosinophils', canonicalLabel: 'Eosinophils', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['eosinophil'], wikidataId: 'Q107238' },
  { key: 'ast', canonicalLabel: 'AST', testType: 'blood', categories: ['liver'], aliases: ['ast got', 'got'] },
  { key: 'egfr', canonicalLabel: 'eGFR', testType: 'blood', categories: ['kidney', 'renal'], aliases: ['egfrcreat', 'egfr creat'] },
  { key: 'wbc', canonicalLabel: 'White Blood Cell Count', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['white blood cell count', 'wbc'] },
  { key: 'total-bilirubin', canonicalLabel: 'Total Bilirubin', testType: 'blood', categories: ['liver'], aliases: ['bilirubin total'] },
  { key: 'hematocrit', canonicalLabel: 'Hematocrit', testType: 'blood', categories: ['blood-cell'], aliases: ['hct'] },
  { key: 'mchc', canonicalLabel: 'MCHC', testType: 'blood', categories: ['blood-cell'] },
  { key: 'hemoglobin', canonicalLabel: 'Hemoglobin', testType: 'blood', categories: ['blood-cell'], aliases: ['hb'], wikidataId: 'Q43041' },
  { key: 'chloride', canonicalLabel: 'Chloride', testType: 'blood', categories: ['electrolyte', 'kidney'], aliases: ['cl'] },
  { key: 'ldh', canonicalLabel: 'LDH', testType: 'blood', categories: ['enzyme', 'tissue-damage'], aliases: ['ld ifcc', 'ldh ifcc', 'ld'] },
  { key: 'creatinine', canonicalLabel: 'Creatinine', testType: 'blood', categories: ['kidney', 'renal'], aliases: ['cre'] },
  { key: 'cea', canonicalLabel: 'CEA', testType: 'blood', categories: ['tumor-marker'], aliases: ['cea clia'] },
  { key: 'monocytes', canonicalLabel: 'Monocytes', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['monocyte'] },
  { key: 'sodium', canonicalLabel: 'Sodium', testType: 'blood', categories: ['electrolyte', 'kidney'], aliases: ['na'] },
  { key: 'seg-neutrophils', canonicalLabel: 'Segmented Neutrophils', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['segmented neutrophils', 'seg neutrophils'] },
  { key: 'bun', canonicalLabel: 'Blood Urea Nitrogen', testType: 'blood', categories: ['kidney', 'renal'], aliases: ['bun', 'blood urea nitrogen'] },
  { key: 'crp', canonicalLabel: 'CRP Quantitative', testType: 'blood', categories: ['inflammation'], aliases: ['crp quantitative', 'crp'] },
  { key: 'ck', canonicalLabel: 'CK', testType: 'blood', categories: ['enzyme', 'muscle'], aliases: ['ck cpk', 'cpk'] },
  { key: 'mcv', canonicalLabel: 'MCV', testType: 'blood', categories: ['blood-cell'] },
  { key: 'total-protein', canonicalLabel: 'Total Protein', testType: 'blood', categories: ['protein', 'liver'], aliases: ['tp', 'total protein'] },
  { key: 'alt', canonicalLabel: 'ALT', testType: 'blood', categories: ['liver'], aliases: ['alt gpt', 'gpt'] },
  { key: 'calcium', canonicalLabel: 'Calcium', testType: 'blood', categories: ['electrolyte', 'mineral'], aliases: ['ca'] },
  { key: 'amylase', canonicalLabel: 'Amylase', testType: 'blood', categories: ['pancreas', 'enzyme'], wikidataId: "Q17153" },
  { key: 'hdl', canonicalLabel: 'HDL Cholesterol', testType: 'blood', categories: ['fat', 'cardiometabolic'], aliases: ['hdl-c', 'hdl cholesterol'] },
  { key: 'alp', canonicalLabel: 'ALP', testType: 'blood', categories: ['liver', 'enzyme'], aliases: ['alp ifcc'] },
  { key: 'ggtp', canonicalLabel: 'gamma-GTP', testType: 'blood', categories: ['liver', 'enzyme'], aliases: ['ggtp', 'gamma gtp', 'gamma gt', 'ggt', 'gamma-gt'] },
  { key: 'potassium', canonicalLabel: 'Potassium', testType: 'blood', categories: ['electrolyte', 'kidney'], aliases: ['k', 'potassium'] },
  { key: 'ca19-9', canonicalLabel: 'CA19-9', testType: 'blood', categories: ['tumor-marker'], aliases: ['ca199'] },
  { key: 'uric-acid', canonicalLabel: 'Uric Acid', testType: 'blood', categories: ['metabolism', 'kidney'], aliases: ['ua', 'uric acid'] },
  { key: 'platelet-count', canonicalLabel: 'Platelet Count', testType: 'blood', categories: ['blood-cell', 'coagulation'], aliases: ['platelet count', 'plt'] },
  { key: 'rbc', canonicalLabel: 'Red Blood Cell Count', testType: 'blood', categories: ['blood-cell'], aliases: ['red blood cell count', 'rbc'] },
  { key: 'hba1c', canonicalLabel: 'HbA1c (NGSP)', testType: 'blood', categories: ['glucose', 'diabetes'], aliases: ['hba1c ngsp', 'hba1c'] },
  { key: 'ldl', canonicalLabel: 'LDL Cholesterol', testType: 'blood', categories: ['fat', 'cardiometabolic'], aliases: ['ldl-c', 'ldl cholesterol'] },
  { key: 'lymphocytes', canonicalLabel: 'Lymphocytes', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['lymphocyte'] },
  { key: 'blood-glucose', canonicalLabel: 'Blood Glucose', testType: 'blood', categories: ['glucose', 'diabetes'], aliases: ['blood glucose', 'plasma glucose', 'blood sugar'] },
  { key: 'serum-glucose', canonicalLabel: 'Serum Glucose', testType: 'blood', categories: ['glucose', 'diabetes'], aliases: ['serum glucose'] },
  { key: 'mch', canonicalLabel: 'MCH', testType: 'blood', categories: ['blood-cell'] },
  { key: 'band-neutrophils', canonicalLabel: 'Band Neutrophils', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['band neutrophils', 'bands'] },
  { key: 'cholinesterase', canonicalLabel: 'Cholinesterase', testType: 'blood', categories: ['liver', 'enzyme'] },
  { key: 'basophils', canonicalLabel: 'Basophils', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['basophil'] },
  { key: 'albumin-calculated', canonicalLabel: 'Albumin (Calculated)', testType: 'blood', categories: ['protein', 'liver'], aliases: ['albumin calculated'] },
  { key: 'alpha1-globulin', canonicalLabel: 'alpha1-Globulin', testType: 'blood', categories: ['protein'], aliases: ['a1-globulin', 'alpha1 globulin'] },
  { key: 'beta2-globulin', canonicalLabel: 'beta2-Globulin', testType: 'blood', categories: ['protein'], aliases: ['b2-globulin', 'beta2 globulin'] },
  { key: 'gamma-globulin', canonicalLabel: 'gamma-Globulin', testType: 'blood', categories: ['protein', 'immune'], aliases: ['g-globulin', 'gamma globulin'] },
  { key: 'alpha2-globulin', canonicalLabel: 'alpha2-Globulin', testType: 'blood', categories: ['protein'], aliases: ['a2-globulin', 'alpha2 globulin'] },
  { key: 'globulin-calculated', canonicalLabel: 'Globulin (Calculated)', testType: 'blood', categories: ['protein'], aliases: ['globulin calculated'] },
  { key: 'beta1-globulin', canonicalLabel: 'beta1-Globulin', testType: 'blood', categories: ['protein'], aliases: ['b1-globulin', 'beta1 globulin'] },
  { key: 'albumin-fraction', canonicalLabel: 'Albumin Fraction', testType: 'blood', categories: ['protein', 'liver'], aliases: ['albumin fraction'] },
  { key: 'ag-ratio', canonicalLabel: 'A/G Ratio', testType: 'blood', categories: ['protein', 'liver'], aliases: ['a g ratio', 'ag ratio'] },
  { key: 'neutrophils', canonicalLabel: 'Neutrophils', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['neutrophil'] },
  { key: 'atypical-lymphocytes', canonicalLabel: 'Atypical Lymphocytes', testType: 'blood', categories: ['blood-cell', 'immune'], aliases: ['atypical lymphocytes'] },
  { key: 'ldl-hdl-ratio', canonicalLabel: 'LDL/HDL Ratio', testType: 'blood', categories: ['fat', 'cardiometabolic'], aliases: ['ldl hdl ratio'] },
];

function normalizeMetricKey(value: string) {
  return value
    .toLowerCase()
    .replaceAll('γ', 'gamma')
    .replaceAll('α', 'alpha')
    .replaceAll('β', 'beta')
    .replaceAll('µ', 'u')
    .replaceAll('μ', 'u')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const lookup = new Map<string, MetricDefinition>();

for (const definition of metricCatalog) {
  lookup.set(normalizeMetricKey(definition.canonicalLabel), definition);

  for (const alias of definition.aliases || []) {
    lookup.set(normalizeMetricKey(alias), definition);
  }
}

export const metricSuggestions = metricCatalog.map((definition) => definition.canonicalLabel);

export function getMetricDefinition(label?: string | null): MetricDefinition {
  const rawLabel = label?.trim();

  if (!rawLabel) {
    return {
      key: 'custom-metric',
      canonicalLabel: 'Custom Metric',
      custom: true,
    };
  }

  const match = lookup.get(normalizeMetricKey(rawLabel));
  if (match) return match;

  return {
    key: `custom-${normalizeMetricKey(rawLabel).replace(/\s+/g, '-')}`,
    canonicalLabel: rawLabel,
    custom: true,
  };
}

export function getMetricMessageKey(definition: MetricDefinition, kind: 'label' | 'description') {
  return `metric_${kind}_${definition.key.replace(/-/g, '_')}`;
}

export function getMetricWikidataUrl(definition: MetricDefinition) {
  return definition.wikidataId ? `https://www.wikidata.org/wiki/${definition.wikidataId}` : null;
}

export function getMetricWikipediaUrl(definition: MetricDefinition, locale: string) {
  if (!definition.wikidataId) return null;

  const normalizedLocale = locale === 'ja' ? 'ja' : 'en';
  return `https://www.wikidata.org/wiki/Special:GoToLinkedPage/${normalizedLocale}wiki/${definition.wikidataId}`;
}

export function getMetricWikipediaFallbackUrl(definition: MetricDefinition) {
  if (!definition.wikidataId) return null;

  return `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${definition.wikidataId}`;
}

export function getMetricTags(definition: MetricDefinition) {
  return {
    testType: definition.testType || 'other',
    categories: definition.categories || ['other'],
  };
}