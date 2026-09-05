import { destinoHandle } from './_comun.js';

export default destinoHandle({
  id: 'instagram',
  meta: {
    label: 'Instagram',
    campo: 'Usuario de Instagram',
    placeholder: 'tunegocio',
    ayuda: 'Solo tu usuario, sin @ ni el link completo.',
  },
  urlDe: (h) => `https://instagram.com/${h}`,
  errorMsg: 'Poné tu usuario de Instagram (ej: tunegocio), sin @ ni el link completo.',
});
