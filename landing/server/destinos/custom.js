import { limpiar, aUrlAbsoluta } from './_comun.js';
import whatsapp from './whatsapp.js';
import instagram from './instagram.js';

// Función "custom": en vez de mandar a un solo lugar, el tap abre una página
// propia de NextTap con el nombre de la persona y dos botones: WhatsApp e
// Instagram (cualquiera de los dos puede faltar, pero al menos uno es
// obligatorio). Modo 'landing', igual que 'alias'.
//
// Reusa los parsers de los plugins whatsapp e instagram: el comprador escribe
// su número y su @usuario como siempre y acá se guardan ya como links.
//
// Valor guardado en `destinos` (JSON string):
//   { nombre, bio?, whatsapp?: 'https://wa.me/...', instagram?: 'https://instagram.com/...' }

function leerCrudo(crudo) {
  if (crudo && typeof crudo === 'object') return crudo;
  try {
    const o = JSON.parse(String(crudo ?? ''));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

const meta = {
  label: 'Custom',
  campo: 'Tu página',
  placeholder: 'Tu nombre',
  ayuda: 'Una página de NextTap con tus botones de WhatsApp e Instagram.',
  // El front dibuja un input por campo (mismo mecanismo que 'alias').
  campos: [
    { key: 'nombre', label: 'Nombre (va arriba de la página)', placeholder: 'Tu nombre o el de tu negocio', requerido: true },
    { key: 'bio', label: 'Descripción (opcional)', placeholder: 'Una frase corta', requerido: false },
    { key: 'whatsapp', label: 'WhatsApp', placeholder: '11 2233 4455', ayuda: 'Con característica, como lo marcás en el celular.', requerido: false },
    { key: 'instagram', label: 'Instagram', placeholder: 'tunegocio', ayuda: 'Solo tu usuario, sin @ ni el link completo.', requerido: false },
  ],
};

export default {
  id: 'custom',
  meta,

  normalizar(crudo) {
    const obj = leerCrudo(crudo);
    if (!obj) return { error: 'Completá tu página.' };

    const nombre = limpiar(obj.nombre).replace(/\s+/g, ' ');
    const bio = limpiar(obj.bio).replace(/\s+/g, ' ');
    if (!nombre) return { error: 'Falta el nombre que va arriba de la página.' };
    if (nombre.length > 60) return { error: 'El nombre es muy largo (máximo 60 caracteres).' };
    if (bio.length > 160) return { error: 'La descripción es muy larga (máximo 160 caracteres).' };

    const valor = { nombre, bio };
    const wa = String(obj.whatsapp ?? '').trim();
    const ig = String(obj.instagram ?? '').trim();
    if (wa) {
      const r = whatsapp.normalizar(wa);
      if (r.error) return { error: r.error };
      valor.whatsapp = r.valor;
    }
    if (ig) {
      const r = instagram.normalizar(ig);
      if (r.error) return { error: r.error };
      valor.instagram = r.valor;
    }
    if (!valor.whatsapp && !valor.instagram) return { error: 'Cargá al menos tu WhatsApp o tu Instagram.' };
    return { valor: JSON.stringify(valor) };
  },

  resolver(valor) {
    let d = null;
    try {
      d = JSON.parse(valor);
    } catch {
      /* fila rota: la página muestra el aviso de vacío */
    }
    return {
      modo: 'landing',
      funcion: 'custom',
      datos: {
        nombre: String(d?.nombre ?? ''),
        bio: String(d?.bio ?? ''),
        whatsapp: d?.whatsapp ? aUrlAbsoluta(d.whatsapp) : null,
        instagram: d?.instagram ? aUrlAbsoluta(d.instagram) : null,
      },
    };
  },

  preview(valor) {
    let d = null;
    try {
      d = JSON.parse(valor);
    } catch {
      /* noop */
    }
    const redes = [d?.whatsapp && 'WhatsApp', d?.instagram && 'Instagram'].filter(Boolean).join(' e ');
    return `Muestra tu página${redes ? ` con ${redes}` : ''}`;
  },
};
