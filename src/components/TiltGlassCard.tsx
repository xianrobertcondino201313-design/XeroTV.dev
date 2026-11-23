import React, { useEffect, useState } from 'react';
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
  const [motionEnabled, setMotionEnabled] = useState(() => loadAppSettings().motion3dEnabled);
  const [tilt, setTilt] = useState<{ rx: number; ry: number; gx: number; gy: number; active: boolean }>({
    rx: 0,
    ry: 0,
    gx: 50,
    gy: 50,
    active: false,
  });

  useEffect(() => {
    return subscribeAppSettings((s) => setMotionEnabled(s.motion3dEnabled));
  }, []);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const allow3d = motionEnabled && !reducedMotion;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!allow3d || e.pointerType === 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    const ry = (xPct - 0.5) * 2 * intensity;
    const rx = -(yPct - 0.5) * 2 * intensity;
    setTilt({
      rx,
      ry,
      gx: Math.round(xPct * 100),
      gy: Math.round(yPct * 100),
      active: true,
    });
  };

  const handlePointerLeave = () => {
    if (!tilt.active) return;
    setTilt({ rx: 0, ry: 0, gx: 50, gy: 50, active: false });
  };

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`liquid-glass-3d glass-slash-sheen ${className}`}
      style={
        allow3d && tilt.active
          ? {
              transform: `perspective(920px) rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg) translateZ(4px)`,
              backgroundImage: `radial-gradient(circle at ${tilt.gx}% ${tilt.gy}%, rgba(255,255,255,0.12), transparent 55%)`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
};
