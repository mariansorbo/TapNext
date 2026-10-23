// Plantillas de mail del programa de socios (agencias de RRHH tercerizado).
// Las usa la solapa "Post Affiliate Pro" del admin (src/pap-admin.js) para
// copiarlas al portapapeles ya completadas. Cada una devuelve { asunto, cuerpo }.

const pesos = (n) => `$${Math.round(Number(n)).toLocaleString('es-AR')}`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombreMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
};
const primerNombre = (contacto) => String(contacto || '').trim().split(/\s+/)[0] || '[Nombre]';

// Primer toque: el primer mail a una consultora o agencia. Editable desde el
// admin, igual que la bienvenida (tabla pap_plantillas, clave 'primer_toque').
export const VARIABLES_PRIMER_TOQUE = {
  comision_pct: 'Comisión en %',
  landing: 'Página de NextTap (next-tap.tech)',
  registro: 'Alta de afiliados en PAP',
};

export const PRIMER_TOQUE_ORIGINAL = {
  asunto: 'Un regalo de fin de año para tus clientes (y {comision_pct}% para vos)',
  cuerpo: `Hola [Nombre]:

Te escribo porque trabajás con pymes que no tienen área de RRHH propia, y en estos meses todas preguntan lo mismo: qué regalar a fin de año. Hacemos llaveros NFC que abren el Instagram o el WhatsApp de cada persona con solo apoyarlos en un celular. Un regalo para los empleados, novedoso y útil, que de verdad van a usar.

La idea es que se lo ofrezcas a tus clientes: vos lo recomendás, nosotros hacemos todo (pedido, entrega, factura) y te llevás el {comision_pct}% de cada venta.

Para que no tengas que creernos a ciegas, cada venta queda registrada en Post Affiliate Pro, una plataforma externa de afiliados. Te damos un link propio para pasarles a tus clientes y un panel con tu usuario. Cuando una empresa entra por tu link y compra, la venta se registra en el momento, con la fecha y el monto, y ves tu comisión acumulada. Es el mismo registro que vemos nosotros, así que los dos trabajamos con los mismos números: sabés exactamente qué vendiste y cuánto te corresponde por cada cliente que nos acercaste.

Como la empresa y el producto son muy nuevos, estamos haciendo un lanzamiento con las primeras consultoras que se suman como aliadas: {comision_pct}% de comisión sobre cada combo de llaveros (Instagram + WhatsApp).

Mariano | NextTap
ventas@next-tap.tech · next-tap.tech`,
};

export function plantillaPrimerToque({ comisionPct, landingUrl = 'https://next-tap.tech', signupUrl, primerToque }) {
  const vars = { comision_pct: comisionPct, landing: landingUrl, registro: signupUrl || '' };
  const t = primerToque || PRIMER_TOQUE_ORIGINAL;
  return { asunto: completar(t.asunto, vars), cuerpo: completar(t.cuerpo, vars) };
}

// Bienvenida: se puede editar desde el admin (se guarda en el server, tabla
// pap_plantillas). Las {variables} se completan con los datos de cada agencia.
export const VARIABLES_BIENVENIDA = {
  nombre: 'Primer nombre del contacto',
  agencia: 'Nombre de la agencia',
  codigo: 'Su código',
  link: 'Su link de afiliado',
  mail_armado: 'Página con el mail para pymes armado con su código',
  panel: 'Panel de afiliados de PAP',
  email: 'Su mail (usuario del panel)',
  comision_pct: 'Comisión en %',
  precio_combo: 'Precio del combo',
  comision_combo: 'Comisión por combo en $',
};

