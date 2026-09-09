import { destinoHandle } from './_comun.js';

export default destinoHandle({
  id: 'linktree',
  meta: {
    label: 'Linktree',
    campo: 'Usuario de Linktree',
    placeholder: 'tunegocio',
    ayuda: 'Solo tu usuario de Linktree, sin el link completo.',
  },
  urlDe: (h) => `https://linktr.ee/${h}`,
  errorMsg: 'Poné tu usuario de Linktree (ej: tunegocio).',
  dominios: ['linktr.ee', 'linktree.com'],
  // Usuario de Linktree: letras, números, punto, guión y guión bajo; hasta 30.
  re: /^[a-z0-9._-]{1,30}$/i,
  reChars: /[a-z0-9._-]+/i,
});
