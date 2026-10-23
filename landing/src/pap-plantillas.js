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

export function plantillaPropuesta({ signupUrl, landingUrl, comisionPct }) {
  return {
    asunto: `Un regalo para los equipos de tus clientes, y ${comisionPct}% para vos`,
    cuerpo: `Hola [Nombre]:

Soy Mariano, de NextTap. Te escribo porque [Agencia] lleva RRHH de varias pymes, y tengo algo que les puede servir a ellas y a ustedes.

NextTap es un llavero con un chip: lo acercás a cualquier celular y se abre al instante el WhatsApp, el Instagram o la web de quien lo lleva. No hace falta app ni escanear nada. Lo usan vendedores, técnicos y equipos que están todo el día pasando su contacto.

Para una pyme es un regalo de fin de año o de bienvenida que se usa todos los días. Además, puede llevar el nombre y el logo de la empresa: cuando alguien toca el llavero, aparece "NextTap by [Empresa]".

La propuesta es simple: te sumás como socio, te doy un link y un código tuyos y, por cada combo que compre una empresa que llegó por vos, te llevás el ${comisionPct}%. No tenés que vender, cobrar ni entregar nada: nosotros nos encargamos del envío y la atención. Es un servicio más para ofrecerles a tus clientes, sin trabajo extra.

Mirá cómo funciona en ${landingUrl}/?utm_source=mail&utm_medium=agencias&utm_campaign=afiliados

Si te interesa, te mando un combo de muestra para que lo pruebes y te anotás acá: ${signupUrl}

Saludos,
Mariano
NextTap · ventas@next-tap.tech`,
  };
}

export function plantillaBienvenida({ afiliado, panelAfiliados, comisionPct, precioCombo, landingUrl = 'https://next-tap.tech' }) {
  const comisionCombo = (precioCombo * comisionPct) / 100;
  // Página con el mail para empresas ya armado con su código (public/mail/afiliados.html).
  const mailArmado = `${landingUrl.replace(/\/+$/, '')}/mail/afiliados.html?codigo=${encodeURIComponent(afiliado.codigo)}`;
  return {
    asunto: 'Ya sos socio de NextTap: tu link y tu código',
    cuerpo: `Hola ${primerNombre(afiliado.contacto)}:

¡Bienvenido! ${afiliado.agencia || 'Tu agencia'} ya está dada de alta como socia de NextTap. Tenés dos formas de que una venta quede a tu nombre:

Tu link: ${afiliado.link}
Tu código: ${afiliado.codigo}

Cómo funciona:
1. Compartí el link con las empresas que atendés: por mail, WhatsApp o en tu propuesta de regalos de fin de año. Si la empresa entra por ahí y compra en la web dentro de los 60 días, la venta es tuya.
2. O pasales tu código. Muchas empresas prefieren escribirnos y pagar por transferencia. En ese caso, alcanza con que digan "venimos de parte de ${afiliado.codigo}" al hacer el pedido, y la venta queda a tu nombre igual.
3. Por cada combo te corresponde el ${comisionPct}% del precio, sin contar el envío. Hoy el combo de dos llaveros sale ${pesos(precioCombo)}, así que son ${pesos(comisionCombo)} por combo.
4. Cuando nos entra el pago de la empresa, tu comisión queda aprobada (en menos de un día). El día 10 de cada mes te transferimos las comisiones del mes anterior, con el detalle de cada venta.

Un mail listo para mandarle a tus contactos: entrá a ${mailArmado}, tocá "Copiar mail" y pegalo en un mail nuevo de Gmail u Outlook. Ya va con tu código y con el diseño de NextTap; no hace falta reenviar nada.

Dónde ver tus ventas: entrá a ${panelAfiliados} con tu mail (${afiliado.email}). La primera vez tocá "¿Olvidaste tu contraseña?" para elegir una. Ahí ves cada clic en tu link, cada venta y cuánto llevás ganado.

Un consejo: las empresas compran más cuando ven el llavero funcionando. Si querés, te mando un combo para que lo muestres en tus reuniones.

Cualquier duda, respondé este mail.

Saludos,
Mariano
NextTap · ventas@next-tap.tech`,
  };
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
