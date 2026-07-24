import { useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';

// Modal reutilizable de "Denunciar contenido/usuario". Se usa desde:
//   - Menú de opciones de un chat 1:1 (denunciar al otro usuario)
//   - Long-press sobre un mensaje (denunciar el mensaje)
//   - Long-press sobre un mensaje de grupo/quedada/comunidad
//   - Menú de una publicación de hilo de comunidad
//   - Menú de un evento o comunidad
//   - Perfil ajeno (denunciar perfil)
//
// Props:
//   - targetType: uno de los enums que acepta el backend
//     ('user', 'message', 'group_message', 'pool_message',
//     'community_message', 'community_post', 'event', 'pool',
//     'community', 'other'). Ver server/routes/reports.js.
//   - targetId: UUID del contenido/usuario denunciado.
//   - targetLabel: string corto que aparece en el modal para dar
//     contexto ("este mensaje", "@juan", "esta publicación"). Opcional.
//   - onClose: se llama tanto al cancelar como al enviar con éxito.
//
// Un mismo usuario solo puede tener una denuncia pendiente por target
// (constraint del esquema). Si envía otra sobre el mismo target antes de
// que se revise, el backend hace UPSERT y actualiza motivo/detalles —
// desde la UI se percibe como "actualicé mi denuncia", que es lo esperado.

const REASONS = [
  { id: 'spam',           label: 'Spam o publicidad no deseada' },
  { id: 'harassment',     label: 'Acoso, insultos o intimidación' },
  { id: 'hate',           label: 'Discurso de odio o discriminación' },
  { id: 'sexual',         label: 'Contenido sexual o desnudos' },
  { id: 'minor',          label: 'Contenido que implica a menores', highlight: true },
  { id: 'dangerous',      label: 'Contenido peligroso o amenazas' },
  { id: 'impersonation',  label: 'Suplantación de identidad' },
  { id: 'other',          label: 'Otro motivo' },
];

export default function ReportModal({ targetType, targetId, targetLabel, onClose }) {
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await api.post('/reports', {
        target_type: targetType,
        target_id: targetId,
        reason,
        details: details.trim() || undefined,
      });
      showToast('Gracias. Revisaremos la denuncia lo antes posible.');
      onClose();
    } catch (err) {
      showToast(err?.message || 'No se pudo enviar la denuncia.');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-surface-card border border-surface-border rounded-t-2xl sm:rounded-2xl p-5 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display font-bold text-surface-text text-lg">Denunciar</h3>
            {targetLabel && (
              <p className="text-xs text-surface-muted mt-0.5">{targetLabel}</p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-surface-muted hover:text-surface-text text-xl leading-none px-1"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-surface-muted mb-4 leading-relaxed">
          Elige el motivo que mejor describa el problema. Revisamos todas las
          denuncias — las que impliquen a menores o riesgo físico tienen
          prioridad.
        </p>

        <div className="space-y-1.5 mb-4">
          {REASONS.map((r) => (
            <label
              key={r.id}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-colors
                border ${reason === r.id
                  ? 'border-accent-primary/60 bg-accent-primary/10'
                  : 'border-surface-border bg-surface-bg hover:bg-surface-border/30'}`}
            >
              <input
                type="radio"
                name="reason"
                value={r.id}
                checked={reason === r.id}
                onChange={(e) => setReason(e.target.value)}
                className="h-4 w-4 shrink-0 text-accent-primary focus:ring-accent-primary/40"
              />
              <span className={`text-sm ${r.highlight ? 'text-red-400 font-semibold' : 'text-surface-text'}`}>
                {r.label}
              </span>
            </label>
          ))}
        </div>

        <label className="block text-xs text-surface-muted mb-1.5">
          Detalles adicionales (opcional)
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value.slice(0, 1000))}
          placeholder="Explica brevemente el contexto si crees que ayuda a la revisión…"
          rows={3}
          disabled={submitting}
          className="w-full bg-surface-bg border border-surface-border rounded-xl px-3 py-2 text-sm
            text-surface-text focus:outline-none focus:border-accent-primary/50 resize-none disabled:opacity-50"
        />
        <p className="text-[10px] text-surface-muted/60 text-right mt-1 font-mono">
          {details.length}/1000
        </p>

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
            onClick={handleSubmit}
            disabled={!reason || submitting}
            className="flex-1 bg-red-500/20 text-red-400 border border-red-500/40 rounded-xl py-2.5
              text-sm font-display font-semibold hover:bg-red-500/30 transition-all
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting ? 'Enviando...' : 'Enviar denuncia'}
          </button>
        </div>
      </div>
    </div>
  );
}
