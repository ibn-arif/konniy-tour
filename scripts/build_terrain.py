#!/usr/bin/env python3
"""Карта высот для 3D-фона из тайлов Terrarium (AWS Terrain Tiles) и пробный маршрут.

  python3 scripts/build_terrain.py              — рельеф + пробная тропа к вершине
  python3 scripts/build_terrain.py route.gpx    — рельеф + маршрут из GPX-трека; участок 6×6 тайлов
                                                 ставится по центру трека (недостающие тайлы скачать в data/raw14 и data/sat)
  DEM_ZOOM=13 python3 scripts/build_terrain.py  — грубее и легче (тайлы в data/raw)

Тайлы высот лежат в data/raw14/14_X_Y.png (zoom 14, ~10 м). Спутниковые тайлы с той же сеткой —
в data/sat/14_X_Y.jpg (Sentinel-2 cloudless 2017, EOX, CC BY 4.0), их склеивает страница. Результат:
  data/terrain.bin   — высоты в метрах, Int16 little-endian, N×N, строки с севера на юг
  data/terrain.json  — границы, размер в метрах, мин/макс
  data/route.json    — точки маршрута [lon, lat, высота]
Источник высот: Mapzen Terrain Tiles / AWS Open Data (указать на сайте).
"""
import glob, heapq, json, math, os, re, struct, sys, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Z = int(os.environ.get('DEM_ZOOM', 14))
RAW = os.path.join(ROOT, 'data', 'raw14' if Z == 14 else 'raw')
OUT = os.path.join(ROOT, 'data')
STEP = 2  # уменьшение сетки вдвое: на zoom 14 выходит ~14 м между точками


def read_png_rgb(path):
    """Минимальный декодер PNG: 8 бит, RGB, без чересстрочности (так отдаёт Terrarium)."""
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', path
    pos, idat, w = 8, b'', None
    while pos < len(data):
        n, typ = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + n]
        if typ == b'IHDR':
            w, h, depth, ctype, _, _, inter = struct.unpack('>IIBBBBB', chunk)
            assert depth == 8 and ctype == 2 and inter == 0, 'нужен 8-битный RGB'
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + n
    raw, bpp, stride = zlib.decompress(idat), 3, w * 3
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride]); i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b, c = prev[x], (prev[x - bpp] if x >= bpp else 0)
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line); prev = line
    return w, h, rows


def tile_lon(x): return x / 2 ** Z * 360 - 180
def tile_lat(y): return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** Z))))


GRID = 6  # участок — квадрат 6×6 тайлов (~10,7 км на zoom 14)


def tile_xy(lon, lat):
    return (lon + 180) / 360 * 2 ** Z, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** Z


def build_heights(x0, y0):
    tiles = {}
    for x in range(x0, x0 + GRID):
        for y in range(y0, y0 + GRID):
            p = os.path.join(RAW, f'{Z}_{x}_{y}.png')
            assert os.path.exists(p), f'нет тайла высот {p} — скачайте terrarium/{Z}/{x}/{y}.png'
            tiles[(x, y)] = p
    xs, ys = list(range(x0, x0 + GRID)), list(range(y0, y0 + GRID))
    size = 256 * GRID
    full = [[0.0] * size for _ in range(size)]
    for (tx, ty), p in tiles.items():
        _, _, rows = read_png_rgb(p)
        ox, oy = (tx - xs[0]) * 256, (ty - ys[0]) * 256
        for r, line in enumerate(rows):
            dst = full[oy + r]
            for c in range(256):
                R, G, B = line[c * 3], line[c * 3 + 1], line[c * 3 + 2]
                # дно Каспия (батиметрия в тайлах) срезаем по уровню моря, −28 м
                dst[ox + c] = max(-28.0, R * 256 + G + B / 256 - 32768)
    n = size // STEP
    grid = [[sum(full[r * STEP + i][c * STEP + j] for i in range(STEP) for j in range(STEP)) / STEP ** 2
             for c in range(n)] for r in range(n)]
    bounds = dict(west=tile_lon(xs[0]), east=tile_lon(xs[-1] + 1), north=tile_lat(ys[0]), south=tile_lat(ys[-1] + 1))
    return grid, n, bounds, xs, ys


def meters(bounds):
    lat0 = math.radians((bounds['north'] + bounds['south']) / 2)
    w = (bounds['east'] - bounds['west']) * 111320 * math.cos(lat0)
    h = (bounds['north'] - bounds['south']) * 110540
    return w, h


def to_lonlat(r, c, n, b):
    return (b['west'] + (c + .5) / n * (b['east'] - b['west']), b['north'] - (r + .5) / n * (b['north'] - b['south']))


def to_cell(lon, lat, n, b):
    return (int((b['north'] - lat) / (b['north'] - b['south']) * n), int((lon - b['west']) / (b['east'] - b['west']) * n))


def find_trail(grid, n, b, start, goal):
    """Путь с наименьшими уклонами (A*): крутые склоны дороже, обрывы непроходимы."""
    w, _ = meters(b); cell = w / n
    def cost(r0, c0, r1, c1):
        d = cell * math.hypot(r1 - r0, c1 - c0)
        slope = abs(grid[r1][c1] - grid[r0][c0]) / d
        if slope > .45: return None
        return d * (1 + 25 * slope * slope)
    def h(r, c): return cell * math.hypot(r - goal[0], c - goal[1])
    openq, came, g = [(h(*start), start)], {}, {start: 0}
    while openq:
        _, cur = heapq.heappop(openq)
        if cur == goal: break
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if not dr and not dc: continue
                nr, nc = cur[0] + dr, cur[1] + dc
                if not (0 <= nr < n and 0 <= nc < n): continue
                k = cost(cur[0], cur[1], nr, nc)
                if k is None: continue
                ng = g[cur] + k
                if ng < g.get((nr, nc), 1e18):
                    g[(nr, nc)] = ng; came[(nr, nc)] = cur
                    heapq.heappush(openq, (ng + h(nr, nc), (nr, nc)))
    path, cur = [goal], goal
    while cur != start: cur = came[cur]; path.append(cur)
    return path[::-1]


