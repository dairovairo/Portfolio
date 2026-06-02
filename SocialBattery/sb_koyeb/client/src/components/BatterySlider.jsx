import { useRef, useCallback, useEffect } from 'react';
import { getBatteryColor } from '../lib/battery';

export default function BatterySlider({ value, onChange, readonly = false, isEstimated = false }) {
  const color = getBatteryColor(value);
  const barRef = useRef(null);
  const isDragging = useRef(false);

  const segments = Array.from({ length: 20 }, (_, i) => {
    const segLevel = (i + 1) * 5;
    const filled = segLevel <= value;
    const segColor = getBatteryColor(segLevel);
    return { i, filled, hex: segColor.hex };
  });

  // Calculate new battery value from a pointer/touch X position relative to the bar
  const valueFromEvent = useCallback((clientX) => {
    const bar = barRef.current;
    if (!bar) return value;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // Round to nearest 5 to match the 20 segments
    return Math.round((ratio * 100) / 5) * 5;
  }, [value]);

  const handleMove = useCallback((clientX) => {
    if (readonly || !isDragging.current) return;
    const newVal = valueFromEvent(clientX);
    if (newVal !== value) onChange(newVal);
  }, [readonly, value, onChange, valueFromEvent]);

  const handleStart = useCallback((clientX) => {
    if (readonly) return;
    isDragging.current = true;
    const newVal = valueFromEvent(clientX);
    onChange(newVal);
  }, [readonly, onChange, valueFromEvent]);

  const handleEnd = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Mouse events
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    handleStart(e.clientX);
  }, [handleStart]);

  const onMouseMove = useCallback((e) => {
    handleMove(e.clientX);
  }, [handleMove]);

  // Touch events
  const onTouchStart = useCallback((e) => {
    handleStart(e.touches[0].clientX);
  }, [handleStart]);

  const onTouchMove = useCallback((e) => {
    e.preventDefault();
    if (isDragging.current) handleMove(e.touches[0].clientX);
  }, [handleMove]);

  // Global listeners for drag outside the element
  useEffect(() => {
    const onUp = () => handleEnd();
    const onGlobalMove = (e) => {
      if (!isDragging.current) return;
      const clientX = e.touches ? e.touches[0]?.clientX : e.clientX;
      if (clientX !== undefined) handleMove(clientX);
    };

    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onGlobalMove);
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchmove', onGlobalMove, { passive: false });

    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onGlobalMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchmove', onGlobalMove);
    };
  }, [handleEnd, handleMove]);

  return (
    <div className="w-full">
      {/* Interactive battery bar */}
      <div className="relative mb-6">
        <div
          ref={barRef}
          className={`flex items-center gap-1 h-10 ${!readonly ? 'cursor-ew-resize select-none touch-none' : ''}`}
          onMouseDown={!readonly ? onMouseDown : undefined}
          onTouchStart={!readonly ? onTouchStart : undefined}
          onTouchMove={!readonly ? onTouchMove : undefined}
          role={!readonly ? 'slider' : undefined}
          aria-valuenow={!readonly ? value : undefined}
          aria-valuemin={!readonly ? 0 : undefined}
          aria-valuemax={!readonly ? 100 : undefined}
          onKeyDown={!readonly ? (e) => {
            if (e.key === 'ArrowRight') onChange(Math.min(100, value + 5));
            if (e.key === 'ArrowLeft') onChange(Math.max(0, value - 5));
          } : undefined}
          tabIndex={!readonly ? 0 : undefined}
        >
          {segments.map(({ i, filled, hex }) => (
            <div
              key={i}
              className="flex-1 h-full rounded-sm transition-all duration-150"
              style={{
                backgroundColor: filled ? hex : '#1e1e2e',
                opacity: filled ? 1 : 0.5,
                boxShadow: filled ? `0 0 6px ${hex}40` : 'none',
              }}
            />
          ))}
          {/* Battery tip */}
          <div className="w-2 h-4 bg-slate-600 rounded-r-sm ml-0.5 flex-shrink-0" />
        </div>

        {/* Drag hint */}
        {!readonly && (
          <p className="text-center text-xs text-surface-muted/50 mt-1.5 font-mono select-none">
            ← desliza para ajustar →
          </p>
        )}
      </div>

      {/* Level display */}
      <div className="text-center mb-6">
        <span
          className="font-display text-7xl font-800 tabular-nums transition-colors duration-200"
          style={{ color: color.hex, textShadow: `0 0 40px ${color.hex}60` }}
        >
          {value}
        </span>
        <span className="font-display text-2xl text-surface-muted ml-1">%</span>
        <div
          className="text-sm font-mono mt-1 uppercase tracking-widest transition-colors duration-200"
          style={{ color: color.hex }}
        >
          {color.label}
        </div>
        {isEstimated && (
          <div className="mt-2 inline-flex items-center gap-1.5 bg-yellow-500/15 border border-yellow-500/25 text-yellow-400 text-xs font-mono px-3 py-1.5 rounded-full">
            <span>⚡</span>
            <span>Batería estimada por IA · No actualizada hoy</span>
          </div>
        )}
      </div>
    </div>
  );
}
