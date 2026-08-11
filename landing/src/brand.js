// Single source of truth for the brand name — change these and it updates everywhere.
export const BRAND_PREFIX = 'Next';
export const BRAND_EMPHASIS = 'Tap';
export const BRAND_NAME = BRAND_PREFIX + BRAND_EMPHASIS;

export function applyBrand(titleSuffix) {
  document.querySelectorAll('[data-brand]').forEach((el) => {
    el.textContent = BRAND_NAME;
  });

  document.querySelectorAll('[data-brand-logo]').forEach((el) => {
    el.innerHTML = '';
    const prefix = document.createElement('span');
    prefix.textContent = BRAND_PREFIX;
    const emphasis = document.createElement('span');
    emphasis.className = 'brand-emphasis';
    emphasis.textContent = BRAND_EMPHASIS;
    el.append(prefix, emphasis);
  });

  if (titleSuffix) {
    document.title = `${BRAND_NAME} — ${titleSuffix}`;
  }
}
