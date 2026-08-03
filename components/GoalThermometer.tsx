"use client";

interface GoalThermometerProps {
  name: string;
  targetCents: number;
  currentCents: number;
}

export function GoalThermometer({ name, targetCents, currentCents }: GoalThermometerProps) {
  const pct = targetCents > 0 ? Math.min(100, Math.round((currentCents / targetCents) * 100)) : 0;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{name}</strong>
        <span className="muted">
          ${(currentCents / 100).toFixed(2)} / ${(targetCents / 100).toFixed(2)} ({pct}%)
        </span>
      </div>
      <div className="thermometer">
        <div className="thermometer-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
