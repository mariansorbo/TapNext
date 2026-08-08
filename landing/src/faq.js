export function initFaqAccordion() {
  document.querySelectorAll('.faq-item').forEach((item) => {
    item.querySelector('.faq-question').addEventListener('click', () => {
      item.classList.toggle('is-open');
    });
  });
}
