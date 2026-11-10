import { useMemo, useState } from 'react';
import { PERIODS, UNKNOWN_COLOR, UNKNOWN_PERIOD_ID, periodOf } from '../domain/periods';
import { useStore } from '../state/store';
import { applyFilter } from '../domain/filter';

/** Mindig látható színjelmagyarázat; a korszakok egyenként ki-/bekapcsolhatók. */
export default function Legend() {
  const filter = useStore((s) => s.filter);
  const buildings = useStore((s) => s.buildings);
  const setFilter = useStore((s) => s.setFilter);
  const hidden = filter.hiddenPeriods;
  const [collapsed, setCollapsed] = useState(false);

  // darabszám korszakonként (a korszak-kapcsolót kivéve minden szűrő figyelembevételével)
  const counts = useMemo(() => {
    const list = applyFilter(buildings, { ...filter, hiddenPeriods: [] });
    const m = new Map<string, number>();
    for (const b of list) {
      const id = periodOf(b)?.id ?? UNKNOWN_PERIOD_ID;
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [buildings, filter]);

  const toggle = (id: string) =>
    setFilter({ hiddenPeriods: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id] });

  const rows = [...PERIODS.map((p) => ({ id: p.id, label: p.label, color: p.color })), { id: UNKNOWN_PERIOD_ID, label: 'Ismeretlen', color: UNKNOWN_COLOR }];

  return (
    <div className="legend">
      <div className="legend-head">
        <button className="legend-title" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          {collapsed ? '▸' : '▾'} Építési időszak
        </button>
        <span className="legend-actions" hidden={collapsed}>
          <button className="link" onClick={() => setFilter({ hiddenPeriods: [] })}>mind</button>
          <button className="link" onClick={() => setFilter({ hiddenPeriods: rows.map((r) => r.id) })}>egyik sem</button>
        </span>
      </div>
      <div className="legend-gradient" style={{ background: `linear-gradient(90deg, ${PERIODS.map((p) => p.color).join(',')})` }} />
      {!collapsed && (<>
      <ul>
        {rows.map((r) => {
          const off = hidden.includes(r.id);
          return (
            <li key={r.id}>
              <button className={`legend-row ${off ? 'off' : ''}`} onClick={() => toggle(r.id)} title={off ? 'Bekapcsolás' : 'Kikapcsolás'}>
                <span className="swatch" style={{ background: r.color }} />
                <span className="legend-label">{r.label}</span>
                <span className="legend-count">{counts.get(r.id) ?? 0}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="legend-note">
        <span className="dash-sample" /> szaggatott körvonal: valószínűsített év vagy évintervallum
      </div>
      </>)}
    </div>
  );
}
