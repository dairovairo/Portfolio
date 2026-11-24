// ─────────────────────────────────────────────────────────────────────────
// Bases de cada sorteo
// ─────────────────────────────────────────────────────────────────────────
// Se generan al crear el sorteo y se guardan tal cual (rules_text): así quien
// participa acepta un texto que ya no puede cambiar. Es una plantilla, no
// asesoramiento legal: el responsable del sorteo es su organizador.

const { VOLT_TICKETS, MIN_ACCOUNT_AGE_HOURS } = require('./raffles');
const { CLAIM_DAYS } = require('./raffleDraw');

const dateFormat = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', dateStyle: 'long', timeStyle: 'short',
});
const euros = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

function buildRaffleRules({ raffle, prizes, communityName }) {
  const sorted = [...prizes].sort((a, b) => a.position - b.position);
  const base = sorted.filter(p => !p.requires_goal);
  const extra = sorted.filter(p => p.requires_goal);
  const prizeLine = (p) => `  ${p.position}. ${p.title}${p.value_cents ? ` (valor aproximado: ${euros(p.value_cents)})` : ''}`;

  const sections = [
    ['Organizador',
      `${raffle.organizer_name} (contacto: ${raffle.organizer_contact}) organiza este sorteo en la comunidad "${communityName}" y es el único responsable de él y de entregar los premios. SocialBattery solo facilita la herramienta. Ni SocialBattery, ni Google, ni Apple patrocinan, organizan o administran este sorteo.`],
    ['Quién puede participar',
      `Personas mayores de 18 años que sean miembros de la comunidad y tengan una cuenta creada hace al menos ${MIN_ACCOUNT_AGE_HOURS} horas. No pueden participar el organizador ni los administradores de la comunidad. Una participación por persona: usar varias cuentas supone la exclusión.`],
    ['Cómo se participa',
      'La participación es gratuita: basta con aceptar estas bases y pulsar "Participar". No hace falta comprar nada ni hacer ninguna aportación.'
      + (raffle.tier === 'community' ? ' Las aportaciones a la comunidad son voluntarias, las recibe directamente quien creó la comunidad (SocialBattery no cobra comisión) y no dan derecho a participar ni aumentan las probabilidades de ganar.' : '')
      + (raffle.tier === 'volt' ? ` Las personas con suscripción Volt activa en el momento del sorteo tienen ${VOLT_TICKETS} papeletas; el resto, 1.` : '')],
    ['Plazo',
      `Desde la publicación del sorteo hasta el ${dateFormat.format(new Date(raffle.ends_at))} (hora peninsular española).`],
    ['Premios',
      `${base.length === 1 ? 'Un premio' : `${base.length} premios`}:\n${base.map(prizeLine).join('\n')}`
      + (extra.length
        ? `\nPremios extra, que solo se sortean si las aportaciones a la comunidad recibidas durante el plazo suman al menos ${euros(raffle.goal_cents)}:\n${extra.map(prizeLine).join('\n')}\nSi no se alcanza esa cantidad, el sorteo se celebra igualmente con el resto de premios.`
        : '')
      + '\nCada persona puede ganar como máximo un premio. Los premios no se pueden canjear por dinero salvo que el organizador lo indique.'],
    ['Cómo se eligen los ganadores',
      `Automáticamente y al azar al terminar el plazo, sin intervención del organizador. La probabilidad de ganar depende del número de participantes${raffle.tier === 'volt' ? ' y de sus papeletas' : ''}. El resultado es comprobable: el código de verificación (${raffle.draw_commit}) se publica antes del sorteo y la semilla que lo genera, después.`],
    ['Comunicación y entrega',
      `Los ganadores se publican en la comunidad y se les avisa en la app. Tienen ${CLAIM_DAYS} días para aceptar el premio; si no lo hacen, el organizador puede volver a sortearlo. El organizador debe entregar el premio y cubrir los gastos de envío salvo que indique lo contrario en la descripción. Si no llega, se puede reclamar desde la app.`],
    ['Impuestos y datos personales',
      'El organizador y el ganador son responsables de las obligaciones fiscales que les correspondan por el premio. Los datos de los participantes se usan únicamente para gestionar el sorteo y entregar los premios.'],
    ['Cambios',
      'Una vez publicado, no se pueden cambiar ni los premios ni el plazo.'],
  ];

  return `BASES DEL SORTEO "${raffle.title}"\n\n`
    + sections.map(([title, text], i) => `${i + 1}. ${title}. ${text}`).join('\n\n');
}

module.exports = { buildRaffleRules };
