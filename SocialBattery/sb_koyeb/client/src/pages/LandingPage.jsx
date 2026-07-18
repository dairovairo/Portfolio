import { useNavigate } from 'react-router-dom';

// Landing pública que ven los usuarios NO autenticados en la raíz del
// dominio (https://socialbattery.pro). Antes esa URL redirigía directo
// a /auth (el formulario de login), que apenas tiene texto — Google
// Cloud rechazó la verificación de OAuth por dos motivos relacionados:
//   1. "no se explica el propósito de la app" → el login no cuenta qué
//      es ni para qué sirve SocialBattery.
//   2. "el nombre no coincide con el de la pantalla de consentimiento"
//      → el login no muestra el nombre "SocialBattery" como texto plano
//      legible de forma clara y prominente (solo el wordmark logo).
//
// Esta página soluciona ambos: nombre de la app en un <h1> de texto
// plano exactamente igual al configurado en OAuth consent screen
// ("SocialBattery"), y una descripción explícita de qué hace la app.
//
// Importante para el bot de verificación de Google: esta página debe
// cargar SIN sesión iniciada. Está montada en App.jsx dentro del bloque
// !isAuthenticated, en la ruta "/", así que cualquier visitante sin
// login la ve directamente al entrar en el dominio.
export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-surface-bg text-surface-text noise">
      {/* Background gradient — mismo estilo que AuthPage para coherencia visual */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-green-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-2xl mx-auto px-6 py-16">
        {/* Logo + nombre en texto plano — el <h1> es el nombre exacto de
            la app tal como está configurado en Google OAuth consent
            screen, para que el bot de verificación pueda hacer match
            directo entre ambos nombres. */}
        <header className="text-center mb-14">
          <img src="/logo-icon.png" alt="SocialBattery" className="h-14 w-auto mx-auto mb-5" />
          <h1 className="font-display text-4xl font-800 tracking-tight mb-3">
            SocialBattery
          </h1>
          <p className="text-surface-muted text-base font-body max-w-md mx-auto">
            La app social para compartir tu energía social del día, quedar
            con amigos y descubrir eventos y comunidades cerca de ti.
          </p>
        </header>

        {/* Explicación del propósito — texto plano, sin depender de
            imágenes, para que quede claro para cualquier lector
            (humano o automatizado) qué hace la aplicación. */}
        <section className="mb-14 space-y-5 text-sm leading-relaxed text-surface-muted">
          <p>
            <strong className="text-surface-text">SocialBattery</strong> es
            una red social pensada para gente honesta con su energía: cada
            usuario indica su "batería social" del momento — desde 0% (necesito
            estar solo) hasta 100% (con ganas de todo) — y decide con quién
            compartirla.
          </p>
          <p>
            Con la app puedes chatear con amigos y grupos, unirte a
            comunidades con intereses afines, apuntarte a quedadas ("pools")
            organizadas por otros usuarios, participar en eventos y sorteos
            de tu comunidad, y personalizar tu propia mascota dentro de la
            app.
          </p>
        </section>

        {/* Qué puedes hacer — lista concreta de funciones, refuerza el
            "purpose" ante cualquier revisor (humano o automatizado). */}
        <section className="mb-14">
          <h2 className="font-display text-lg font-semibold mb-4">Qué puedes hacer</h2>
          <ul className="grid gap-3 text-sm text-surface-muted">
            <li className="flex gap-3">
              <span className="text-accent-glow">⚡</span>
              Compartir tu nivel de energía social con tus amigos
            </li>
            <li className="flex gap-3">
              <span className="text-accent-glow">💬</span>
              Chatear en privado, en grupo o dentro de tu comunidad
            </li>
            <li className="flex gap-3">
              <span className="text-accent-glow">📍</span>
              Unirte a quedadas y eventos cerca de ti
            </li>
            <li className="flex gap-3">
              <span className="text-accent-glow">🎟️</span>
              Participar en sorteos organizados por tu comunidad
            </li>
            <li className="flex gap-3">
              <span className="text-accent-glow">🏅</span>
              Conseguir insignias y personalizar tu mascota
            </li>
          </ul>
        </section>

        {/* CTAs — llevan al formulario real de login/registro */}
        <section className="flex flex-col sm:flex-row gap-3 mb-16">
          <button
            onClick={() => navigate('/auth')}
            className="flex-1 bg-accent-primary hover:bg-accent-primary/80 text-surface-text font-display font-semibold py-3 rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-accent-primary/20"
          >
            Crear cuenta
          </button>
          <button
            onClick={() => navigate('/auth')}
            className="flex-1 bg-surface-card border border-surface-border hover:border-accent-primary/50 text-surface-text font-display font-semibold py-3 rounded-xl transition-colors duration-200"
          >
            Ya tengo cuenta
          </button>
        </section>

        <footer className="text-center text-xs text-surface-muted/60 font-mono space-y-2">
          <p>SocialBattery · Hecho con ⚡</p>
          <p>
            <a href="/privacidad" className="underline underline-offset-4 hover:text-surface-muted">
              Política de privacidad
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
