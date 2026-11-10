import { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFiltered, useStore } from '../state/store';
import { UNKNOWN_LABEL, byDecade, byDistrict, byFunction, byStyle, intensity, topArchitects, type CountRow } from '../domain/stats';
import { periodForYear } from '../domain/periods';
import { activeFilterCount } from '../domain/filter';

const ACCENT = '#3d6797';
const ACCENT_MUTED = '#9bb3cf';
const GRID = '#e6e1d8';
const AXIS = { fontSize: 11, fill: '#6b655b' };
// Szekvenciális kék skála (világos → sötét) a hőtérképhez
const SEQ = ['#eef4fb', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

function ChartCard({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`chart-card ${wide ? 'wide' : ''}`}>
      <header>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function HBar({ data, onPick, height }: { data: CountRow[]; onPick: (key: string) => void; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(160, data.length * 26 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap={4}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="key" tick={AXIS} width={150} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} formatter={(v) => [`${v} épület`, 'Darab']} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(d) => onPick(String((d as unknown as CountRow).key))}>
          {data.map((r) => <Cell key={r.key} fill={r.key === UNKNOWN_LABEL ? '#c4c0b8' : ACCENT} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function StatsView() {
  const list = useFiltered();
  const total = useStore((s) => s.buildings.length);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const setView = useStore((s) => s.setView);

  const data = useMemo(() => {
    const styles = byStyle(list);
    const districts = byDistrict(list);
    const topStyles = styles.filter((s) => s.key !== UNKNOWN_LABEL).slice(0, 10).map((s) => s.key);
    const matrix = districts.map((d) => ({
      district: d.key,
      cells: topStyles.map((s) => list.filter((b) => (b.district ?? UNKNOWN_LABEL) === d.key && b.style === s).length),
    }));
    const matrixMax = Math.max(1, ...matrix.flatMap((r) => r.cells));
    return {
      decades: byDecade(list),
      styles,
      districts,
      functions: byFunction(list),
      architects: topArchitects(list),
      intensity: intensity(list),
      topStyles,
      matrix,
      matrixMax,
      knownYear: list.filter((b) => b.construction.precision !== 'unknown').length,
      exactYear: list.filter((b) => b.construction.precision === 'exact').length,
      knownArchitect: list.filter((b) => b.architects.length).length,
      demo: list.filter((b) => b.isDemo).length,
    };
  }, [list]);

  const go = (patch: Parameters<typeof setFilter>[0]) => {
    setFilter(patch);
    setView('map');
  };
  const pct = (n: number) => (list.length ? `${Math.round((n / list.length) * 100)}%` : '–');
  const nFilters = activeFilterCount(filter);

  return (
    <div className="stats-view">
      <div className="stats-head">
        <div>
          <h2>Építészettörténeti statisztikák</h2>
          <p className="muted">
            A kimutatások a térkép aktuális szűrése alapján számolnak ({list.length.toLocaleString('hu')} / {total.toLocaleString('hu')} rekord
            {nFilters ? `, ${nFilters} aktív szűrő` : ''}). Egy diagramelemre kattintva a térkép az adott adatkörre szűr.
          </p>
        </div>
        {data.demo > 0 && <div className="demo-pill">A megjelenített adatok {pct(data.demo)}-a DEMO tesztadat – a számok nem valós eloszlást mutatnak.</div>}
      </div>

      <div className="tiles">
        <div className="tile"><span className="tile-num">{list.length.toLocaleString('hu')}</span><span className="tile-label">épület a szűrésben</span></div>
        <div className="tile"><span className="tile-num">{pct(data.knownYear)}</span><span className="tile-label">ismert építési idő</span></div>
        <div className="tile"><span className="tile-num">{pct(data.exactYear)}</span><span className="tile-label">dokumentált, pontos év</span></div>
        <div className="tile"><span className="tile-num">{pct(data.knownArchitect)}</span><span className="tile-label">ismert tervező</span></div>
      </div>

      <div className="charts">
        <ChartCard title="Épületek száma építési évtizedenként" subtitle="Intervallumos évnél a középpont szerint; színek a térkép korszakskálája szerint" wide>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.decades} margin={{ left: 0, right: 12, top: 8, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="key" tick={AXIS} tickFormatter={(k) => `${k}`} interval="preserveStartEnd" axisLine={{ stroke: GRID }} tickLine={false} />
              <YAxis tick={AXIS} allowDecimals={false} axisLine={false} tickLine={false} width={36} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} labelFormatter={(k) => `${k}-es évek`} formatter={(v) => [`${v} épület`, 'Darab']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => { const y = Number((d as unknown as CountRow).key); go({ yearRange: [y, y + 9] }); }}>
                {data.decades.map((r) => <Cell key={r.key} fill={periodForYear(Number(r.key) + 5)?.color ?? '#c4c0b8'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Építési intenzitás időbeli változása" subtitle="Épületek száma ötéves időszakonként (intervallumos évek arányosan elosztva)" wide>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data.intensity} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="year" tick={AXIS} interval="preserveStartEnd" axisLine={{ stroke: GRID }} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} />
              <Tooltip labelFormatter={(y) => `${y}–${Number(y) + 4}`} formatter={(v) => [`${v} épület`, 'Épült']} />
              <Area type="monotone" dataKey="built" stroke={ACCENT} strokeWidth={2} fill={ACCENT_MUTED} fillOpacity={0.45} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Építészeti stílusok" subtitle="Kattints egy stílusra a térképi szűréshez">
          <HBar data={data.styles} onPick={(k) => k !== UNKNOWN_LABEL && go({ styles: [k] })} />
        </ChartCard>

        <ChartCard title="Épületek kerületenként">
          <HBar data={data.districts.map((d) => ({ ...d, key: d.key === UNKNOWN_LABEL ? d.key : `${d.key}. kerület` }))} onPick={(k) => k !== UNKNOWN_LABEL && go({ districts: [k.replace('. kerület', '')] })} />
        </ChartCard>

        <ChartCard title="Eredeti funkció szerint">
          <HBar data={data.functions} onPick={(k) => k !== UNKNOWN_LABEL && go({ functions: [k] })} />
        </ChartCard>

        <ChartCard title="Leggyakrabban előforduló tervezők" subtitle="Csak a forrással rögzített tervezők számítanak">
          {data.architects.length ? <HBar data={data.architects} onPick={(k) => go({ architects: [k] })} /> : <p className="muted">Nincs tervezőadat a szűrésben.</p>}
        </ChartCard>

        <ChartCard title="Stílusok térbeli eloszlása" subtitle="Épületszám kerület × stílus szerint; egy cellára kattintva mindkét szűrő beáll" wide>
          {data.topStyles.length ? (
            <div className="heatmap-wrap">
              <table className="heatmap">
                <thead>
                  <tr>
                    <th />
                    {data.topStyles.map((s) => <th key={s} title={s}><span>{s}</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.matrix.map((row) => (
                    <tr key={row.district}>
                      <th>{row.district === UNKNOWN_LABEL ? row.district : `${row.district}. ker.`}</th>
                      {row.cells.map((v, i) => {
                        const idx = v ? Math.min(SEQ.length - 1, 1 + Math.floor((v / data.matrixMax) * (SEQ.length - 2))) : 0;
                        return (
                          <td
                            key={i}
                            style={{ background: SEQ[idx], color: idx >= 5 ? '#fff' : '#3a352e' }}
                            title={`${row.district}. kerület · ${data.topStyles[i]}: ${v} épület`}
                            onClick={() => v && row.district !== UNKNOWN_LABEL && go({ districts: [row.district], styles: [data.topStyles[i]] })}
                            className={v ? 'clickable' : ''}
                          >
                            {v || ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Nincs stílusadat a szűrésben.</p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
