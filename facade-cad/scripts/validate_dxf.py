#!/usr/bin/env python3
"""Validate DXF files with ezdxf: strict load, auditor, layer/lineweight sanity. Exit code 1 on failure.
   pip install ezdxf ; python3 scripts/validate_dxf.py file1.dxf [...]"""
import sys
import ezdxf
from ezdxf import recover

bad = 0
for path in sys.argv[1:]:
    try:
        doc = ezdxf.readfile(path)  # strict loader: raises on structural errors
    except Exception as e:  # noqa: BLE001
        print(f'FAIL {path}: strict load: {e}')
        bad += 1
        continue
    auditor = doc.audit()
    msp = doc.modelspace()
    counts = {}
    for e in msp:
        counts[e.dxftype()] = counts.get(e.dxftype(), 0) + 1
    layers = {l.dxf.name: l for l in doc.layers}
    used = {e.dxf.layer for e in msp}
    missing = used - set(layers)
    lw = {n: l.dxf.lineweight for n, l in layers.items() if n.startswith('0') or n[:2].isdigit()}
    errors = len(auditor.errors)
    status = 'OK  ' if errors == 0 and not missing else 'FAIL'
    if status == 'FAIL':
        bad += 1
    print(f'{status} {path}: version={doc.dxfversion} units={doc.header.get("$INSUNITS", "-")} entities={sum(counts.values())} {counts} '
          f'audit_errors={errors} fixes={len(auditor.fixes)} missing_layers={sorted(missing)}')
    for err in auditor.errors[:5]:
        print('   error:', err.message)
    for fx in auditor.fixes[:5]:
        print('   fix:', fx.message)
    if doc.dxfversion >= 'AC1015':
        print('   layer lineweights (1/100 mm):', {k: v for k, v in sorted(lw.items())})
sys.exit(1 if bad else 0)
