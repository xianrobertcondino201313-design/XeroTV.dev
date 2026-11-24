import React, { useEffect, useRef, useState } from 'react';
import { loadAppSettings, subscribeAppSettings } from '../utils/settings';

interface TiltGlassCardProps {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
}

export const TiltGlassCard: React.FC<TiltGlassCardProps> = ({
  children,
  className = '',
  intensity = 7,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [motionEnabled, setMotionEnabled] = useState(() => loadAppSettings().motion3dEnabled);

  useEffect(() => {
    return subscribeAppSettings((s) => setMotionEnabled(s.motion3dEnabled));
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const allow3d = motionEnabled && !reducedMotion;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!allow3d || e.pointerType === 'touch') return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    const ry = (xPct - 0.5) * 2 * intensity;
    const rx = -(yPct - 0.5) * 2 * intensity;
    const gx = Math.round(xPct * 100);
    const gy = Math.round(yPct * 100);

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.style.transform = `perspective(920px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(4px)`;
      el.style.backgroundImage = `radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.10), transparent 55%)`;
    });
  };

  const handlePointerLeave = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const el = cardRef.current;
    if (el) {
      el.style.transform = '';
      el.style.backgroundImage = '';
    }
  };

  return (
    <div
      ref={cardRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`liquid-glass-3d glass-slash-sheen ${className}`}
    >
      {children}
    </div>
  );
};
