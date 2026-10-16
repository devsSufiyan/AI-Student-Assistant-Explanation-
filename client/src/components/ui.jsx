/**
 * Small shared UI primitives.
 *
 * Extracted so views stay focused on data and behaviour, and so visual
 * consistency (badges, bars, stat cards) is guaranteed by construction rather
 * than by copy-paste.
 */

import React from 'react';

/** A titled surface. */
export function Card({ title, children, right, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || right) && (
        <div className="row" style={{ marginBottom: 14 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          <div className="spacer" />
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** Headline metric card. */
export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/**
 * Horizontal progress bar.
 * @param {number} value 0..1
 * @param {string} tone '', 'success', 'warning', 'danger'
 */
export function Bar({ value, tone = '', thin = false }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`bar ${tone} ${thin ? 'thin' : ''}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Colour-coded mastery chip. */
export function MasteryBadge({ label }) {
  const tone = ['mastered', 'proficient'].includes(label)
    ? 'green'
    : label === 'developing'
      ? 'amber'
      : 'red';
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** Consistent empty state so blank panels still look intentional. */
export function EmptyState({ icon = '📭', title, hint }) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="small" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/** Simple SVG line chart for the accuracy trend (no chart dependency). */
export function Sparkline({ points, height = 68 }) {
  if (!points || points.length === 0) {
    return <div className="muted small">No attempts yet.</div>;
  }

  const width = 320;
  const pad = 6;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [
    pad + i * step,
    height - pad - p.accuracy * (height - pad * 2),
  ]);
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const area = `${line} L${coords.at(-1)[0].toFixed(1)},${height - pad} L${coords[0][0].toFixed(1)},${height - pad} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(99,102,241,0.35)" />
          <stop offset="100%" stopColor="rgba(99,102,241,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkFill)" />
      <path d={line} fill="none" stroke="var(--brand-1)" strokeWidth="2.5" strokeLinejoin="round" />
      {coords.map((c, i) => (
        <circle key={i} cx={c[0]} cy={c[1]} r="3" fill="#fff" stroke="var(--brand-1)" strokeWidth="2" />
      ))}
    </svg>
  );
}
