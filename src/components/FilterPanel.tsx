import { useMemo, useState } from 'react';
import { useFiltered, useStore } from '../state/store';
import { YEAR_MAX, YEAR_MIN, activeFilterCount, type FilterState } from '../domain/filter';
import { DISTRICTS, PRECISION_LABELS, PROTECTION_LABELS, type ProtectionStatus, type YearPrecision } from '../domain/types';
import { formatConstruction, colorOf } from '../domain/periods';

function distinct(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'hu'));
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function Section({ title, count, children, defaultOpen = false }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fsection">
      <button className="fsection-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{open ? '▾' : '▸'} {title}</span>
        {count ? <span className="pill">{count}</span> : null}
      </button>
      {open && <div className="fsection-body">{children}</div>}
    </div>
  );
}

function CheckList<T extends string>({ options, selected, onChange, labels }: { options: T[]; selected: T[]; onChange: (v: T[]) => void; labels?: Record<string, string> }) {
  return (
    <div className="checklist">
      {options.map((o) => (
        <label key={o} className="check">
          <input type="checkbox" checked={selected.includes(o)} onChange={() => onChange(toggle(selected, o))} />
          <span>{labels?.[o] ?? o}</span>
        </label>
      ))}
    </div>
  );
}

export default function FilterPanel() {
  const buildings = useStore((s) => s.buildings);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilter = useStore((s) => s.resetFilter);
  const select = useStore((s) => s.select);
  const showBase = useStore((s) => s.showBaseBuildings);
  const setShowBase = useStore((s) => s.setShowBaseBuildings);
  const filtered = useFiltered();

  const opts = useMemo(
    () => ({
      districts: (DISTRICTS as readonly string[]).filter((d) => buildings.some((b) => b.district === d)),
      styles: distinct(buildings.map((b) => b.style)),
      functions: distinct(buildings.flatMap((b) => [b.originalFunction, b.currentFunction])),
      architects: distinct(buildings.flatMap((b) => b.architects)),
    }),
    [buildings],
  );

  const set = <K extends keyof FilterState>(k: K) => (v: FilterState[K]) => setFilter({ [k]: v } as Partial<FilterState>);
  const n = activeFilterCount(filter);
  const setYear = (raw: string, idx: 0 | 1) => {
    const cur: [number, number] = filter.yearRange ? [...filter.yearRange] : [YEAR_MIN, YEAR_MAX];
    cur[idx] = raw ? Number(raw) : idx === 0 ? YEAR_MIN : YEAR_MAX;
    setFilter({ yearRange: cur[0] <= YEAR_MIN && cur[1] >= YEAR_MAX ? null : cur });
  };
  const results = filter.query.trim() ? filtered.slice(0, 50) : [];

  return (
    <div className="panel-inner">
      <div className="search">
        <input
          type="search"
          placeholder="Keresés: cím, név, tervező, év, stílus, funkció, kerület…"
          value={filter.query}
          onChange={(e) => setFilter({ query: e.target.value })}
          aria-label="Keresés"
        />
      </div>

      {results.length > 0 && (
        <div className="results">
          <div className="results-head">{filtered.length} találat{filtered.length > 50 ? ' (első 50)' : ''}</div>
          {results.map((b) => (
            <button key={b.id} className="result" onClick={() => select(b.id, true)}>
              <span className="swatch" style={{ background: colorOf(b) }} />
              <span className="result-text">
                <span className="result-title">{b.name ?? b.address ?? b.id}</span>
                <span className="result-sub">
                  {b.district ? `${b.district}. ker. · ` : ''}
                  {formatConstruction(b.construction)}
                  {b.isDemo ? ' · DEMO' : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="filter-head">
        <h3>Szűrők</h3>
        {n > 0 && <button className="link" onClick={resetFilter}>Összes törlése ({n})</button>}
      </div>

      <Section title="Kerület" count={filter.districts.length} defaultOpen>
        <div className="chips">
          {opts.districts.map((d) => (
            <button key={d} className={`chip ${filter.districts.includes(d) ? 'on' : ''}`} onClick={() => set('districts')(toggle(filter.districts, d))}>
              {d}.
            </button>
          ))}
        </div>
      </Section>

      <Section title="Építési év" count={filter.yearRange ? 1 : 0} defaultOpen>
        <div className="yearinputs">
          <input
            type="number"
            placeholder="tól"
            value={filter.yearRange && filter.yearRange[0] > YEAR_MIN ? filter.yearRange[0] : ''}
            onChange={(e) => setYear(e.target.value, 0)}
          />
          <span>–</span>
          <input
            type="number"
            placeholder="ig"
            value={filter.yearRange && filter.yearRange[1] < YEAR_MAX ? filter.yearRange[1] : ''}
            onChange={(e) => setYear(e.target.value, 1)}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={filter.includeUnknownInRange} onChange={(e) => setFilter({ includeUnknownInRange: e.target.checked })} />
          <span>Ismeretlen évű épületek is</span>
        </label>
        <div className="sublabel">Az év pontossága</div>
        <CheckList<YearPrecision>
          options={['exact', 'probable', 'range', 'unknown']}
          selected={filter.precisions}
          onChange={set('precisions')}
          labels={PRECISION_LABELS}
        />
      </Section>

      <Section title="Építészeti stílus" count={filter.styles.length}>
        <CheckList options={opts.styles} selected={filter.styles} onChange={set('styles')} />
      </Section>

      <Section title="Funkció" count={filter.functions.length}>
        <CheckList options={opts.functions} selected={filter.functions} onChange={set('functions')} />
      </Section>

      <Section title="Tervező" count={filter.architects.length}>
        <CheckList options={opts.architects} selected={filter.architects} onChange={set('architects')} />
      </Section>

      <Section title="Védettség" count={filter.protections.length}>
        <CheckList<ProtectionStatus>
          options={['muemlek', 'muemleki_kornyezet', 'helyi', 'nincs', 'ismeretlen']}
          selected={filter.protections}
          onChange={set('protections')}
          labels={PROTECTION_LABELS}
        />
      </Section>

      <Section title="Rétegek és adatkészletek" defaultOpen>
        <label className="check">
          <input type="checkbox" checked={filter.showDemo} onChange={(e) => setFilter({ showDemo: e.target.checked })} />
          <span>DEMO tesztrekordok megjelenítése</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={showBase} onChange={(e) => setShowBase(e.target.checked)} />
          <span>OSM épületkontúrok az alaptérképről (építési év ismeretlen)</span>
        </label>
        <p className="hint">
          A DEMO kontúrok szintetikusak, és fedhetik a valós épületeket. Valós adatoknál kapcsold be az OSM-kontúrokat: egy kontúrra kattintva felveheted az adatbázisba.
        </p>
      </Section>
    </div>
  );
}
