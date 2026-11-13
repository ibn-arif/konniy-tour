#!/usr/bin/env python3
"""Дома и улицы для мультяшной карты: выгрузка OpenStreetMap → data/city.json (метры сцены, как toXZ в terrain.js).

  1) Скачать выгрузку Overpass для границ из data/terrain.json, например:
     [out:json];(way["building"](S,W,N,E);way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](S,W,N,E););out tags geom qt;
  2) python3 scripts/build_city.py raw.json data/terrain.json data/city.json
Данные © участники OpenStreetMap, ODbL — подпись на странице обязательна.
"""
import json, math, sys
raw, meta_p, out = sys.argv[1:4]
meta = json.load(open(meta_p)); b = meta['bounds']; W, D = meta['width_m'], meta['height_m']
def xz(lon, lat): return [round((lon - b['west']) / (b['east'] - b['west']) * W - W / 2, 1), round((b['north'] - lat) / (b['north'] - b['south']) * D - D / 2, 1)]
els = json.load(open(raw))['elements']
houses, roads = [], []
RW = {'motorway': 0, 'trunk': 0, 'primary': 0, 'secondary': 1, 'tertiary': 1, 'residential': 2, 'unclassified': 2, 'living_street': 2}
for e in els:
    g, t = e.get('geometry'), e.get('tags', {})
    if not g: continue
    pts = [xz(p['lon'], p['lat']) for p in g if p]
    if 'building' in t:
        if len(pts) < 4: continue
        lv = 0
        try: lv = float(t.get('building:levels', '0').split(';')[0])
        except ValueError: pass
        if not lv:
            try: lv = float(t.get('height', '0').replace('m', '').strip()) / 3
            except ValueError: pass
        lv = max(1, min(30, round(lv or 0)))
        flat = [c for p in pts[:-1] for c in p]
        houses.append([lv if 'building:levels' in t or 'height' in t else 0] + flat)
    elif t.get('highway') in RW:
        roads.append([RW[t['highway']]] + [c for p in pts for c in p])
json.dump({'source': '© OpenStreetMap contributors, ODbL', 'houses': houses, 'roads': roads}, open(out, 'w'), separators=(',', ':'))
print(len(houses), 'домов,', len(roads), 'улиц;', sum(1 for h in houses if h[0]), 'с этажностью')