def smooth(pts, rounds=3):
    for _ in range(rounds):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out += [(a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25), (a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75)]
        out.append(pts[-1]); pts = out
    return pts


def sample(grid, n, b, lon, lat):
    fr = (b['north'] - lat) / (b['north'] - b['south']) * n - .5
    fc = (lon - b['west']) / (b['east'] - b['west']) * n - .5
    r0, c0 = max(0, min(n - 2, int(fr))), max(0, min(n - 2, int(fc)))
    tr, tc = min(1, max(0, fr - r0)), min(1, max(0, fc - c0))
    top = grid[r0][c0] * (1 - tc) + grid[r0][c0 + 1] * tc
    bot = grid[r0 + 1][c0] * (1 - tc) + grid[r0 + 1][c0 + 1] * tc
    return top * (1 - tr) + bot * tr


def read_gpx(path):
    txt = open(path, encoding='utf-8').read()
    pts = [(float(lon), float(lat)) for lat, lon in re.findall(r'<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', txt)]
    if not pts:
        pts = [(float(lon), float(lat)) for lon, lat in re.findall(r'<trkpt[^>]*lon="([-\d.]+)"[^>]*lat="([-\d.]+)"', txt)]
    name = re.search(r'<trk>\s*<name>([^<]+)</name>', txt) or re.search(r'<metadata>\s*<name>([^<]+)</name>', txt)
    # точки-метки (wpt): та, что ближе к началу трека, — старт, ближе к концу — финиш
    wpts = [(float(lon), float(lat), nm) for lat, lon, nm in re.findall(r'<wpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>\s*<name>([^<]+)</name>', txt)]
    near = lambda p: min(wpts, key=lambda w: (w[0] - p[0]) ** 2 + (w[1] - p[1]) ** 2)[2] if wpts else None
    return pts, (name.group(1) if name else None), near(pts[0]), near(pts[-1])


def main():
    lonlat = None
    if len(sys.argv) > 1:
        lonlat, name, start_name, finish_name = read_gpx(sys.argv[1])
        name = name or os.path.splitext(os.path.basename(sys.argv[1]))[0]
        cx, cy = tile_xy(sum(p[0] for p in lonlat) / len(lonlat), sum(p[1] for p in lonlat) / len(lonlat))
        x0, y0 = round(cx) - GRID // 2, round(cy) - GRID // 2
    else:
        x0, y0 = 10350, 6022   # пробный участок: город и Тарки-Тау
        start_name, finish_name = 'Конюшня, старт', 'Вершина'
    grid, n, b, xs, ys = build_heights(x0, y0)
    w, h = meters(b)
    flat = [v for row in grid for v in row]
    lo, hi = min(flat), max(flat)
    with open(os.path.join(OUT, 'terrain.bin'), 'wb') as f:
        f.write(struct.pack('<%dh' % len(flat), *[int(round(v)) for v in flat]))

    if lonlat is None:
        # Пробная тропа: от подножия у южной окраины Махачкалы к самой высокой точке хребта поблизости.
        peak = max(((r, c) for r in range(n) for c in range(n) if n * .25 < r < n * .8 and n * .2 < c < n * .8), key=lambda rc: grid[rc[0]][rc[1]])
        start = to_cell(47.505, 42.952, n, b)  # подножие, у кромки города
        cells = find_trail(grid, n, b, start, peak)
        lonlat = smooth([to_lonlat(r, c, n, b) for r, c in cells[::2]] + [to_lonlat(*cells[-1], n, b)])
        name = 'Пробная тропа на Тарки-Тау'
    route = [[round(lon, 6), round(lat, 6), round(sample(grid, n, b, lon, lat), 1)] for lon, lat in lonlat]
    dist = 0
    lat0 = math.radians((b['north'] + b['south']) / 2)
    for (x0, y0, _), (x1, y1, _) in zip(route, route[1:]):
        dist += math.hypot((x1 - x0) * 111320 * math.cos(lat0), (y1 - y0) * 110540)
    json.dump(dict(name=name, start_name=start_name, finish_name=finish_name, length_m=round(dist), points=route), open(os.path.join(OUT, 'route.json'), 'w'), ensure_ascii=False)
    json.dump(dict(size=n, bounds=b, zoom=Z, tiles=dict(x=xs, y=ys), width_m=round(w), height_m=round(h), min_m=round(lo), max_m=round(hi),
                   source='Mapzen Terrain Tiles, AWS Open Data', imagery='Sentinel-2 cloudless 2017 by EOX IT Services GmbH, CC BY 4.0'), open(os.path.join(OUT, 'terrain.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'сетка {n}×{n}, участок {w/1000:.1f}×{h/1000:.1f} км, высоты {lo:.0f}…{hi:.0f} м')
    print(f'маршрут «{name}»: {len(route)} точек, {dist/1000:.1f} км, от {route[0][2]:.0f} до {max(p[2] for p in route):.0f} м')


if __name__ == '__main__':
    main()
