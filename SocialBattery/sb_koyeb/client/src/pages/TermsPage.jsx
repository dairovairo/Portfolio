import { Link } from 'react-router-dom';
import LogoWordmark from '../components/LogoWordmark';

// Página pública de Términos y Condiciones. Como la de Privacidad, va
// montada FUERA del gate de sesión (ver App.jsx) para que sea accesible
// sin login: obligatorio para que el usuario los pueda leer antes de
// registrarse (además, tanto App Store como Google Play piden un enlace
// público a los ToS en las fichas de la tienda).
//
// Texto redactado a partir de las funciones que la app ofrece hoy: chats
// 1:1 y de grupo, comunidades, eventos, quedadas (pools), sorteos con
// premios en especie, mascota con accesorios comprados con la moneda
// virtual "Volts", ubicación en vivo durante quedadas. NO es un texto
// certificado por un abogado — cuando se activen los pagos reales o se
// entre en mercados con regulación estricta, conviene que lo revise un
// gestor/asesor.
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface-bg text-surface-text">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-10 flex items-center gap-2">
          <img src="/logo-icon.png" alt="SocialBattery" className="h-8 w-auto" />
          <span className="font-display text-xl font-bold">
            <LogoWordmark />
          </span>
        </div>

        <h1 className="font-display text-3xl font-bold mb-2">Términos y Condiciones</h1>
        <p className="text-surface-muted text-sm mb-10">Última actualización: julio de 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-surface-muted">
          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">1. Aceptación de los términos</h2>
            <p>
              Al registrarte o usar SocialBattery ("la app", "el servicio") aceptas estos
              Términos y Condiciones y nuestra{' '}
              <Link to="/privacidad" className="text-accent-glow underline underline-offset-4">Política de Privacidad</Link>.
              Si no estás de acuerdo con alguna parte, no uses la app.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">2. Edad mínima</h2>
            <p>
              Para usar SocialBattery debes tener al menos <strong className="text-surface-text">16 años</strong>.
              La app incluye chat con desconocidos, ubicación en vivo durante quedadas y
              contenido generado por otros usuarios; no es un producto adecuado para
              menores de esa edad. Si detectamos que una cuenta pertenece a un menor
              de 16, la eliminaremos.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">3. Tu cuenta</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Eres responsable de la seguridad de tu contraseña y de todo lo que ocurra en tu cuenta.</li>
              <li>Debes darnos información veraz al registrarte. No se permiten cuentas suplantando a otras personas.</li>
              <li>Puedes cerrar tu cuenta en cualquier momento desde <strong className="text-surface-text">Ajustes → Eliminar mi cuenta</strong>. Es permanente: se borran tus datos personales, mensajes, publicaciones, mascotas y compras.</li>
              <li>Podemos suspender o eliminar cuentas que incumplan estos términos, sin obligación de reembolso de Volts u otros ítems virtuales.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">4. Uso aceptable</h2>
            <p className="mb-2">Al usar SocialBattery te comprometes a NO:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Acosar, amenazar, intimidar o dañar a otros usuarios.</li>
              <li>Publicar contenido sexual, violento, discriminatorio, de odio o ilegal.</li>
              <li>Compartir contenido sexual que implique a menores de edad, bajo ningún concepto y en ningún formato.</li>
              <li>Suplantar a otras personas o crear perfiles falsos.</li>
              <li>Enviar spam, cadenas, publicidad no autorizada o intentos de estafa.</li>
              <li>Intentar acceder a datos de otros usuarios sin permiso, o vulnerar la seguridad del servicio.</li>
              <li>Automatizar el uso de la app (bots, scripts, scraping) sin permiso escrito.</li>
              <li>Usar la app para actividades ilegales en tu país de residencia.</li>
            </ul>
            <p className="mt-3">
              El incumplimiento de estas normas puede llevar a suspensión temporal, expulsión
              de comunidades, borrado de contenido o eliminación permanente de la cuenta.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">5. Contenido que publicas</h2>
            <p>
              Eres el único responsable de lo que subes a la app (mensajes, imágenes,
              publicaciones en comunidades, eventos, quedadas). Nos concedes una licencia
              gratuita, no exclusiva y limitada a lo estrictamente necesario para
              almacenarlo, mostrarlo a los destinatarios y hacer funcionar el servicio.
              Cuando eliminas contenido o tu cuenta, la licencia termina.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">6. Denuncias y moderación</h2>
            <p>
              Puedes bloquear a otros usuarios en cualquier momento desde su chat o perfil.
              Cuando actives las funciones de denuncia, podrás reportarnos mensajes y
              perfiles que incumplan estas normas — revisaremos cada denuncia con
              prioridad para las que impliquen contacto entre personas (chat, quedadas)
              o riesgo de menores.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">7. Moneda virtual "Volts" y compras</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Los <strong className="text-surface-text">Volts</strong> son una moneda virtual sin valor monetario real fuera de la app. No son convertibles a dinero, no son transferibles a otros usuarios (salvo mediante las funciones que la app ofrezca expresamente) y no se pueden reembolsar salvo cuando la ley lo exija.</li>
              <li>Los accesorios de la mascota y otros bienes virtuales son licencias de uso dentro de la app. No los "posees" fuera del servicio.</li>
              <li>Si compras Volts, la compra es final. Los importes indicados incluyen IVA cuando corresponda.</li>
              <li>Podemos ajustar precios, eliminar o añadir ítems al catálogo. Los ítems ya comprados no pierden acceso salvo suspensión de la cuenta por incumplimiento.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">8. Sorteos y actividades</h2>
            <p>
              SocialBattery permite a comunidades organizar sorteos con premios. La
              participación es <strong className="text-surface-text">gratuita</strong>: no
              se paga con Volts ni con dinero para participar. Los premios los proporciona
              el organizador de la comunidad, no SocialBattery, y las condiciones de
              entrega son responsabilidad de cada comunidad. Consulta las bases de cada
              sorteo antes de participar. Si eres el organizador, cumples las leyes
              aplicables sobre sorteos promocionales de tu país (en España, Ley 13/2011
              y normativa autonómica correspondiente).
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">9. Quedadas y encuentros presenciales</h2>
            <p>
              Las quedadas y eventos organizados desde la app implican encontrarte con
              otras personas físicamente. SocialBattery no verifica la identidad de los
              participantes ni garantiza su comportamiento. Actúa con la misma prudencia
              que tendrías al quedar con desconocidos: prefiere lugares públicos, avisa
              a alguien de confianza, y no compartas datos sensibles.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">10. Ubicación en vivo</h2>
            <p>
              Cuando participas en una quedada, la app puede compartir tu ubicación con
              el resto de participantes durante el tiempo de la quedada. Puedes
              desactivarla en cualquier momento desde los ajustes o revocando el permiso
              del sistema. Solo se comparte con quien decides.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">11. Notificaciones</h2>
            <p>
              Si activas las notificaciones push, podemos avisarte de mensajes, eventos,
              quedadas próximas, sorteos y otras novedades. Puedes desactivarlas desde los
              ajustes de la app o del sistema operativo.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">12. Servicio "tal cual"</h2>
            <p>
              El servicio se presta "tal cual" y "según disponibilidad". Aunque nos
              esforzamos por mantenerlo funcionando, no garantizamos que esté libre de
              errores, interrupciones o pérdidas ocasionales de datos. En la medida
              máxima permitida por la ley, no somos responsables de daños indirectos
              derivados del uso o imposibilidad de uso del servicio.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">13. Cambios</h2>
            <p>
              Podemos actualizar estos términos ocasionalmente. Si hacemos cambios
              importantes te avisaremos dentro de la app. Seguir usando SocialBattery
              después del aviso implica que aceptas los nuevos términos.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">14. Ley aplicable</h2>
            <p>
              Estos términos se rigen por la legislación española. Cualquier disputa se
              somete a los juzgados de la ciudad del domicilio del titular del servicio,
              salvo que la ley obligue a un fuero distinto (por ejemplo, si eres
              consumidor y resides en otro país de la UE).
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">15. Contacto</h2>
            <p>
              Si tienes preguntas sobre estos términos, escríbenos a{' '}
              <a href="mailto:soporte@socialbattery.pro" className="text-accent-glow underline underline-offset-4">
                soporte@socialbattery.pro
              </a>.
            </p>
          </section>
        </div>

        <Link
          to="/auth"
          className="inline-block mt-12 text-accent-glow text-sm underline underline-offset-4"
        >
          ← Volver
        </Link>
      </div>
    </div>
  );
}
