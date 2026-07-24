import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

// Pantalla obligatoria que se muestra cuando el usuario autenticado tiene
// `terms_accepted_at` = null en la BD (columna añadida en phase 130).
// Se dispara en App.jsx justo antes de las rutas privadas.
//
// El caso principal que resuelve: registro por primera vez con Google o
// Apple desde el tab "Entrar". El cliente no puede pedir el checkbox en
// ese tab (rompería la UX del 99% que ya tiene cuenta), así que hasta que
// no aceptan aquí, no ven la app.
//
// El caso email/registro normal (que sí tiene checkbox previo al signUp)
// llama a acceptTerms() automáticamente tras el signUp, así que no llega
// aquí — pero si por alguna razón fallara ese POST, este gate lo cazaría.

export default function TermsGate() {
  const { acceptTerms, signOut } = useAuth();
  const { showToast } = useToast();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    if (!accepted || submitting) return;
    setSubmitting(true);
    try {
      await acceptTerms();
      // No hace falta navegar: AuthContext refresca profile,
      // hasAcceptedTerms pasa a true y App.jsx desmonta este gate.
    } catch (err) {
      showToast(err?.message || 'No se pudo registrar la aceptación. Inténtalo de nuevo.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-bg text-surface-text flex items-center justify-center px-6 py-10">
      <div className="max-w-md w-full">
        <img src="/logo-icon.png" alt="SocialBattery" className="h-10 w-auto mx-auto mb-6" />

        <h1 className="font-display text-2xl font-bold text-center mb-2">Antes de continuar</h1>
        <p className="text-sm text-surface-muted text-center mb-8 leading-relaxed">
          Para usar SocialBattery necesitamos que confirmes tu edad y aceptes
          nuestros términos.
        </p>

        <label className="flex items-start gap-3 bg-surface-card border border-surface-border rounded-2xl p-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded border-surface-border bg-surface-bg
              text-accent-primary focus:ring-accent-primary/40 focus:ring-offset-0 shrink-0"
          />
          <span className="text-sm text-surface-text leading-relaxed">
            Confirmo que tengo al menos <strong>16 años</strong> y acepto los{' '}
            <Link to="/terminos" target="_blank" className="text-accent-glow underline underline-offset-2">
              Términos y Condiciones
            </Link>{' '}
            y la{' '}
            <Link to="/privacidad" target="_blank" className="text-accent-glow underline underline-offset-2">
              Política de Privacidad
            </Link>.
          </span>
        </label>

        <button
          onClick={handleContinue}
          disabled={!accepted || submitting}
          className="mt-4 w-full bg-accent-primary hover:bg-accent-primary/80 disabled:opacity-40
            disabled:cursor-not-allowed text-surface-text font-display font-semibold py-3 rounded-xl
            transition-all duration-200 hover:shadow-lg hover:shadow-accent-primary/20"
        >
          {submitting ? 'Continuando...' : 'Continuar'}
        </button>

        <button
          onClick={signOut}
          disabled={submitting}
          className="mt-3 w-full text-surface-muted hover:text-surface-text text-sm font-display
            font-semibold py-2 transition-colors disabled:opacity-50"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