export const BIENVENIDA_ORIGINAL = {
  asunto: 'Ya sos socio de NextTap: tu link y tu código',
  cuerpo: `Hola {nombre}:

¡Bienvenido! {agencia} ya está dada de alta como socia de NextTap. Tenés dos formas de que una venta quede a tu nombre:

Tu link: {link}
Tu código: {codigo}

Cómo funciona:
1. Compartí el link con las empresas que atendés: por mail, WhatsApp o en tu propuesta de regalos de fin de año. Si la empresa entra por ahí y compra en la web dentro de los 60 días, la venta es tuya.
2. O pasales tu código. Muchas empresas prefieren escribirnos y pagar por transferencia. En ese caso, alcanza con que digan "venimos de parte de {codigo}" al hacer el pedido, y la venta queda a tu nombre igual.
3. Por cada combo te corresponde el {comision_pct}% del precio, sin contar el envío. Hoy el combo de dos llaveros sale {precio_combo}, así que son {comision_combo} por combo.
4. Cuando nos entra el pago de la empresa, tu comisión queda aprobada (en menos de un día). El día 10 de cada mes te transferimos las comisiones del mes anterior, con el detalle de cada venta.

Un mail listo para mandarle a tus contactos: entrá a {mail_armado}, tocá "Copiar mail" y pegalo en un mail nuevo de Gmail u Outlook. Ya va con tu código y con el diseño de NextTap; no hace falta reenviar nada.

Dónde ver tus ventas: entrá a {panel} con tu mail ({email}). La primera vez tocá "¿Olvidaste tu contraseña?" para elegir una. Ahí ves cada clic en tu link, cada venta y cuánto llevás ganado.

Un consejo: las empresas compran más cuando ven el llavero funcionando. Si querés, te mando un combo para que lo muestres en tus reuniones.

Cualquier duda, respondé este mail.

Saludos,
Mariano
NextTap · ventas@next-tap.tech`,
};

// Una {variable} desconocida queda tal cual, para que se note al leer el mail.
const completar = (texto, vars) => String(texto).replace(/\{([a-z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m));

export function plantillaBienvenida({ afiliado, panelAfiliados, comisionPct, precioCombo, landingUrl = 'https://next-tap.tech', bienvenida }) {
  const vars = {
    nombre: primerNombre(afiliado.contacto),
    agencia: afiliado.agencia || 'Tu agencia',
    codigo: afiliado.codigo,
    link: afiliado.link,
    // Página con el mail para empresas ya armado con su código (public/mail/afiliados.html).
    mail_armado: `${landingUrl.replace(/\/+$/, '')}/mail/afiliados.html?codigo=${encodeURIComponent(afiliado.codigo)}`,
    panel: panelAfiliados,
    email: afiliado.email,
    comision_pct: comisionPct,
    precio_combo: pesos(precioCombo),
    comision_combo: pesos((precioCombo * comisionPct) / 100),
  };
  const t = bienvenida || BIENVENIDA_ORIGINAL;
  return { asunto: completar(t.asunto, vars), cuerpo: completar(t.cuerpo, vars) };
}

export function plantillaResumen({ grupo, mes }) {
  const { afiliado, ventas, aPagar } = grupo;
  const aprobadas = ventas.filter((v) => v.estado === 'approved');
  const lineas = aprobadas
    .map((v) => {
      const fecha = new Date(v.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      const quien = v.empresa || 'Compra en la web';
      const que = v.productos && !/^combo$|^llavero/.test(v.productos) ? ` · ${v.productos}` : '';
      return `- ${fecha} · ${quien}${que} · venta ${pesos(v.totalCost)} · tu comisión ${pesos(v.comision)}${v.nota ? ` (${v.nota})` : ''}`;
    })
    .join('\n');
  return {
    asunto: `NextTap — tus comisiones de ${nombreMes(mes)}`,
    cuerpo: `Hola ${primerNombre(afiliado.contacto)}:

Este es el resumen de ${nombreMes(mes)}:

${lineas}

Total: ${pesos(aPagar)}. Te lo transferimos hoy${afiliado.alias ? ` a ${afiliado.alias}` : ''}.

Lo ves también, venta por venta, en tu panel de socio. ¡Gracias por recomendarnos!

Saludos,
Mariano
NextTap · ventas@next-tap.tech`,
  };
}

export const comoTexto = ({ asunto, cuerpo }) => `Asunto: ${asunto}\n\n${cuerpo}`;
