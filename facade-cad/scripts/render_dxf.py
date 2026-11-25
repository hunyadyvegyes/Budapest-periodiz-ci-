#!/usr/bin/env python3
"""Render a DXF to PNG with ezdxf's drawing add-on (independent check of the exported geometry)."""
import sys
import ezdxf
from ezdxf.addons.drawing import matplotlib as dxfmpl

doc = ezdxf.readfile(sys.argv[1])
dxfmpl.qsave(doc.modelspace(), sys.argv[2], bg='#FFFFFF', dpi=int(sys.argv[3]) if len(sys.argv) > 3 else 200)
