import { useEffect, useState } from 'react';

/**
 * BadgeUnlockModal — celebration popup when the user earns a new badge.
 * Usage:
 *   <BadgeUnlockModal badges={newBadges} onClose={() => setNewBadges([])} />
 *
 * `badges` is an array of badge objects: { id, name, emoji, description }
 * The modal shows them one at a time with an animation.
 */
export default function BadgeUnlockModal({ badges = [], onClose }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (badges.length > 0) {
      setIndex(0);
      // Small delay for slide-in effect
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [badges]);

  if (!badges.length || !visible) return null;

  const badge = badges[index];

  function handleNext() {
    if (index < badges.length - 1) {
      setIndex(i => i + 1);
    } else {
      setVisible(false);
      setTimeout(onClose, 300);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-fade-in"
        onClick={handleNext}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-sm bg-surface-card border border-accent-primary/40 rounded-3xl p-7 shadow-2xl shadow-accent-primary/20 animate-slide-up text-center"
          onClick={e => e.stopPropagation()}
        >
          {/* Sparkle header */}
          <div className="text-xs font-mono uppercase tracking-widest text-accent-glow mb-4 flex items-center justify-center gap-2">
            <span>✨</span>
            <span>¡Insignia desbloqueada!</span>
            <span>✨</span>
          </div>

          {/* Badge emoji with glow */}
          <div
            className="w-24 h-24 mx-auto mb-5 rounded-full flex items-center justify-center text-5xl border-2 border-accent-primary/50"
            style={{
              background: 'radial-gradient(circle at 50% 50%, rgba(0,148,158,0.25) 0%, transparent 70%)',
              boxShadow: '0 0 40px rgba(0,148,158,0.4), 0 0 80px rgba(0,148,158,0.15)',
            }}
          >
            {badge.emoji}
          </div>

          {/* Badge name */}
          <h2 className="font-display font-bold text-surface-text text-2xl mb-2">
            {badge.name}
          </h2>

          {/* Description */}
          <p className="text-surface-muted text-sm leading-relaxed mb-6">
            {badge.description}
          </p>

          {/* Progress indicator (multiple badges) */}
          {badges.length > 1 && (
            <div className="flex gap-1.5 justify-center mb-5">
              {badges.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === index
                      ? 'w-6 bg-accent-glow'
                      : i < index
                      ? 'w-3 bg-accent-primary/60'
                      : 'w-3 bg-surface-border'
                  }`}
                />
              ))}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleNext}
            className="w-full bg-accent-primary hover:bg-accent-glow text-surface-text font-display font-bold py-3 rounded-2xl transition-all active:scale-95 text-sm"
          >
            {index < badges.length - 1 ? `Siguiente (${index + 1}/${badges.length})` : '¡Genial! 🎉'}
          </button>
        </div>
      </div>
    </>
  );
}
