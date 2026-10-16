/**
 * Small shared UI primitives.
 *
 * Extracted so views stay focused on data and behaviour, and so visual
 * consistency (badges, bars, stat cards) is guaranteed by construction rather
 * than by copy-paste.
 */

import React from 'react';

/** A titled surface. */
export function Card({ title, children, right }) {
  return (
    <div className="card">
      {(title || right) && (
        <div className="row" style={{ marginBottom: 12 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          <div className="spacer" />
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** Big-number stat used on the dashboard. */
export function Stat({ label, value, hint }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="small muted" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/**
 * A horizontal progress bar.
 * @param {number} value  0..1
 * @param {string} tone   '', 'success', 'warning', 'danger'
 */
export function Bar({ value, tone = '' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`bar ${tone}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Colour-coded mastery label. */
export function MasteryBadge({ label }) {
  const tone =
    label === 'mastered' ? 'green' : label === 'proficient' ? 'green' : label === 'developing' ? 'amber' : 'red';
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** Simple SVG line chart for the accuracy trend (avoids a chart dependency). */
export function Sparkline({ points, height = 60 }) {
  if (!points || points.length === 0) {
    return <div className="muted small">No attempts yet.</div>;
  }
  const width = 320;
  const max = 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((p, i) => [i * step, height - (p.accuracy / max) * height]);
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" />
      {coords.map((c, i) => (
        <circle key={i} cx={c[0]} cy={c[1]} r="2.5" fill="var(--primary)" />
      ))}
    </svg>
  );
}
