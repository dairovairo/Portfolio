import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';

// Modal de eliminación de cuenta. Único punto donde vive la lógica, se
// reutiliza desde ProfilePage (zona peligrosa del perfil) y desde
// SettingsPage (bloque de cuenta). El botón queda visible en los dos
// sitios a propósito — Ajustes es el sitio canónico, Perfil es acceso
// rápido cuando el usuario ya está mirándose a sí mismo.
//
// Props:
//   - onClose: cierra el modal sin hacer nada.
//   - onDeleted: se llama tras un borrado con éxito. Debe hacer signOut()
//     para desmontar la app: cuando la respuesta vuelve, la fila del
//     usuario ya no existe y el siguiente request devolvería 401.
export default function DeleteAccountModal({ onClose, onDeleted }) {
  const { showToast } = useToast();
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = confirmation === 'ELIMINAR' && !submitting;

  async function handleDelete() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await api.delete('/users/me', { confirmation: 'ELIMINAR' });
      // No mostramos toast aquí porque signOut() va a desmontar todo.
      onDeleted();
    } catch (err) {
      showToast(err?.message || 'No se pudo eliminar la cuenta. Inténtalo de nuevo.');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-surface-card border border-red-500/30 rounded-2xl p-5 max-w-md w-full">
        <h3 className="font-display font-bold text-red-400 text-lg mb-2">Eliminar cuenta</h3>
        <p className="text-sm text-surface-muted mb-3 leading-relaxed">
          Esta acción es <strong className="text-surface-text">permanente e irreversible</strong>.
          Se eliminarán:
        </p>
        <ul className="text-xs text-surface-muted/80 list-disc pl-5 mb-4 space-y-1">
          <li>Tu perfil, foto, biografía e intereses.</li>
          <li>Tus mensajes y todos tus chats, grupos y quedadas.</li>
          <li>Tus comunidades, eventos, sorteos y participaciones.</li>
          <li>Tu mascota, accesorios comprados, Volts e insignias.</li>
          <li>Tu historial de batería y ubicación.</li>
        </ul>
        <p className="text-xs text-surface-muted mb-2">
          Para confirmar, escribe <strong className="text-red-400 font-mono">ELIMINAR</strong> abajo:
        </p>
        <input
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          placeholder="ELIMINAR"
          autoFocus
          disabled={submitting}
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2 text-sm
            text-surface-text font-mono focus:outline-none focus:border-red-500/50 disabled:opacity-50"
        />
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 bg-surface-bg border border-surface-border text-surface-text rounded-xl py-2.5
              text-sm font-display font-semibold hover:bg-surface-border/40 transition-all disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={!canSubmit}
            className="flex-1 bg-red-500/20 text-red-400 border border-red-500/40 rounded-xl py-2.5
              text-sm font-display font-semibold hover:bg-red-500/30 transition-all
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting ? 'Eliminando...' : 'Eliminar cuenta'}
          </button>
        </div>
      </div>
    </div>
  );
}
