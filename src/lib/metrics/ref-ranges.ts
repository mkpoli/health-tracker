import { normalizeComparableMeasurement } from './normalization';

export type RefRangeSex = 'Male' | 'Female' | 'Other' | 'Any';

export type RefRangeEntry = {
  label: string;
  sex?: RefRangeSex | RefRangeSex[];
  ageMin?: number;
  ageMax?: number;
  range: string;
  unit?: string | null;
  notes?: string;
  source?: string;
};

export type PatientContext = {
  agab?: string | null;
  birthday?: string | null;
};

// Endogenous adult intervals collated from publicly available lab references
// (Mayo Clinic Labs, Quest, LabCorp). Real clinical ranges vary by lab and assay;
// users should verify against their report.
//
// Gender-affirming HRT target intervals are intervention targets, NOT physiological
// reference intervals — they describe where clinicians typically aim while a patient
// is on therapy. Sources:
//   - Endocrine Society Clinical Practice Guideline, Hembree et al. 2017
//   - WPATH Standards of Care v8 (2022)
//   - Transfeminine Science (transfemscience.org)
//   - MtF.Wiki / community references
const refRangeCatalog: Partial<Record<string, RefRangeEntry[]>> = {
  testosterone: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '264-916', unit: 'ng/dL' },
    { label: 'Adult female', sex: 'Female', ageMin: 18, range: '8-60', unit: 'ng/dL' },
    {
      label: 'Transfeminine HRT target (suppressed)',
      range: '<50',
      unit: 'ng/dL',
      notes: 'On feminizing HRT with anti-androgen or orchiectomy. Endocrine Society 2017 cites <55 ng/dL.',
      source: 'Endocrine Society 2017; WPATH SOC8',
    },
    {
      label: 'Transmasculine HRT target',
      range: '320-1000',
      unit: 'ng/dL',
      notes: 'On masculinizing testosterone therapy — aim for the cis male physiological range.',
      source: 'Endocrine Society 2017; WPATH SOC8',
    },
  ],
  'free-testosterone': [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '9.3-26.5', unit: 'pg/mL' },
    { label: 'Adult female', sex: 'Female', ageMin: 18, range: '0.2-5.0', unit: 'pg/mL' },
  ],
  estradiol: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '<50', unit: 'pg/mL' },
    { label: 'Female, follicular phase', sex: 'Female', notes: 'Follicular', range: '19-140', unit: 'pg/mL' },
    { label: 'Female, ovulatory', sex: 'Female', notes: 'Ovulatory', range: '110-410', unit: 'pg/mL' },
    { label: 'Female, luteal phase', sex: 'Female', notes: 'Luteal', range: '19-241', unit: 'pg/mL' },
    { label: 'Female, postmenopausal', sex: 'Female', notes: 'Postmenopausal', range: '<10', unit: 'pg/mL' },
    {
      label: 'Transfeminine HRT target',
      range: '100-200',
      unit: 'pg/mL',
      notes: 'Common feminizing-HRT target (premenopausal female range). Some clinicians and patients on monotherapy aim higher (up to ~250-300).',
      source: 'Endocrine Society 2017; WPATH SOC8; Transfeminine Science',
    },
    {
      label: 'Transmasculine on T (suppressed)',
      range: '<50',
      unit: 'pg/mL',
      notes: 'On masculinizing testosterone therapy, endogenous estradiol is typically suppressed.',
      source: 'Endocrine Society 2017',
    },
  ],
  progesterone: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '0.1-0.8', unit: 'ng/mL' },
    { label: 'Female, follicular phase', sex: 'Female', notes: 'Follicular', range: '0.1-0.7', unit: 'ng/mL' },
    { label: 'Female, luteal phase', sex: 'Female', notes: 'Luteal', range: '1.8-23.9', unit: 'ng/mL' },
    { label: 'Female, postmenopausal', sex: 'Female', notes: 'Postmenopausal', range: '<0.5', unit: 'ng/mL' },
  ],
  fsh: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '1.5-12.4', unit: 'mIU/mL' },
    { label: 'Female, follicular phase', sex: 'Female', notes: 'Follicular', range: '3.5-12.5', unit: 'mIU/mL' },
    { label: 'Female, ovulatory', sex: 'Female', notes: 'Ovulatory', range: '4.7-21.5', unit: 'mIU/mL' },
    { label: 'Female, luteal phase', sex: 'Female', notes: 'Luteal', range: '1.7-7.7', unit: 'mIU/mL' },
    { label: 'Female, postmenopausal', sex: 'Female', notes: 'Postmenopausal', range: '25.8-134.8', unit: 'mIU/mL' },
    {
      label: 'On HRT (suppressed)',
      range: '<5',
      unit: 'mIU/mL',
      notes: 'Both feminizing and masculinizing HRT typically suppress endogenous gonadotropins. Not a hard target; trended for context.',
    },
  ],
  lh: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '1.7-8.6', unit: 'mIU/mL' },
    { label: 'Female, follicular phase', sex: 'Female', notes: 'Follicular', range: '2.4-12.6', unit: 'mIU/mL' },
    { label: 'Female, ovulatory', sex: 'Female', notes: 'Ovulatory', range: '14-95.6', unit: 'mIU/mL' },
    { label: 'Female, luteal phase', sex: 'Female', notes: 'Luteal', range: '1.0-11.4', unit: 'mIU/mL' },
    { label: 'Female, postmenopausal', sex: 'Female', notes: 'Postmenopausal', range: '7.7-58.5', unit: 'mIU/mL' },
    {
      label: 'On HRT (suppressed)',
      range: '<5',
      unit: 'mIU/mL',
      notes: 'Both feminizing and masculinizing HRT typically suppress endogenous gonadotropins. Not a hard target; trended for context.',
    },
  ],
  prolactin: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '4.0-15.2', unit: 'ng/mL' },
    { label: 'Adult female (non-pregnant)', sex: 'Female', ageMin: 18, range: '4.8-23.3', unit: 'ng/mL' },
  ],
  amh: [
    { label: 'Female, 20-29 yrs', sex: 'Female', ageMin: 20, ageMax: 29, range: '1.5-9.5', unit: 'ng/mL' },
    { label: 'Female, 30-34 yrs', sex: 'Female', ageMin: 30, ageMax: 34, range: '1.0-7.0', unit: 'ng/mL' },
    { label: 'Female, 35-39 yrs', sex: 'Female', ageMin: 35, ageMax: 39, range: '0.7-3.5', unit: 'ng/mL' },
    { label: 'Female, 40-44 yrs', sex: 'Female', ageMin: 40, ageMax: 44, range: '0.3-2.5', unit: 'ng/mL' },
    { label: 'Female, ≥45 yrs', sex: 'Female', ageMin: 45, range: '<1.0', unit: 'ng/mL' },
  ],
  'dhea-s': [
    { label: 'Male, 18-29 yrs', sex: 'Male', ageMin: 18, ageMax: 29, range: '280-640', unit: 'ug/dL' },
    { label: 'Male, 30-39 yrs', sex: 'Male', ageMin: 30, ageMax: 39, range: '120-520', unit: 'ug/dL' },
    { label: 'Male, 40-49 yrs', sex: 'Male', ageMin: 40, ageMax: 49, range: '95-530', unit: 'ug/dL' },
    { label: 'Male, 50-59 yrs', sex: 'Male', ageMin: 50, ageMax: 59, range: '70-310', unit: 'ug/dL' },
    { label: 'Male, ≥60 yrs', sex: 'Male', ageMin: 60, range: '40-220', unit: 'ug/dL' },
    { label: 'Female, 18-29 yrs', sex: 'Female', ageMin: 18, ageMax: 29, range: '65-380', unit: 'ug/dL' },
    { label: 'Female, 30-39 yrs', sex: 'Female', ageMin: 30, ageMax: 39, range: '45-270', unit: 'ug/dL' },
    { label: 'Female, 40-49 yrs', sex: 'Female', ageMin: 40, ageMax: 49, range: '32-240', unit: 'ug/dL' },
    { label: 'Female, 50-59 yrs', sex: 'Female', ageMin: 50, ageMax: 59, range: '26-200', unit: 'ug/dL' },
    { label: 'Female, ≥60 yrs', sex: 'Female', ageMin: 60, range: '13-130', unit: 'ug/dL' },
  ],
  hemoglobin: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '13.5-17.5', unit: 'g/dL' },
    { label: 'Adult female', sex: 'Female', ageMin: 18, range: '12.0-15.5', unit: 'g/dL' },
    {
      label: 'On masculinizing T therapy',
      range: '13.5-17.5',
      unit: 'g/dL',
      notes: 'Trends toward cis male range on testosterone. Monitor for erythrocytosis.',
      source: 'Endocrine Society 2017',
    },
  ],
  hematocrit: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '41-50', unit: '%' },
    { label: 'Adult female', sex: 'Female', ageMin: 18, range: '36-44', unit: '%' },
    {
      label: 'On masculinizing T therapy (safety cap)',
      range: '<52',
      unit: '%',
      notes: 'Hematocrit >52% on testosterone therapy is the commonly cited threshold for clinical action (dose review, phlebotomy).',
      source: 'Endocrine Society 2017; WPATH SOC8',
    },
  ],
  rbc: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '4.7-6.1', unit: '10^6/uL' },
    { label: 'Adult female', sex: 'Female', ageMin: 18, range: '4.2-5.4', unit: '10^6/uL' },
  ],
  creatinine: [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '0.74-1.35', unit: 'mg/dL' },
    { label: 'Adult female', sex: 'Female', ageMin: 18, range: '0.59-1.04', unit: 'mg/dL' },
  ],
  'uric-acid': [
    { label: 'Adult male', sex: 'Male', ageMin: 18, range: '3.4-7.0', unit: 'mg/dL' },
    { label: 'Adult female', sex: 'Female', ageMin: 18, range: '2.4-6.0', unit: 'mg/dL' },
  ],
};

