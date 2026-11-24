import { useState } from 'react';
import LocationPicker from './LocationPicker';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useTranslation } from '../i18n';

const INPUT = 'w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors';

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Sheet({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display font-bold text-surface-text">{title}</h2>
            {subtitle && <p className="text-xs text-surface-muted mt-0.5 leading-relaxed">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-surface-muted hover:text-surface-text text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-mono text-surface-muted mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// Edición de un evento publicado. Las categorías y el plan no se cambian aquí:
// la promoción en marcha se contrató con ellos.
export function EditEventModal({ event, onClose, onSaved }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    title: event.title || '',
    description: event.description || '',
    organization: event.organization || '',
    event_date: toLocalInput(event.event_date),
    ends_at: toLocalInput(event.ends_at),
    location: event.location || '',
    lat: event.lat ?? null,
    lng: event.lng ?? null,
    url: event.url || '',
    price: event.price != null ? String(event.price) : '',
    additional_info: event.additional_info || '',
    max_attendees: event.max_attendees || 50,
  });
  const [cover, setCover] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const started = new Date(event.event_date) < new Date();

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  function pickCover(e) {
    const file = e.target.files?.[0] || null;
    if (file && file.size > 3 * 1024 * 1024) {
      setError(t('eventManage.errCover'));
      e.target.value = '';
      return;
    }
    setError('');
    setCover(file);
  }

  async function save() {
    if (!form.title.trim() || !form.event_date || !form.location.trim()) {
      setError(t('communityDetail.errFillRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const formData = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (value === null || value === '') return;
        if (key === 'event_date' && value === toLocalInput(event.event_date)) formData.append(key, event.event_date);
        else if (key === 'event_date' || key === 'ends_at') formData.append(key, new Date(value).toISOString());
        else formData.append(key, String(value));
      });
      if (cover) formData.append('cover', cover);
      await api.patchForm(`/community/events/${event.id}`, formData);
      showToast(t('eventManage.saved'), 'success');
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message || t('eventManage.errSave'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={t('eventManage.editTitle')} subtitle={t('eventManage.editHint')} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t('communityDetail.evTitleLabel')}>
          <input value={form.title} onChange={set('title')} maxLength={120} className={INPUT} />
        </Field>
        <Field label={t('communityDetail.evDescLabel')}>
          <textarea value={form.description} onChange={set('description')} rows={3} maxLength={1000} className={`${INPUT} resize-none`} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('communityDetail.evDateLabel')}>
            <input type="datetime-local" value={form.event_date} onChange={set('event_date')} disabled={started} className={`${INPUT} disabled:opacity-50`} />
          </Field>
          <Field label={t('communityDetail.evEndLabel')}>
            <input type="datetime-local" value={form.ends_at} min={form.event_date} onChange={set('ends_at')} className={INPUT} />
          </Field>
        </div>
        <Field label={t('eventDetail.labelLocation')}>
          <LocationPicker
            value={form.location}
            lat={form.lat}
            lng={form.lng}
            onChange={(location, lat, lng) => setForm(f => ({ ...f, location, lat, lng }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('communityDetail.evPriceLabel')}>
            <input type="number" min="0" step="0.01" value={form.price} onChange={set('price')} className={INPUT} />
          </Field>
          <Field label={t('eventManage.maxAttendees')}>
            <input type="number" min="2" max="10000" value={form.max_attendees} onChange={set('max_attendees')} className={INPUT} />
          </Field>
        </div>
        <Field label={t('communityDetail.evOrgLabel')}>
          <input value={form.organization} onChange={set('organization')} maxLength={120} className={INPUT} />
        </Field>
        <Field label="URL">
          <input type="url" value={form.url} onChange={set('url')} maxLength={500} className={INPUT} />
        </Field>
        <Field label={t('communityDetail.evExtraInfoLabel')}>
          <textarea value={form.additional_info} onChange={set('additional_info')} rows={3} maxLength={1000} className={`${INPUT} resize-none`} />
        </Field>
        <Field label={t('communityDetail.evCoverLabel')}>
          <input type="file" accept="image/*" onChange={pickCover} className="w-full text-xs text-surface-muted" />
        </Field>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-accent-primary hover:bg-accent-primary/80 text-white font-display font-bold text-sm transition-all disabled:opacity-50"
        >
          {saving ? '…' : t('eventManage.saveBtn')}
        </button>
      </div>
    </Sheet>
  );
}

export function CancelEventModal({ event, onClose, onCancelled }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function cancel() {
    setSaving(true);
    setError('');
    try {
      await api.post(`/community/events/${event.id}/cancel`, { reason: reason.trim() });
      showToast(t('eventManage.cancelledToast'), 'success');
      await onCancelled();
      onClose();
    } catch (e) {
      setError(e.message || t('eventManage.errCancel'));
      setSaving(false);
    }
  }

  return (
    <Sheet title={t('eventManage.cancelTitle')} subtitle={t('eventManage.cancelHint')} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t('eventManage.reasonLabel')}>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300} placeholder={t('eventManage.reasonPh')} className={`${INPUT} resize-none`} />
        </Field>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-surface-border text-surface-muted text-sm font-display font-semibold">
            {t('eventManage.keepBtn')}
          </button>
          <button type="button" onClick={cancel} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-white text-sm font-display font-semibold disabled:opacity-50">
            {saving ? '…' : t('eventManage.cancelBtn')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
