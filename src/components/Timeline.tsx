import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { TIME_PRESETS, YEAR_MAX, YEAR_MIN, applyFilter } from '../domain/filter';
import { PERIODS, periodForYear, representativeYear } from '../domain/periods';

const BIN = 5;

/** Alsó idővonal: hisztogram + kétvégű csúszka + korszak-előbeállítások + animáció. */
export default function Timeline() {
  const buildings = useStore((s) => s.buildings);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const range = filter.yearRange ?? [YEAR_MIN, YEAR_MAX];

  // hisztogram a többi szűrő figyelembevételével (az időszűrés nélkül)
  const bins = useMemo(() => {
    const list = applyFilter(buildings, { ...filter, yearRange: null });
    const n = Math.ceil((YEAR_MAX - YEAR_MIN) / BIN);
    const arr = new Array(n).fill(0);
    for (const b of list) {
      const y = representativeYear(b.construction);
      if (y == null) continue;
      const i = Math.min(n - 1, Math.max(0, Math.floor((y - YEAR_MIN) / BIN)));
      arr[i]++;
    }
    return arr as number[];
  }, [buildings, filter]);
  const max = Math.max(1, ...bins);

  const setRange = (r: [number, number]) => {
    const a = Math.min(r[0], r[1]), b = Math.max(r[0], r[1]);
    setFilter({ yearRange: a <= YEAR_MIN && b >= YEAR_MAX ? null : [a, b] });
  };

  // Animáció: kumulatív beépülés 1800-tól 5 éves lépésekben
  useEffect(() => {
    if (!playing) return;
    let y = 1800;
    setFilter({ yearRange: [YEAR_MIN, y] });
    timer.current = window.setInterval(() => {
      y += BIN;
      if (y > 2025) {
        setPlaying(false);
        return;
      }
      setFilter({ yearRange: [YEAR_MIN, y] });
    }, 260);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, setFilter]);

  const pct = (y: number) => ((y - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100;
  const label = (y: number, end: boolean) => (end ? (y >= YEAR_MAX ? 'ma' : y) : y <= YEAR_MIN ? 'kezdetektől' : y);

  return (
    <div className="timeline">
      <div className="tl-controls">
        <button className={`btn small ${playing ? 'primary' : ''}`} onClick={() => setPlaying(!playing)} title="Beépülés animációja">
          {playing ? '❚❚ Leállítás' : '▶ Animáció'}
        </button>
        <div className="tl-range">
          <strong>{label(range[0], false)}</strong> – <strong>{label(range[1], true)}</strong>
          {filter.yearRange && <button className="icon-btn" title="Időszűrés törlése" onClick={() => { setPlaying(false); setRange([YEAR_MIN, YEAR_MAX]); }}>✕</button>}
        </div>
        <div className="tl-presets">
          {TIME_PRESETS.map((p) => {
            const on = filter.yearRange && filter.yearRange[0] === p.range[0] && filter.yearRange[1] === p.range[1];
            return (
              <button key={p.label} className={`chip ${on ? 'on' : ''}`} onClick={() => setRange(on ? [YEAR_MIN, YEAR_MAX] : p.range)}>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="tl-track">
        <div className="tl-hist">
          {bins.map((v, i) => {
            const y = YEAR_MIN + i * BIN;
            const inRange = y + BIN - 1 >= range[0] && y <= range[1];
            return (
              <div
                key={i}
                className="tl-bar"
                style={{ height: `${(v / max) * 100}%`, background: periodForYear(y + 2)?.color ?? '#bbb', opacity: inRange ? 0.95 : 0.22 }}
                title={`${y}–${y + BIN - 1}: ${v} épület`}
              />
            );
          })}
        </div>
        <div className="tl-sel" style={{ left: `${pct(range[0])}%`, width: `${pct(range[1]) - pct(range[0])}%` }} />
        <input
          className="tl-thumb"
          type="range"
          min={YEAR_MIN}
          max={YEAR_MAX}
          step={1}
          value={range[0]}
          onChange={(e) => setRange([Number(e.target.value), range[1]])}
          aria-label="Időszak kezdete"
        />
        <input
          className="tl-thumb"
          type="range"
          min={YEAR_MIN}
          max={YEAR_MAX}
          step={1}
          value={range[1]}
          onChange={(e) => setRange([range[0], Number(e.target.value)])}
          aria-label="Időszak vége"
        />
        <div className="tl-axis">
          {[1700, 1750, 1800, 1850, 1900, 1950, 2000].map((y) => (
            <span key={y} style={{ left: `${pct(y)}%` }}>{y}</span>
          ))}
        </div>
        <div className="tl-periods">
          {PERIODS.map((p) => {
            const a = Math.max(YEAR_MIN, p.from), b = Math.min(YEAR_MAX, p.to + 1);
            return <span key={p.id} style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%`, background: p.color }} title={p.label} />;
          })}
        </div>
      </div>
    </div>
  );
}
