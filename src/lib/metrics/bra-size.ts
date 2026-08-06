// Japanese (JIS L 4006) bra sizing: the cup follows the top-bust minus
// under-bust difference in 2.5 cm steps from AA at 7.5 cm, and the band is the
// under-bust rounded to the nearest 5 cm.
//
// Published cup table (Wacoal, https://www.wacoal.jp/advice/contents/post-15.html):
//   AA 6.5-8.5 · A 9.0-11.0 · B 11.5-13.5 · C 14.0-16.0 · D 16.5-18.5
//   E 19.0-21.0 · F 21.5-23.5 · G 24.0-26.0 · H 26.5-28.5 · I 29.0-31.0
// The table leaves 0.5 cm gaps between bands; the nearest cup is taken there.
//
// Cup letters above I and sizing conventions outside Japan (UK/US inch-based,
// EU) differ, so this is reported as the Japanese size rather than "the" size.

const CUP_LETTERS = ['AA', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const FIRST_CUP_DIFFERENCE = 7.5;
const CUP_STEP = 2.5;
const BAND_STEP = 5;

export function getJisCupLetter(differenceCm: number): string | null {
  if (!Number.isFinite(differenceCm)) return null;

  const index = Math.round((differenceCm - FIRST_CUP_DIFFERENCE) / CUP_STEP);
  if (index < 0 || index >= CUP_LETTERS.length) return null;

  return CUP_LETTERS[index];
}

export function getJisBandSize(underbustCm: number): number | null {
  if (!Number.isFinite(underbustCm) || underbustCm <= 0) return null;

  return Math.round(underbustCm / BAND_STEP) * BAND_STEP;
}

/** e.g. 75C — null when either measurement falls outside the sized range. */
export function getJisBraSize(underbustCm: number, bustCm: number): string | null {
  const cup = getJisCupLetter(bustCm - underbustCm);
  const band = getJisBandSize(underbustCm);

  if (!cup || !band) return null;

  return `${band}${cup}`;
}
