import React from 'react';

const FLAKES = Array.from({ length: 28 }, (_, i) => ({
  id: i,
  left: `${(i * 3.7 + (i % 5) * 4) % 100}%`,
  size: 4 + (i % 5) * 2,
  duration: `${8 + (i % 7) * 2}s`,
  delay: `-${(i * 1.1) % 10}s`,
  opacity: 0.35 + (i % 4) * 0.15,
}));

export const ChristmasSnow: React.FC<{ active: boolean }> = ({ active }) => {
  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-20 overflow-hidden"
    >
      {FLAKES.map((flake) => (
        <span
          key={flake.id}
          className="snowflake-drop absolute top-0 rounded-full bg-white"
          style={{
            left: flake.left,
            width: `${flake.size}px`,
            height: `${flake.size}px`,
            opacity: flake.opacity,
            animationDuration: flake.duration,
            animationDelay: flake.delay,
          }}
        />
      ))}
    </div>
  );
};
