// Single source of truth for the brand name — change this and it updates everywhere.
export const BRAND_NAME = 'tap';

export function applyBrand(titleSuffix) {
  document.querySelectorAll('[data-brand]').forEach((el) => {
    el.textContent = BRAND_NAME;
  });
  if (titleSuffix) {
    document.title = `${BRAND_NAME} — ${titleSuffix}`;
  }
}
