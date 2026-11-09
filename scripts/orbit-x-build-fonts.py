#!/usr/bin/env python3
"""Orbit X: build the template fonts (Dev Update 6.2).

Instances the variable fonts to static Regular (400) and Bold (700), subsets them to Latin,
renames the IBM Plex Mono derivative to "Orbit Coord Mono" (Plex is a Reserved Font Name), and
writes advance-width metrics for lib/orbit-x/font-metrics.js.

Usage: python3 scripts/orbit-x-build-fonts.py <dir with the downloaded OFL fonts> <output dir>
Needs: pip install fonttools. Sources: github.com/google/fonts (ofl/fraunces, dmsans, ibmplexmono,
manrope, newsreader, spacegrotesk). The committed output lives in lib/orbit-x/fonts/."""
import sys, json
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
F, O = sys.argv[1], sys.argv[2]
UNI = list(range(0x20,0x7F)) + list(range(0xA0,0x100)) + [0x2010,0x2011,0x2012,0x2013,0x2014,0x2018,0x2019,0x201C,0x201D,0x2020,0x2022,0x2026,0x2032,0x2033,0x2190,0x2191,0x2192,0x2193,0x2212,0x00B0]
SPECS = [
  # key, file, axes (None = static), family, out stem
  ("Fraunces", "fraunces_Fraunces[SOFT,WONK,opsz,wght].ttf", {"opsz":72,"SOFT":0,"WONK":0}, "Fraunces", "Fraunces"),
  ("DM Sans", "dmsans_DMSans[opsz,wght].ttf", {"opsz":14}, "DM Sans", "DMSans"),
  ("Orbit Coord Mono", None, None, "Orbit Coord Mono", "OrbitCoordMono"),
  ("Manrope", "manrope_Manrope[wght].ttf", {}, "Manrope", "Manrope"),
  ("Newsreader", "newsreader_Newsreader[opsz,wght].ttf", {"opsz":24}, "Newsreader", "Newsreader"),
  ("Space Grotesk", "spacegrotesk_SpaceGrotesk[wght].ttf", {}, "Space Grotesk", "SpaceGrotesk"),
]
metrics = {}
for key, file, axes, family, stem in SPECS:
  for weight, style in ((400,"Regular"),(700,"Bold")):
    if file is None:
      font = TTFont(f"{F}/ibmplexmono_IBMPlexMono-{style}.ttf")
    else:
      font = TTFont(f"{F}/{file}")
      loc = dict(axes); loc["wght"] = weight
      font = instancer.instantiateVariableFont(font, loc, inplace=False)
    opts = subset.Options(); opts.layout_features = ["kern","liga"]; opts.name_IDs = ["*"]; opts.notdef_outline = True
    sub = subset.Subsetter(opts); sub.populate(unicodes=UNI); sub.subset(font)
    n = font["name"]
    keep = []
    for rec in n.names:
      if rec.nameID in (0,13,14): keep.append(rec)
    n.names = keep
    full = f"{family} {style}"
    ps = f"{stem}-{style}"
    for pid, eid, lid in ((3,1,0x409),(1,0,0)):
      n.setName(family, 1, pid, eid, lid); n.setName(style, 2, pid, eid, lid)
      n.setName(f"{ps};orbit-x", 3, pid, eid, lid); n.setName(full, 4, pid, eid, lid)
      n.setName("1.0", 5, pid, eid, lid); n.setName(ps, 6, pid, eid, lid)
    font["OS/2"].usWeightClass = weight
    font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~0b1100001) | (0b100000 if weight==700 else 0b1000000)
    font["head"].macStyle = 1 if weight==700 else 0
    for t in ("STAT","fvar","gvar","avar","MVAR","HVAR"):
      if t in font: del font[t]
    out = f"{O}/{stem}-{style}.ttf"
    font.save(out)
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap(); hmtx = font["hmtx"]
    widths = {chr(c): round(hmtx[cmap[c]][0]/upm, 4) for c in UNI if c in cmap}
    os2 = font["OS/2"]
    metrics[f"{key}|{weight}"] = {"w": widths, "cap": round(getattr(os2,"sCapHeight",0)/upm or 0.7,4), "x": round(getattr(os2,"sxHeight",0)/upm or 0.5,4),
      "asc": round(font["hhea"].ascent/upm,4), "desc": round(-font["hhea"].descent/upm,4), "def": round(widths.get("n",0.55),4)}
json.dump(metrics, open(f"{O}/metrics.json","w"))
print("ok")
