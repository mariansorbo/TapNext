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
  // Dominios de la plataforma: así `instagram.com` pelado da error (no hay
  // usuario) pero `juan.perez` se toma como usuario y no como dominio.
  dominios: ['instagram.com', 'instagr.am', 'ig.me'],
  // Usuario real de Instagram: letras, números, punto y guión bajo; hasta 30,
  // sin puntos seguidos.
  re: /^(?!.*\.\.)[a-z0-9._]{1,30}$/i,
  // URLs de perfil que traen el usuario un tramo más adentro:
  //  instagram.com/_u/<user>  (abrir en la app),  instagram.com/stories/<user>/<id>
  saltarTramo: ['_u', '_n', 's', 'stories'],
  // Contenido sin usuario recuperable: instagram.com/p/<id>, /reel/<id>, ...
  cortarTramo: ['p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'direct', 'about'],
});
