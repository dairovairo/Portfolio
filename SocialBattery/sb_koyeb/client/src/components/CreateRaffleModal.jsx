import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PhotoSourceMenu from './PhotoSourceMenu';
import WalletInline from './WalletInline';
import FreePromoToggle from './FreePromo';
import { api } from '../lib/api';
import { PAYMENTS_ENABLED } from '../lib/features';
import {
  COMMUNITY_RAFFLE_FEE_CENTS, MAX_MONTHS, PRIZE_MAX, RAFFLE_TIER_KEYS, VOLT_MAX_DURATION_DAYS, VOLT_MIN_SUBSCRIBERS,
  VOLT_TICKETS, raffleTier,
} from '../lib/raffleTiers';
import { CATEGORIES, OTHER_CATEGORY, getCategoryEmoji as getEventEmoji } from '../constants/categories';
import { useTranslation } from '../i18n';

const MAX_CATEGORIES = 3;
const RAFFLE_CATEGORIES = [...CATEGORIES.map(c => c.id), OTHER_CATEGORY];
const INPUT = 'w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors';

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(event.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Formulario de sorteo. Los que llevan publicidad (Light o, sin pagos, los
// promocionados) siguen en RaffleAdAudiencePage con estos mismos datos; los
// demás se crean aquí.
export default function CreateRaffleModal({ onClose, onCreate, community }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const minDate = new Date(Date.now() + 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const fmtDatetimeLocal = d =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const defaultDate = fmtDatetimeLocal(minDate);
  const daysFromNow = n => fmtDatetimeLocal(new Date(Date.now() + n * 24 * 3600 * 1000));
  const voltMaxDate = daysFromNow(VOLT_MAX_DURATION_DAYS);
  const imageInputRef = useRef(null);
  const imageCameraRef = useRef(null);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [endsAt, setEndsAt] = useState(daysFromNow(7));
  const [categories, setCategories] = useState([]);
  const [customCategory, setCustomCategory] = useState('');
  const [tier, setTier] = useState('light');
  const [promote, setPromote] = useState(false); // sin pagos
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const emptyPrize = () => ({
    title: '',
    valueEuros: '',
    imageFile: null,
    imagePreview: '',
    showPhotoMenu: false,
    requiresGoal: false,
  });
  const [prizes, setPrizes] = useState([emptyPrize()]);
  // Refs indexadas por posición. Se re-crean si añades/quitas premios,
  // así que se guardan en un solo objeto y se accede con la key numérica.
  const prizeInputRefs = useRef({});
  const prizeCameraRefs = useRef({});
  const [organizerName, setOrganizerName] = useState(community.organization || '');
  const [organizerContact, setOrganizerContact] = useState('');
  const [accepts, setAccepts] = useState(false);
  const [goalEuros, setGoalEuros] = useState('');
  const [billing, setBilling] = useState(null); // GET /payments/me
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!PAYMENTS_ENABLED) return undefined;
    let cancelled = false;
    api.get('/payments/me').then(me => { if (!cancelled) setBilling(me); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const paymentsOn = Boolean(billing?.payments_enabled);
  const withAds = PAYMENTS_ENABLED ? tier === 'light' : promote;
  // La meta colectiva necesita aportaciones reales, o sea, pagos activos.
  const withGoal = tier === 'community' && paymentsOn;
  const needsEnterprise = withGoal && !billing.is_enterprise;
  const needsConnect = withGoal && billing.is_enterprise && !community.collab_available;

  function setPrizeField(idx, field, value) {
    setPrizes(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  async function handlePrizeImageChange(idx, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError(t('raffle.errPrizePhoto', { n: idx + 1 }));
      e.target.value = '';
      return;
    }
    const preview = await readFileAsDataUrl(file);
    setPrizes(prev => prev.map((p, i) => i === idx ? { ...p, imageFile: file, imagePreview: preview } : p));
    setError('');
  }

  function clearPrizeImage(idx) {
    setPrizes(prev => prev.map((p, i) => i === idx ? { ...p, imageFile: null, imagePreview: '' } : p));
    if (prizeInputRefs.current[idx]) prizeInputRefs.current[idx].value = '';
    if (prizeCameraRefs.current[idx]) prizeCameraRefs.current[idx].value = '';
  }

  function addPrize() {
    setPrizes(prev => prev.length >= PRIZE_MAX ? prev : [...prev, emptyPrize()]);
  }

  function removePrize(idx) {
    setPrizes(prev => {
      if (prev.length <= 1) return prev;
      // Limpia refs del premio que se va para no dejar handlers colgados.
      delete prizeInputRefs.current[idx];
      delete prizeCameraRefs.current[idx];
      return prev.filter((_, i) => i !== idx);
    });
  }

  // Convierte el string euros→céntimos. "12", "12.50", "12,50" → 1250.
  // Vacío / no parseable → null (valor opcional, no obligatorio).
  function eurosToCents(str) {
    const s = String(str ?? '').trim().replace(',', '.');
    if (!s) return null;
    const v = Number.parseFloat(s);
    if (!Number.isFinite(v) || v < 0) return null;
    return Math.round(v * 100);
  }

  async function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError(t('communityDetail.errRafflePhoto'));
      e.target.value = '';
      return;
    }
    setImageFile(file);
    setImagePreview(await readFileAsDataUrl(file));
    setError('');
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview('');
    if (imageInputRef.current) imageInputRef.current.value = '';
    if (imageCameraRef.current) imageCameraRef.current.value = '';
  }

  function selectCategory(cat) {
    setCategories(prev => {
      const isSelected = prev.includes(cat);
      if (isSelected) {
        if (cat === OTHER_CATEGORY) setCustomCategory('');
        return prev.filter(c => c !== cat);
      }
      if (prev.length >= MAX_CATEGORIES) return prev;
      return [...prev, cat];
    });
  }

  async function handleSubmit() {
    if (!title.trim()) { setError(t('raffle.errTitle')); return; }
    if (!endsAt) { setError(t('raffle.errEnd')); return; }
    if (new Date(endsAt) <= new Date()) { setError(t('raffle.errEndPast')); return; }
    if (tier === 'volt' && new Date(endsAt) > new Date(voltMaxDate)) {
      setError(t('communityDetail.errVoltMaxDuration', { n: VOLT_MAX_DURATION_DAYS }));
      return;
    }
    if (categories.length < 1) {
      setError(t('raffle.errCategory'));
      return;
    }
    if (categories.includes(OTHER_CATEGORY) && !customCategory.trim()) {
      setError(t('communityDetail.errSpecifyCategory'));
      return;
    }

    const resolvedCategories = categories
      .map(cat => (cat === OTHER_CATEGORY ? customCategory.trim() : cat))
      .filter(Boolean);

    for (let i = 0; i < prizes.length; i++) {
      if (!prizes[i].title.trim()) {
        setError(t('raffle.errPrizeName', { n: i + 1 }));
        return;
      }
      if (prizes[i].valueEuros && eurosToCents(prizes[i].valueEuros) == null) {
        setError(t('communityDetail.errPrizeValue', { n: i + 1 }));
        return;
      }
    }

    const goalCents = withGoal ? eurosToCents(goalEuros) : null;
    if (withGoal) {
      if (!goalCents || goalCents < 500 || goalCents > 1000000) { setError(t('raffle.errGoal')); return; }
      if (!prizes.some(p => p.requiresGoal)) { setError(t('raffle.errExtraPrize')); return; }
      if (prizes.every(p => p.requiresGoal)) { setError(t('raffle.errBasePrize')); return; }
    }
    if (organizerName.trim().length < 3) { setError(t('raffle.errOrganizer')); return; }
    if (organizerContact.trim().length < 5) { setError(t('raffle.errContact')); return; }
    if (!accepts) { setError(t('raffle.errAccept')); return; }

    // El servidor numera los premios según este orden.
    const resolvedPrizes = prizes.map(p => ({
      title: p.title.trim(),
      value_cents: eurosToCents(p.valueEuros),
      requires_goal: withGoal && p.requiresGoal,
      image_file: p.imageFile || null,
    }));

    const draft = {
      title: title.trim(),
      description: description.trim(),
      ends_at: new Date(endsAt).toISOString(),
      categories: resolvedCategories,
      tier,
      image_file: imageFile,
      image_preview: imagePreview,
      prizes: resolvedPrizes,
      organizer_name: organizerName.trim(),
      organizer_contact: organizerContact.trim(),
      organizer_accepts: true,
      goal_cents: goalCents,
    };

    if (withAds) {
      onClose();
      navigate(`/community/${community.id}/raffle-publicidad`, { state: { draft, communityName: community.name } });
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onCreate(draft);
      onClose();
    } catch (e) {
      setInsufficientFunds(e?.code === 'INSUFFICIENT_FUNDS');
      setError(e.message || t('raffle.errCreate'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface-card border border-surface-border rounded-t-3xl sm:rounded-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-6 sm:hidden" />

        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">🎁</span>
          <div>
            <h2 className="font-display font-bold text-surface-text text-lg">{t('communityDetail.createRaffleTitle')}</h2>
            <p className="text-xs text-surface-muted">{community.name}</p>
          </div>
        </div>

        <div className="space-y-4">
          {PAYMENTS_ENABLED && (
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">{t('communityDetail.raffleTierLabel')}</label>
            <div className="space-y-2">
              {RAFFLE_TIER_KEYS.map(key => {
                const selected = tier === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setTier(key);
                      if (key === 'volt' && endsAt && new Date(endsAt) > new Date(voltMaxDate)) setEndsAt(voltMaxDate);
                    }}
                    className={`w-full text-left rounded-xl border px-3.5 py-3 transition-all ${
                      selected ? raffleTier(key).selected : 'border-surface-border bg-surface-bg hover:border-accent-primary/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-display font-bold text-surface-text">
                        {raffleTier(key).emoji} {t(`raffle.tier_${key}`)}
                      </span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-surface-card text-surface-muted border border-surface-border">
                        {t(`raffle.price_${paymentsOn ? key : "volt"}`)}
                      </span>
                    </div>
                    <p className="text-[11px] text-surface-muted leading-relaxed mt-1">{t(`raffle.for_${key}`)}</p>
                    {selected && (
                      <ul className="mt-2 space-y-1 border-t border-surface-border/60 pt-2">
                        {[1, 2, 3].map(i => (
                          <li key={i} className="text-[11px] text-surface-muted/90 flex items-start gap-1.5">
                            <span className="text-accent-glow flex-shrink-0">✓</span>
                            <span>{t(`raffle.inc_${key}_${i}`, { n: VOLT_MIN_SUBSCRIBERS, tickets: VOLT_TICKETS, days: VOLT_MAX_DURATION_DAYS })}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </button>
                );
              })}
            </div>
            {(needsEnterprise || needsConnect) && (
              <div className="mt-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 space-y-1.5">
                <p>{t(needsEnterprise ? 'raffle.needsEnterprise' : 'raffle.needsConnect')}</p>
                <button
                  type="button"
                  onClick={() => navigate(needsEnterprise ? '/shop' : '/wallet')}
                  className="font-display font-semibold text-accent-glow underline"
                >
                  {t(needsEnterprise ? 'raffle.goShop' : 'raffle.goWallet')}
                </button>
              </div>
            )}
          </div>
          )}
          {withGoal && (
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">{t('raffle.goalLabel')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={goalEuros}
                  onChange={e => setGoalEuros(e.target.value)}
                  placeholder="100"
                  maxLength={8}
                  className={INPUT}
                />
                <span className="text-sm text-surface-muted">€</span>
              </div>
              <p className="text-[11px] text-surface-muted mt-1 leading-relaxed">{t('raffle.goalFormHint')}</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">{t('communityDetail.evTitleLabel')}</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('communityDetail.raffleTitlePh')}
              maxLength={120}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              {t('communityDetail.evDescLabel')} <span className="text-slate-600">{t('community.fieldOptional')}</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('communityDetail.raffleDescPh')}
              rows={3}
              maxLength={1000}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">{t('communityDetail.raffleEndAtLabel')}</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={e => setEndsAt(e.target.value)}
              min={defaultDate}
              max={tier === 'volt' ? voltMaxDate : daysFromNow(MAX_MONTHS * 30)}
              className="w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
            />
            {tier === 'volt' && (
              <p className="text-[10px] font-mono text-surface-muted mt-1">
                {t('raffle.voltMaxDays', { n: VOLT_MAX_DURATION_DAYS })}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              {t('raffle.categoriesLabel')} <span className="text-slate-600">({categories.length}/{MAX_CATEGORIES})</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {RAFFLE_CATEGORIES.map(cat => {
                const selected = categories.includes(cat);
                const disabled = !selected && categories.length >= MAX_CATEGORIES;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => selectCategory(cat)}
                    disabled={disabled}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                      selected
                        ? 'border-accent-primary bg-accent-primary/20 text-accent-glow'
                        : disabled
                          ? 'border-surface-border text-slate-700 opacity-40 cursor-not-allowed'
                          : 'border-surface-border text-surface-muted hover:border-accent-primary/30'
                    }`}
                  >
                    {getEventEmoji(cat)} {cat}
                  </button>
                );
              })}
            </div>
            {categories.includes(OTHER_CATEGORY) && (
              <input
                type="text"
                value={customCategory}
                onChange={e => setCustomCategory(e.target.value)}
                placeholder={t('communityDetail.evCategoryPh')}
                maxLength={60}
                className="mt-3 w-full bg-surface-bg border border-surface-border rounded-xl px-4 py-3 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
              />
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-mono text-surface-muted">
                {t('raffle.prizesLabel')} <span className="text-slate-600">({prizes.length}/{PRIZE_MAX})</span>
              </label>
              <button
                type="button"
                onClick={addPrize}
                disabled={prizes.length >= PRIZE_MAX}
                className="text-[11px] font-mono text-accent-glow hover:text-accent-primary transition-colors disabled:text-slate-600 disabled:cursor-not-allowed"
              >
                {t('raffle.addPrize')}
              </button>
            </div>
            <p className="text-[11px] text-surface-muted italic mb-2 leading-relaxed">
              {t('raffle.prizesHint')}
            </p>
            <div className="space-y-2">
              {prizes.map((p, idx) => (
                <div
                  key={idx}
                  className="bg-surface-bg border border-surface-border rounded-xl p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-surface-muted">
                      {t('raffle.prizeN', { n: idx + 1 })}
                    </span>
                    {prizes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePrize(idx)}
                        className="text-[11px] font-mono text-red-300 hover:text-red-200"
                      >
                        {t('communityDetail.photoRemove')}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={p.title}
                    onChange={e => setPrizeField(idx, 'title', e.target.value)}
                    placeholder={t('communityDetail.prizeNamePh')}
                    maxLength={120}
                    className="w-full bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-surface-muted whitespace-nowrap">
                      {t('communityDetail.raffleValueLabel')}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={p.valueEuros}
                      onChange={e => setPrizeField(idx, 'valueEuros', e.target.value)}
                      placeholder={t('communityDetail.prizeValuePh')}
                      maxLength={12}
                      className="flex-1 bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-surface-text placeholder-slate-600 text-sm focus:outline-none focus:border-accent-primary/50 transition-colors"
                    />
                    <span className="text-[11px] font-mono text-surface-muted">€</span>
                  </div>
                  {withGoal && (
                    <label className="flex items-center gap-2 text-[11px] text-surface-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={p.requiresGoal}
                        onChange={e => setPrizeField(idx, 'requiresGoal', e.target.checked)}
                        className="w-4 h-4 accent-red-400"
                      />
                      {t('raffle.extraToggle')}
                    </label>
                  )}
                  {p.imagePreview ? (
                    <div className="overflow-hidden rounded-lg border border-surface-border bg-surface-card">
                      <div className="aspect-[16/9]">
                        <img src={p.imagePreview} alt="" className="h-full w-full object-cover" />
                      </div>
                      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                        <span className="truncate text-[11px] text-surface-muted">{p.imageFile?.name}</span>
                        <button
                          type="button"
                          onClick={() => clearPrizeImage(idx)}
                          className="text-[11px] font-mono text-red-300 hover:text-red-200"
                        >
                          {t('communityDetail.prizePhotoRemove')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPrizeField(idx, 'showPhotoMenu', true)}
                      className="w-full rounded-lg border border-dashed border-accent-primary/30 bg-accent-primary/5 px-3 py-2 text-[12px] font-display font-semibold text-accent-glow hover:bg-accent-primary/10 transition-all"
                    >
                      📷 {t('raffle.prizePhoto')}
                    </button>
                  )}
                  <input
                    ref={el => { prizeInputRefs.current[idx] = el; }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => handlePrizeImageChange(idx, e)}
                  />
                  <input
                    ref={el => { prizeCameraRefs.current[idx] = el; }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => handlePrizeImageChange(idx, e)}
                  />
                  <PhotoSourceMenu
                    open={p.showPhotoMenu}
                    onClose={() => setPrizeField(idx, 'showPhotoMenu', false)}
                    onCamera={() => prizeCameraRefs.current[idx]?.click()}
                    onGallery={() => prizeInputRefs.current[idx]?.click()}
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono text-surface-muted mb-1.5">
              {t('communityDetail.prizePhotoAdd')} <span className="text-slate-600">{t('community.fieldOptional')}</span>
            </label>
            {imagePreview ? (
              <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-bg">
                <div className="aspect-[16/9]">
                  <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="truncate text-xs text-surface-muted">{imageFile?.name}</span>
                  <button
                    type="button"
                    onClick={clearImage}
                    className="text-xs font-display font-semibold text-red-300 hover:text-red-200"
                  >
                    {t('communityDetail.photoRemove')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPhotoMenu(true)}
                className="w-full rounded-xl border border-dashed border-accent-primary/35 bg-accent-primary/5 px-4 py-4 text-sm font-display font-semibold text-accent-glow hover:bg-accent-primary/10 transition-all"
              >
                {t('communityDetail.photoPick')}
              </button>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
            <input
              ref={imageCameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleImageChange}
            />
            <PhotoSourceMenu
              open={showPhotoMenu}
              onClose={() => setShowPhotoMenu(false)}
              onCamera={() => imageCameraRef.current?.click()}
              onGallery={() => imageInputRef.current?.click()}
            />
          </div>

          <div className="space-y-3 border-t border-surface-border/60 pt-4">
            <p className="text-sm font-display font-bold text-surface-text">{t('raffle.organizerTitle')}</p>
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">{t('raffle.organizerName')}</label>
              <input
                value={organizerName}
                onChange={e => setOrganizerName(e.target.value)}
                placeholder={t('raffle.organizerNamePh')}
                maxLength={120}
                className={INPUT}
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-surface-muted mb-1.5">{t('raffle.organizerContact')}</label>
              <input
                value={organizerContact}
                onChange={e => setOrganizerContact(e.target.value)}
                placeholder={t('raffle.organizerContactPh')}
                maxLength={120}
                className={INPUT}
              />
              <p className="text-[10px] text-surface-muted mt-1 leading-relaxed">{t('raffle.organizerContactHint')}</p>
            </div>
            <label className="flex items-start gap-2.5 text-xs text-surface-text leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                checked={accepts}
                onChange={e => setAccepts(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-amber-500 flex-shrink-0"
              />
              <span>{t('raffle.organizerAccepts')}</span>
            </label>
            <p className="text-[11px] text-surface-muted leading-relaxed">{t('raffle.rulesAuto')}</p>
          </div>

          {!PAYMENTS_ENABLED && (
            <FreePromoToggle hint={t('free.promoteRaffleHint')} checked={promote} onChange={setPromote} />
          )}

          {withGoal && <WalletInline neededCents={COMMUNITY_RAFFLE_FEE_CENTS} forceInsufficient={insufficientFunds} />}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim() || !endsAt || needsEnterprise || needsConnect}
            className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-surface-bg font-display font-bold text-sm transition-all disabled:opacity-50 active:scale-[0.98]"
          >
            {saving ? t('raffle.creating') : t(withAds ? 'raffle.setupAds' : 'raffle.createBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
