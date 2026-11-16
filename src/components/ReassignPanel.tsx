import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import type { Building } from '../domain/types';
import { addressWouldChange, reassignBuilding } from '../domain/reassign';
import { lookupBuildingAt } from '../data/osmLookup';

/** Áthelyezés: a rekord adatai változatlanok, csak a hely (körvonal, és kérésre a cím) változik. */
export default function ReassignPanel({ b }: { b: Building }) {
  const reassign = useStore((s) => s.reassign)!;
  const setTarget = useStore((s) => s.setReassignTarget);
  const cancel = useStore((s) => s.cancelReassign);
  const save = useStore((s) => s.save);
  const target = reassign.target;

  const [place, setPlace] = useState<{ address?: string; city?: string; district?: string } | null>(null);
  const [looking, setLooking] = useState(false);
  const [updateAddress, setUpdateAddress] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPlace(null);
    if (!target) return;
    let cancelled = false;
    setLooking(true);
    lookupBuildingAt(target.lngLat[1], target.lngLat[0]).then((p) => {
      if (cancelled) return;
      setLooking(false);
      setPlace({ address: p?.address ?? target.address, city: p?.city, district: p?.district });
    });
    return () => { cancelled = true; };
  }, [target]);

  const newAddress = place?.address;
  const newCity = place?.city ?? b.city;
  const addressChanges = addressWouldChange(b, place);

  const apply = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await save(reassignBuilding(b, { geometry: target.geometry, osmRef: target.osmRef, place, updateAddress }));
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="panel-inner reassign">
      <div className="bp-kicker">Áthelyezés másik épületre</div>
      <h2>{b.name ?? b.address ?? 'Névtelen épület'}</h2>
      <p className="muted small">Az adatok (név, év, tervező, leírás, képek, források) változatlanok maradnak – csak az épület helye és körvonala változik.</p>

      <div className="reassign-step">
        <div className="sublabel">Jelenlegi hely</div>
        <div>{b.address ?? 'nincs cím'}{b.city && b.city !== 'Budapest' ? `, ${b.city}` : ''}</div>
      </div>

      {!target ? (
        <div className="reassign-step hint-box">
          Kattints a térképen a <strong>helyes épületre</strong>. Ha távolról nézed, az első kattintás ráközelít.
          Az <kbd>Esc</kbd> billentyű vagy a Mégse gomb megszakítja.
        </div>
      ) : (
        <div className="reassign-step">
          <div className="sublabel">Új hely</div>
          {looking ? (
            <div className="muted">Cím lekérése az OpenStreetMapből…</div>
          ) : (
            <>
              <div>{newAddress ?? 'A kiválasztott épülethez nincs cím az OSM-ben.'}{newCity && newCity !== 'Budapest' ? `, ${newCity}` : ''}</div>
              {addressChanges && (
                <label className="check">
                  <input id="reassign-addr" type="checkbox" checked={updateAddress} onChange={(e) => setUpdateAddress(e.target.checked)} />
                  <span>A cím (és a település, kerület) is erre változzon</span>
                </label>
              )}
            </>
          )}
        </div>
      )}

      <div className="bp-actions">
        <button className="btn primary" onClick={apply} disabled={!target || looking || saving}>{saving ? 'Mentés…' : 'Áthelyezés'}</button>
        {target && <button className="btn" onClick={() => setTarget(null)}>Másik épület</button>}
        <button className="btn ghost" onClick={cancel}>Mégse</button>
      </div>
    </div>
  );
}
