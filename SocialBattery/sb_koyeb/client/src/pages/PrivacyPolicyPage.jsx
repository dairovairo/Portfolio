import { Link } from 'react-router-dom';
import LogoWordmark from '../components/LogoWordmark';

// Página pública de política de privacidad. Montada en App.jsx FUERA de
// la lógica de gating por sesión (ver comentario ahí) para que sea
// accesible sin login — necesario porque el bot de verificación de
// Google Cloud (OAuth consent screen → Privacy Policy link) tiene que
// poder cargarla sin autenticarse, igual que cualquier usuario que
// quiera leerla antes de registrarse.
//
// Contenido genérico pero ajustado a los datos que la app realmente
// recoge (ver AuthContext, AuthPage, server/routes/*). No es un texto
// legal certificado por un abogado — si el proyecto crece o entra en
// mercados con más regulación (RGPD estricto, menores de edad, pagos),
// conviene que lo revise alguien especializado.
export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-surface-bg text-surface-text">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-10 flex items-center gap-2">
          <img src="/logo-icon.png" alt="SocialBattery" className="h-8 w-auto" />
          <span className="font-display text-xl font-bold">
            <LogoWordmark />
          </span>
        </div>

        <h1 className="font-display text-3xl font-bold mb-2">Política de Privacidad</h1>
        <p className="text-surface-muted text-sm mb-10">Última actualización: julio de 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-surface-muted">
          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">1. Quiénes somos</h2>
            <p>
              SocialBattery ("la app", "nosotros") es una aplicación social que permite a
              sus usuarios compartir su nivel de energía social, participar en eventos,
              comunidades, sorteos y chats. Esta política explica qué datos recogemos,
              para qué los usamos y qué derechos tienes sobre ellos.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">2. Datos que recogemos</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong className="text-surface-text">Cuenta:</strong> email y contraseña (o, si inicias sesión con Google, tu nombre, email y foto de perfil asociados a tu cuenta de Google).</li>
              <li><strong className="text-surface-text">Perfil:</strong> nombre de usuario, biografía, foto de perfil, intereses y nivel de batería social.</li>
              <li><strong className="text-surface-text">Contenido que generas:</strong> mensajes, imágenes que envías en chats, publicaciones en comunidades, participación en pools y eventos.</li>
              <li><strong className="text-surface-text">Ubicación:</strong> sólo si nos das permiso explícito, para mostrarte eventos cercanos o funciones de localización en pools activos.</li>
              <li><strong className="text-surface-text">Notificaciones push:</strong> el token de tu dispositivo, si activas las notificaciones.</li>
              <li><strong className="text-surface-text">Datos técnicos:</strong> información básica de uso de la app para mantenimiento y prevención de abusos.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">3. Inicio de sesión con Google</h2>
            <p>
              Si eliges "Entrar con Google", usamos el sistema de autenticación de Google
              (a través de Supabase Auth) únicamente para verificar tu identidad y crear o
              acceder a tu cuenta. Sólo solicitamos los permisos básicos de perfil (nombre,
              email y foto) — no accedemos a tu Gmail, Google Drive, contactos ni ningún
              otro dato de tu cuenta de Google.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">4. Para qué usamos tus datos</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Crear y mantener tu cuenta y perfil.</li>
              <li>Mostrarte contenido relevante (eventos, sorteos, comunidades) según tus intereses y ubicación aproximada.</li>
              <li>Permitir la mensajería y funciones sociales entre usuarios.</li>
              <li>Enviarte notificaciones que hayas activado.</li>
              <li>Mantener la seguridad de la plataforma y prevenir el uso indebido.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">5. Con quién compartimos datos</h2>
            <p>
              No vendemos tus datos a terceros. Usamos proveedores de infraestructura para
              operar la app — Supabase (base de datos, autenticación y almacenamiento) y
              Koyeb (hosting del servidor) — que procesan datos en nuestro nombre bajo sus
              propias políticas de seguridad. Tu nombre de usuario, foto y contenido que
              publiques en espacios sociales (comunidades, eventos, chats de grupo) son
              visibles para otros usuarios según la configuración de privacidad que elijas.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">6. Tus derechos</h2>
            <p>
              Puedes acceder, corregir o eliminar tus datos personales en cualquier
              momento desde los ajustes de la app, o escribiéndonos a la dirección de
              contacto indicada más abajo. Puedes eliminar tu cuenta cuando quieras;
              al hacerlo, tu perfil y contenido asociado se eliminan según lo descrito
              en los ajustes de privacidad de la app.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">7. Conservación de datos</h2>
            <p>
              Conservamos tus datos mientras tu cuenta esté activa. Si eliminas tu cuenta,
              tus datos personales se eliminan o anonimizan en un plazo razonable, salvo
              que la ley exija conservarlos más tiempo.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">8. Cambios en esta política</h2>
            <p>
              Podemos actualizar esta política ocasionalmente. Si hacemos cambios
              importantes, te avisaremos dentro de la app.
            </p>
          </section>

          <section>
            <h2 className="text-surface-text font-display font-semibold text-lg mb-2">9. Contacto</h2>
            <p>
              Si tienes preguntas sobre esta política o tus datos, puedes escribirnos a{' '}
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