function normalizeAgab(value?: string | null): RefRangeSex | null {
  if (!value) return null;
  const lower = value.trim().toLowerCase();
  if (lower === 'male' || lower === 'm') return 'Male';
  if (lower === 'female' || lower === 'f') return 'Female';
  if (lower === 'other') return 'Other';
  return null;
}

function computeAgeYears(birthday?: string | null): number | null {
  if (!birthday) return null;
  const dob = new Date(birthday);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function entryMatchesSex(entry: RefRangeEntry, sex: RefRangeSex | null): boolean {
  if (!entry.sex || entry.sex === 'Any') return true;
  if (!sex) return false;
  if (Array.isArray(entry.sex)) return entry.sex.includes(sex) || entry.sex.includes('Any');
  return entry.sex === sex;
}

function entryMatchesAge(entry: RefRangeEntry, age: number | null): boolean {
  if (entry.ageMin === undefined && entry.ageMax === undefined) return true;
  if (age === null) return false;
  if (entry.ageMin !== undefined && age < entry.ageMin) return false;
  if (entry.ageMax !== undefined && age > entry.ageMax) return false;
  return true;
}

function scoreEntry(entry: RefRangeEntry, patient: PatientContext): number {
  const sex = normalizeAgab(patient.agab);
  const age = computeAgeYears(patient.birthday);

  let score = 0;
  if (entryMatchesSex(entry, sex)) score += 10;
  if (entry.sex && entry.sex !== 'Any' && sex && entryMatchesSex(entry, sex)) score += 5;
  if (entryMatchesAge(entry, age)) score += 4;
  if ((entry.ageMin !== undefined || entry.ageMax !== undefined) && age !== null && entryMatchesAge(entry, age)) score += 3;
  return score;
}

export function getRefRangesForMetric(metricKey: string, patient: PatientContext = {}): RefRangeEntry[] {
  const entries = refRangeCatalog[metricKey];
  if (!entries || entries.length === 0) return [];

  return [...entries].sort((a, b) => scoreEntry(b, patient) - scoreEntry(a, patient));
}

export function hasRefRangesForMetric(metricKey: string): boolean {
  return Boolean(refRangeCatalog[metricKey]?.length);
}

function unitConversionFactor(fromUnit?: string | null, toUnit?: string | null): number | null {
  if (!fromUnit && !toUnit) return 1;
  if (!fromUnit || !toUnit) return null;
  if (fromUnit.trim() === toUnit.trim()) return 1;

  const fromScale = normalizeComparableMeasurement(1, fromUnit, null);
  const toScale = normalizeComparableMeasurement(1, toUnit, null);

  if (
    fromScale.comparableUnit &&
    toScale.comparableUnit &&
    fromScale.comparableUnit === toScale.comparableUnit &&
    fromScale.multiplier &&
    toScale.multiplier
  ) {
    return fromScale.multiplier / toScale.multiplier;
  }

  return null;
}

function applyFactorToRangeText(text: string, factor: number): string {
  return text.replace(/(?<![\d.])[+-]?\d*\.?\d+/g, (match) => {
    const parsed = Number(match);
    if (!Number.isFinite(parsed)) return match;
    const converted = parsed * factor;
    const rounded = Math.round(converted * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  });
}

export function formatRefRangeForUnit(entry: RefRangeEntry, targetUnit?: string | null): { range: string; unit: string | null; converted: boolean } {
  const entryUnit = entry.unit || null;

  if (!targetUnit || !entryUnit || targetUnit.trim() === entryUnit.trim()) {
    return { range: entry.range, unit: entryUnit, converted: false };
  }

  const factor = unitConversionFactor(entryUnit, targetUnit);
  if (factor === null || factor === 1) {
    return { range: entry.range, unit: entryUnit, converted: false };
  }

  return {
    range: applyFactorToRangeText(entry.range, factor),
    unit: targetUnit,
    converted: true,
  };
}
