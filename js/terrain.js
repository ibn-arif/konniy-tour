// 3D-маршрут в мультяшном стиле на настоящем рельефе: высоты из terrain.bin, тропа из route.json,
// дома и улицы из city.json (OpenStreetMap), лес по снимку Sentinel-2, лошадь из GLB-модели.
// Контейнер: <div data-terrain="data/routes/<маршрут>/" data-model="models/horse-web.glb">. Цвета — из CSS-переменных страницы.
(async function () {
  const box = document.querySelector('[data-terrain]');
  if (!box) return;
  if (!window.THREE) { const v = box.querySelector('.map-video'); if (v) { box.classList.add('is-video'); v.hidden = false; v.play().catch(() => {}); } return; }
  const THREE = window.THREE;
  const $ = id => document.getElementById(id);
  function fillPanel(route) {
    if ($('route-name')) $('route-name').textContent = route.name;
    if ($('route-len')) $('route-len').textContent = (route.length_m / 1000).toFixed(1).replace('.', ',') + ' км';
    if ($('route-climb')) $('route-climb').textContent = `${Math.round(route.points[0][2])} → ${Math.round(Math.max(...route.points.map(p => p[2])))} м`;
  }
  // Запасной вариант для слабых устройств — зацикленное видео того же маршрута (<video class="map-video"> на странице).
  const video = box.querySelector('.map-video');
  function useVideo(reason) {
    if (!video) return false;
    box.classList.add('is-video'); video.hidden = false; document.body.classList.add('map-is-video');
    fetch(box.dataset.terrain + 'route.json').then(r => r.json()).then(fillPanel).catch(() => {});
    video.play().catch(() => {});
    if (typeof running !== 'undefined') running = false;
    if (/[?&]debug\b/.test(location.search)) console.info('[terrain] показываем видео:', reason);
    return true;
  }
  const hasGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
  if (!hasGL && useVideo('нет WebGL')) return;
  if (navigator.connection && navigator.connection.saveData && useVideo('экономия трафика')) return;
  if (/[?&]video\b/.test(location.search) && useVideo('?video')) return;
  const base = box.dataset.terrain;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EXAG = 1.5;           // рельеф чуть выразительнее настоящего
  // ?record — служебный режим: записать один круг лошади по кадрам для зацикленного видео (scripts/record_video.md)
  const RECORD = /[?&]record\b/.test(location.search), REC_W = 1280, REC_H = 720, REC_FPS = 30;
  const DEBUG = /[?&]debug\b/.test(location.search), t0 = performance.now();
  const mark = name => { if (DEBUG) console.info(`[terrain] ${name}: ${Math.round(performance.now() - t0)} мс`); };
  const HORSE_M = 20;
  // data-drive="scroll" — главная страница: положение лошади на тропе задаёт прокрутка (box.rideTarget, 0…1),
  // камера в начале и в конце отъезжает на общий план, прогресс уходит событием «ride»
  const DRIVE = box.dataset.drive === 'scroll';         // лошадь крупнее настоящей, чтобы читалась на километровом фоне

  const [meta, bin, route, city] = await Promise.all([
    fetch(base + 'terrain.json').then(r => r.json()),
    fetch(base + 'terrain.bin').then(r => r.arrayBuffer()),
    fetch(base + 'route.json').then(r => r.json()),
    fetch(base + 'city.json').then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  mark('данные загружены');
  const n = meta.size, H = new Int16Array(bin), W = meta.width_m, D = meta.height_m;
  const b = meta.bounds;

  // ---------- координаты: метры от центра участка, x — восток, z — юг ----------
  const toXZ = (lon, lat) => [(lon - b.west) / (b.east - b.west) * W - W / 2, (b.north - lat) / (b.north - b.south) * D - D / 2];
  function height(x, z) {
    const fc = (x + W / 2) / W * n - .5, fr = (z + D / 2) / D * n - .5;
    const c0 = Math.max(0, Math.min(n - 2, Math.floor(fc))), r0 = Math.max(0, Math.min(n - 2, Math.floor(fr)));
    const tc = Math.min(1, Math.max(0, fc - c0)), tr = Math.min(1, Math.max(0, fr - r0));
    const at = (r, c) => H[r * n + c];
    const top = at(r0, c0) * (1 - tc) + at(r0, c0 + 1) * tc, bot = at(r0 + 1, c0) * (1 - tc) + at(r0 + 1, c0 + 1) * tc;
    return Math.max(0, (top * (1 - tr) + bot * tr) - meta.min_m) * EXAG * edgeFade(fr, fc);
  }
  // у границы участка рельеф плавно опускается к морю и тонет в дымке — без обрыва ступенькой
  function edgeFade(r, c) { const d = Math.min(r, c, n - 1 - r, n - 1 - c) / (n * .07); return THREE.MathUtils.smoothstep(d, 0, 1); }
  const SEA = 0;               // уровень Каспия = минимальная высота участка

  // ---------- деление на куски 8×8: что вне кадра или слишком далеко, не рисуем ----------
  const CH = 8;
  const chunkIdx = (x, z) => Math.min(CH - 1, Math.max(0, Math.floor((x + W / 2) / W * CH))) * CH + Math.min(CH - 1, Math.max(0, Math.floor((z + D / 2) / D * CH)));
  const culled = [];   // { obj, sphere, far } — far: дальше этого расстояния в режиме «за лошадью» не рисуем
  const sphereOf = (xs, ys, zs) => {
    const bb = new THREE.Box3(new THREE.Vector3(Math.min(...xs), Math.min(...ys), Math.min(...zs)), new THREE.Vector3(Math.max(...xs), Math.max(...ys), Math.max(...zs)));
    return bb.getBoundingSphere(new THREE.Sphere());
  };

  // ---------- сцена ----------
  const css = getComputedStyle(box);
  const cssColor = (name, fb) => new THREE.Color((css.getPropertyValue(name) || '').trim() || fb).convertSRGBToLinear();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  // выше 1,5 разницы в мультяшной картинке почти не видно, а пикселей вдвое больше
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputEncoding = THREE.sRGBEncoding;
  box.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const haze = cssColor('--haze', '#C9C6BC');
  scene.background = haze;
  scene.fog = new THREE.Fog(haze, 3000, 11000);
  const camera = new THREE.PerspectiveCamera(38, 1, 2, 250000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f78, .75); scene.add(hemi);
  // низкое вечернее солнце с запада-юго-запада: длинные тени подчёркивают рельеф
  const sun = new THREE.DirectionalLight(0xffe7c8, .85);
  const SUN_DIR = new THREE.Vector3(-1, .42, .55).normalize();
  scene.add(sun, sun.target);

  // рельеф
  const geo = new THREE.PlaneGeometry(W, D, n - 1, n - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(0, H[i] - meta.min_m) * EXAG * edgeFade(Math.floor(i / n), i % n));
  geo.computeVertexNormals();
  // сглаживаем нормали: склоны читаются крупными пятнами света, без «камуфляжа»
  {
    // три прохода размытия 7×7, разложенного на строки и столбцы (скользящая сумма) — в десятки раз быстрее
    const nrm = geo.attributes.normal.array, tmp = new Float32Array(nrm.length), R = 3;
    const blur1d = (src, dst, stride, step) => {   // stride — шаг между линиями, step — шаг вдоль линии
      for (let line = 0; line < n; line++) {
        const o = line * stride;
        for (let ch = 0; ch < 3; ch++) {
          let sum = 0;
          for (let i = -R; i <= R; i++) sum += src[o + Math.min(n - 1, Math.max(0, i)) * step + ch];
          for (let i = 0; i < n; i++) {
            dst[o + i * step + ch] = sum;
            sum += src[o + Math.min(n - 1, i + R + 1) * step + ch] - src[o + Math.max(0, i - R) * step + ch];
          }
        }
      }
    };
    for (let pass = 0; pass < 3; pass++) { blur1d(nrm, tmp, n * 3, 3); blur1d(tmp, nrm, 3, n * 3); }
    for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  }

  // ---------- шум для «рукотворных» линий и пятен ----------
  const A = renderer.capabilities.getMaxAnisotropy();
  function texFrom(size, paint) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, size, size); paint(g, size);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = A; return t;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  const grassMap = texFrom(512, (g, S) => {
    const blob = (x, y, r, v, a) => { for (const dx of [0, S, -S]) for (const dy of [0, S, -S]) {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); gr.addColorStop(0, `rgba(${v},${v},${v},${a})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill(); } };
    for (let i = 0; i < 420; i++) blob(rnd(0, S), rnd(0, S), rnd(18, 60), Math.round(rnd(70, 190)), .35);
    for (let i = 0; i < 2600; i++) blob(rnd(0, S), rnd(0, S), rnd(2, 9), Math.round(rnd(40, 110)), .55);
    for (let i = 0; i < 9000; i++) { const v = Math.round(rnd(90, 210)); g.fillStyle = `rgba(${v},${v},${v},.35)`; g.fillRect(rnd(0, S), rnd(0, S), 1.2, 1.2); }
  });
  // мультяшный стиль: три ступени света вместо плавной светотени
  const toonGrad = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.LuminanceFormat);
  toonGrad.minFilter = toonGrad.magFilter = THREE.NearestFilter; toonGrad.needsUpdate = true;
  const toonMat = (hex, extra) => new THREE.MeshToonMaterial(Object.assign({ color: new THREE.Color(hex).convertSRGBToLinear(), gradientMap: toonGrad }, extra));
  const ink = cssColor('--ink-line', '#3E4A2E');

  // крутизна склона в каждой вершине — для камня на обрывах
  const slopeAttr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.floor(i / n), c = i % n;
    const dzx = (H[r * n + Math.min(n - 1, c + 1)] - H[r * n + Math.max(0, c - 1)]) / (2 * W / n);
    const dzz = (H[Math.min(n - 1, r + 1) * n + c] - H[Math.max(0, r - 1) * n + c]) / (2 * D / n);
    slopeAttr[i] = Math.hypot(dzx, dzz) * EXAG;
  }
  geo.setAttribute('aSlope', new THREE.BufferAttribute(slopeAttr, 1));

  // мультяшная земля: оливковая заливка в три тона, светлые скалы, волнистые горизонтали «от руки»
  const toonGround = new THREE.ShaderMaterial({
    fog: true, extensions: { derivatives: true },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      sunDir: { value: SUN_DIR }, noiseMap: { value: null }, exag: { value: EXAG },
      cLight: { value: cssColor('--toon-light', '#9DB45E') }, cMid: { value: cssColor('--toon-mid', '#7F9A48') },
      cDark: { value: cssColor('--toon-dark', '#627C3A') }, cRock: { value: cssColor('--toon-rock', '#C9C1A6') },
      cSand: { value: cssColor('--toon-sand', '#E6DDC2') }, cInk: { value: ink }, cHaze: { value: haze }, cityMap: { value: null }, cityOn: { value: 0 }, forestMap: { value: null }, forestOn: { value: 0 },
      cForest: { value: cssColor('--toon-forest', '#4C6A2F') } }]),
    vertexShader: `attribute float aSlope; uniform float exag;
      varying vec3 vN; varying float vH; varying float vSlope; varying float vDist; varying vec2 vUv;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vN = normal; vH = position.y / exag; vSlope = aSlope;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vDist = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 sunDir; uniform sampler2D noiseMap; uniform vec3 cLight, cMid, cDark, cRock, cSand, cInk, cHaze; uniform sampler2D cityMap; uniform float cityOn; uniform sampler2D forestMap; uniform float forestOn; uniform vec3 cForest;
      varying vec3 vN; varying float vH; varying float vSlope; varying float vDist; varying vec2 vUv;
      #include <common>
      #include <fog_pars_fragment>
      float band(float f, float w) { float fw = fwidth(f); return 1.0 - smoothstep(fw * w, fw * (w + 1.0), abs(fract(f - .5) - .5)); }
      void main() {
        float nz = texture2D(noiseMap, vUv * 9.0).r, nz2 = texture2D(noiseMap, vUv * 33.0).r;
        float k = dot(normalize(vN), sunDir) + (nz - .5) * .05;
        vec3 col = k > .62 ? cLight : k > .3 ? cMid : cDark;
        float rockW = step(1.15 + (nz - .5) * .3, vSlope);
        col = mix(col, cRock * (k > .45 ? 1.0 : .84), rockW);
        col = mix(cSand, col, smoothstep(1.7, 3.2, vH));   // узкий пляж у моря
        // под лесом земля темнее — массив читается сплошным пятном, деревья поверх
        float fm = forestOn > .5 ? smoothstep(.3, .55, texture2D(forestMap, vUv).a + (nz - .5) * .15) : 0.0;
        col = mix(col, cForest * (k > .62 ? 1.12 : k > .3 ? 1.0 : .82), fm * (1.0 - rockW));
        // кварталы и улицы, нарисованные на холсте
        vec4 cm = cityOn > .5 ? texture2D(cityMap, vUv) : vec4(0.0);
        col = mix(col, pow(cm.rgb, vec3(2.2)), cm.a);
        // горизонтали: тонкие через 40 м, жирнее через 200 м; линия чуть «гуляет», как нарисованная
        float hm = vH + (nz2 - .5) * 9.0;
        float thin = band(hm / 40.0, .5) * .45 * (1.0 - smoothstep(4500.0, 9000.0, vDist));
        float bold = band(hm / 200.0, 1.0) * .85 * (1.0 - smoothstep(12000.0, 22000.0, vDist));
        col = mix(col, cInk, max(thin, bold) * step(8.0, vH) * (1.0 - cm.a * .8));
        // к краю участка земля растворяется в дымке — нет «квадрата карты»
        float e = min(min(vUv.x, vUv.y), min(1.0 - vUv.x, 1.0 - vUv.y));
        col = mix(cHaze, col, smoothstep(.0, .09, e));
        gl_FragColor = vec4(col, 1.0);
        #include <encodings_fragment>
        #include <fog_fragment>
      }`,
  });
  toonGround.uniforms.noiseMap.value = grassMap;

  // ---------- город по данным OpenStreetMap (строится после первого кадра) ----------
  function buildCity() {
    if (!city) return;
    const S = 4096, k = S / W, kz = S / D;
    const cc = document.createElement('canvas'); cc.width = cc.height = S;
    const g = cc.getContext('2d'); g.lineJoin = g.lineCap = 'round';
    const path = (a, from, close) => { g.beginPath(); for (let i = from; i < a.length; i += 2) g[i === from ? 'moveTo' : 'lineTo']((a[i] + W / 2) * k, (a[i + 1] + D / 2) * kz); if (close) g.closePath(); };
    // светлая «подложка» кварталов вокруг домов
    g.fillStyle = g.strokeStyle = '#CFC8A4'; g.lineWidth = 16 * k;
    for (const h of city.houses) { path(h, 1, true); g.fill(); g.stroke(); }
    // улицы: тёмная обводка, поверх — светлая полоса
    const RW = [15, 10, 6.5];
    for (const pass of [0, 1]) for (const r of city.roads) {
      g.strokeStyle = pass ? '#F2EBD8' : 'rgba(62,74,46,.75)';
      g.lineWidth = (RW[r[0]] + (pass ? 0 : 3.5)) * k; path(r, 1, false); g.stroke();
    }
    const ct = new THREE.CanvasTexture(cc); ct.anisotropy = A;
    toonGround.uniforms.cityMap.value = ct; toonGround.uniforms.cityOn.value = 1;

    // дома: стены, плоская крыша, контур — по одной геометрии на кусок карты
    const parts = Array.from({ length: CH * CH }, () => ({ P: [], Nn: [], C: [], Lp: [] }));
    let P, Nn, C, Lp;
    const wallC = new THREE.Color('#EFE6CF').convertSRGBToLinear();
    const roofC = ['#C9805F', '#D8CDB2', '#A9AAA2', '#B9705A', '#E3D9C0'].map(c => new THREE.Color(c).convertSRGBToLinear());
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
    const tri = (a, b, c, nx, ny, nz, col) => {
      e1.subVectors(b, a); e2.subVectors(c, a); cr.crossVectors(e1, e2);
      if (cr.x * nx + cr.y * ny + cr.z * nz < 0) { const t = b; b = c; c = t; }
      for (const v of [a, b, c]) { P.push(v.x, v.y, v.z); Nn.push(nx, ny, nz); C.push(col.r, col.g, col.b); }
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    city.houses.forEach((h, idx) => {
      const pts = []; for (let i = 1; i < h.length; i += 2) pts.push(new THREE.Vector2(h[i], h[i + 1]));
      if (pts.length < 3) return;
      let cx = 0, cz = 0; for (const p of pts) { cx += p.x; cz += p.y; } cx /= pts.length; cz /= pts.length;
      if (Math.abs(cx) > W * .44 || Math.abs(cz) > D * .44) return;
      ({ P, Nn, C, Lp } = parts[chunkIdx(cx, cz)]);
      let base = Infinity; for (const p of pts) base = Math.min(base, height(p.x, p.y));
      base -= 1;
      const rnd1 = (Math.sin(idx * 12.9898) * 43758.5453) % 1, r01 = Math.abs(rnd1);
      const top = base + (h[0] ? h[0] * 3.2 : 4 + r01 * 4) * 1.4;
      for (let i = 0; i < pts.length; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % pts.length];
        let nx = p1.y - p0.y, nz = -(p1.x - p0.x); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        if ((p0.x - cx) * nx + (p0.y - cz) * nz < 0) { nx = -nx; nz = -nz; }
        const a = V(p0.x, base, p0.y), b = V(p1.x, base, p1.y), c = V(p1.x, top, p1.y), d = V(p0.x, top, p0.y);
        tri(a, b, c, nx, 0, nz, wallC); tri(a, c, d, nx, 0, nz, wallC);
        Lp.push(p0.x, top + .05, p0.y, p1.x, top + .05, p1.y, p0.x, base, p0.y, p0.x, top, p0.y);
      }
      const rc = roofC[idx % roofC.length];
      for (const [i, j, m] of THREE.ShapeUtils.triangulateShape(pts, [])) tri(V(pts[i].x, top, pts[i].y), V(pts[j].x, top, pts[j].y), V(pts[m].x, top, pts[m].y), 0, 1, 0, rc);
    });
    const houseMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGrad });
    const lineMat = new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: .7 });
    for (const part of parts) {
      if (!part.P.length) continue;
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(part.P, 3));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute(part.Nn, 3));
      bg.setAttribute('color', new THREE.Float32BufferAttribute(part.C, 3));
      bg.computeBoundingSphere();
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(part.Lp, 3));
      lg.boundingSphere = bg.boundingSphere;
      const houses = new THREE.Mesh(bg, houseMat), outlines = new THREE.LineSegments(lg, lineMat);
      scene.add(houses, outlines);
      // контуры домов издали сливаются в шум — рисуем их только вблизи
      culled.push({ obj: houses, sphere: bg.boundingSphere, far: 5000 }, { obj: outlines, sphere: bg.boundingSphere, far: 2500 });
    }
  }
  // рельеф: общие вершины, но свой список треугольников и своя граница у каждого куска
  {
    const step = (n - 1) / CH, py = pos.array;
    for (let ci = 0; ci < CH; ci++) for (let cj = 0; cj < CH; cj++) {
      const r0 = Math.round(ci * step), r1 = Math.round((ci + 1) * step), c0 = Math.round(cj * step), c1 = Math.round((cj + 1) * step);
      const idx = [], ys = [];
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
        const a = r * n + c, b2 = (r + 1) * n + c, c2 = b2 + 1, d = a + 1;
        idx.push(a, b2, d, b2, c2, d);
        ys.push(py[a * 3 + 1]);
      }
      const g = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv', 'aSlope']) g.setAttribute(k, geo.attributes[k]);
      g.setIndex(idx);
      const x0 = py[(r0 * n + c0) * 3], z0 = py[(r0 * n + c0) * 3 + 2], x1 = py[(r1 * n + c1) * 3], z1 = py[(r1 * n + c1) * 3 + 2];
      g.boundingSphere = sphereOf([x0, x1], [Math.min(...ys), Math.max(...ys) + 50], [z0, z1]);
      scene.add(new THREE.Mesh(g, toonGround));
    }
  }
  mark('рельеф построен');

  // ---------- лес: 3D-деревья там, где на снимке тёмная зелень (строится после первого кадра) ----------
  async function buildForest() {
    // спутниковый снимок (только чтобы найти лес): тайлы с той же сеткой, что у высот, склеиваем на холсте
    const T = 256, tx = meta.tiles.x, ty = meta.tiles.y;
    const canvas = document.createElement('canvas'); canvas.width = T * tx.length; canvas.height = T * ty.length;
    const ctx = canvas.getContext('2d');
    await Promise.all(tx.flatMap((x, i) => ty.map((y, j) => new Promise(res => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, i * T, j * T); res(); };
      img.onerror = res;
      img.src = `${base}sat/${meta.zoom}_${x}_${y}.jpg`;
    }))));
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data, cw = canvas.width, ch = canvas.height;
    const spots = [];
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const k = (j * cw + i) * 4, R = px[k], Gc = px[k + 1], B = px[k + 2], L = .299 * R + .587 * Gc + .114 * B;
      if (Gc > R + 3 && Gc >= B - 4 && L < 135 && L > 22) spots.push(i, j);
    }
    {
      // маска леса для подкраски земли
      const fc = document.createElement('canvas'); fc.width = cw; fc.height = ch;
      const fg = fc.getContext('2d'), fimg = fg.createImageData(cw, ch);
      for (let s = 0; s < spots.length; s += 2) fimg.data[(spots[s + 1] * cw + spots[s]) * 4 + 3] = 255;
      fg.putImageData(fimg, 0, 0);
      const fb = document.createElement('canvas'); fb.width = cw; fb.height = ch;
      const fbg = fb.getContext('2d'); fbg.filter = 'blur(2px)'; fbg.drawImage(fc, 0, 0);
      const ft = new THREE.CanvasTexture(fb); ft.anisotropy = A;
      toonGround.uniforms.forestMap.value = ft; toonGround.uniforms.forestOn.value = 1;
      // деревья гуще вдоль маршрута: сначала берём точки леса в коридоре ±900 м, остальные — по всему участку
      const G = 100, gw = Math.ceil(W / G), gd = Math.ceil(D / G), near = new Uint8Array(gw * gd), R0 = 9;
      for (const [lon, lat] of route.points) {
        const [x, z] = toXZ(lon, lat), gx = Math.floor((x + W / 2) / G), gz = Math.floor((z + D / 2) / G);
        for (let a = -R0; a <= R0; a++) for (let b2 = -R0; b2 <= R0; b2++) if (a * a + b2 * b2 <= R0 * R0) {
          const xx = gx + a, zz = gz + b2; if (xx >= 0 && zz >= 0 && xx < gw && zz < gd) near[zz * gw + xx] = 1;
        }
      }
      const inC = [], outC = [];
      for (let s = 0; s < spots.length; s += 2) {
        const gx = Math.floor(spots[s] / cw * gw), gz = Math.floor(spots[s + 1] / ch * gd);
        (near[gz * gw + gx] ? inC : outC).push(spots[s], spots[s + 1]);
      }
      const pick = (arr, k) => { const out = []; for (let t = 0; t < k && arr.length; t++) { const r = Math.floor(Math.random() * arr.length / 2) * 2; out.push(arr[r], arr[r + 1]); } return out; };
      const chosen = pick(inC, Math.min(24000, inC.length / 2 * 3)).concat(pick(outC, 26000));
      spots.length = 0; for (let t = 0; t < chosen.length; t++) spots.push(chosen[t]);
    }
    // на телефонах вдвое меньше деревьев
    const MAX = matchMedia('(pointer: coarse), (max-width: 760px)').matches ? 24000 : 50000, count = Math.min(MAX, spots.length / 2);
    // просека: на самой тропе и в ~12 м от неё деревьев нет
    const CL = 8, clear = new Set();
    const rxz = route.points.map(([lon, lat]) => toXZ(lon, lat));
    for (let i = 1; i < rxz.length; i++) {
      const [x0, z0] = rxz[i - 1], [x1, z1] = rxz[i], st = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 4));
      for (let s = 0; s <= st; s++) {
        const gx = Math.floor((x0 + (x1 - x0) * s / st) / CL), gz = Math.floor((z0 + (z1 - z0) * s / st) / CL);
        for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) clear.add((gx + a) * 100003 + gz + c);
      }
    }
    // крона — 20 треугольников, но с гладкими нормалями шара: в мультяшном свете выглядит круглой
    const crown = new THREE.IcosahedronGeometry(1, 0);
    crown.setAttribute('normal', crown.attributes.position.clone());
    crown.translate(0, 1.15, 0);
    const crownMat = toonMat('#ffffff');
    const buckets = Array.from({ length: CH * CH }, () => []);   // по кускам: [x, y, z, ширина, высота, поворот, цвет]
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color();
    const step = spots.length / 2 / count;
    for (let t = 0; t < count; t++) {
      const s2 = Math.floor(t * step + Math.random() * step) * 2, i = spots[s2], j = spots[s2 + 1];
      v.x = (i + Math.random()) / cw * W - W / 2; v.z = (j + Math.random()) / ch * D - D / 2;
      const fr = (v.z + D / 2) / D * n, fc = (v.x + W / 2) / W * n;
      if (edgeFade(fr, fc) < .9 || clear.has(Math.floor(v.x / CL) * 100003 + Math.floor(v.z / CL))) continue;
      v.y = height(v.x, v.z) - .5;
      // тёмная вода Каспия на снимке похожа на лес — у уровня моря деревьев не ставим
      if (v.y < 4) continue;
      const h = rnd(11, 19), w = h * rnd(.42, .58);
      buckets[chunkIdx(v.x, v.z)].push([v.x, v.y, v.z, w, h, Math.random() * 6.3, t % 3]);
    }
    const palette = ['#4F6E33', '#5C7C3A', '#47652E'].map(c => new THREE.Color(c).convertSRGBToLinear()), up = new THREE.Vector3(0, 1, 0);
    for (const list of buckets) {
      if (!list.length) continue;
      const crowns = new THREE.InstancedMesh(crown, crownMat, list.length);
      list.forEach(([x, y, z, w, h, rot, ci], t) => {
        crowns.setMatrixAt(t, m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, rot), sc.set(w, h * .55, w)));
        crowns.setColorAt(t, palette[ci]);
      });
      // у InstancedMesh в r128 граница считается по одной кроне — отсекаем вручную по границе куска
      crowns.frustumCulled = false;
      scene.add(crowns);
      culled.push({ obj: crowns, sphere: sphereOf(list.map(a => a[0]), list.map(a => a[1] + a[4]), list.map(a => a[2])), far: 4500 });
    }
  }

  // небо-купол: цвет у горизонта совпадает с дымкой, поэтому край земли растворяется
  const skyTop = cssColor('--sky-top', '#5E86AE');
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: skyTop }, bottom: { value: haze } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vDir; void main(){ float t = smoothstep(-.02, .45, vDir.y); gl_FragColor = vec4(mix(bottom, top, t), 1.0); \n#include <encodings_fragment>\n }' });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(150000, 32, 16), skyMat);
  // ---------- свет по ходу прогулки (главная): утро у конюшни → день в лесу → закат на смотровой ----------
  const lin = h => new THREE.Color(h).convertSRGBToLinear();
  const LIGHT = [
    { at: 0, dir: new THREE.Vector3(.7, .5, .35).normalize(), sun: lin('#FFE6C2'), si: .95, sky: lin('#EEF4FF'), hi: .72, haze: lin('#D6E4E8'), top: lin('#93BEDC') },
    { at: .55, dir: new THREE.Vector3(-.25, .88, .42).normalize(), sun: lin('#FFF7EA'), si: 1.0, sky: lin('#FFFFFF'), hi: .78, haze: lin('#DCE4D6'), top: lin('#A6C4D9') },
    { at: 1, dir: new THREE.Vector3(-1, .2, .28).normalize(), sun: lin('#FF9E52'), si: 1.3, sky: lin('#F6C9A8'), hi: .52, haze: lin('#F1C59C'), top: lin('#7F8FC0') },
  ];
  const lightTmp = new THREE.Vector3();
  function applyLight(t) {
    let i = 1; while (i < LIGHT.length - 1 && t > LIGHT[i].at) i++;
    const a = LIGHT[i - 1], b = LIGHT[i], f = THREE.MathUtils.smoothstep(t, a.at, b.at);
    SUN_DIR.copy(lightTmp.copy(a.dir).lerp(b.dir, f).normalize());
    sun.color.copy(a.sun).lerp(b.sun, f); sun.intensity = THREE.MathUtils.lerp(a.si, b.si, f);
    hemi.color.copy(a.sky).lerp(b.sky, f); hemi.intensity = THREE.MathUtils.lerp(a.hi, b.hi, f);
    haze.copy(a.haze).lerp(b.haze, f); scene.fog.color.copy(haze); apron.material.color.copy(haze);
    skyTop.copy(a.top).lerp(b.top, f);
  }
  scene.add(skyDome);

  // Каспий: плоская голубая гладь
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: cssColor('--sea', '#5E95C8'), transparent: true, alphaMap: texFrom(256, (g, S) => {
      // края моря мягко уходят в дымку, как и земля
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.filter = 'blur(10px)'; g.fillStyle = '#fff'; g.fillRect(S * .09, S * .09, S * .82, S * .82); }) }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = SEA + 2.5;
  sea.receiveShadow = true;
  scene.add(sea);
  // за краем участка — равнина цвета дымки, чтобы край не обрывался ступенькой
  const apron = new THREE.Mesh(new THREE.RingGeometry(Math.max(W, D) * .7, 200000, 64, 1), new THREE.MeshBasicMaterial({ color: haze, fog: true }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = SEA + 1;
  scene.add(apron);

  // ---------- маршрут ----------
  const pts = route.points.map(([lon, lat]) => { const [x, z] = toXZ(lon, lat); return new THREE.Vector3(x, height(x, z) + 1.5, z); });
  // точки ближе 3 м друг к другу ломают сплайн (деление на ноль) — оставляем только различимые
  for (let i = pts.length - 1; i > 0; i--) if (pts[i].distanceTo(pts[i - 1]) < 3) pts.splice(i, 1);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', .5);
  const len = curve.getLength();
  const accent = cssColor('--accent', '#C8A15E');
  const trailSeg = Math.min(2000, pts.length * 3);
  // тропа — светлая дорожка с тёмной обводкой
  const trail = new THREE.Mesh(new THREE.TubeGeometry(curve, trailSeg, 4, 6, false), new THREE.MeshBasicMaterial({ color: cssColor('--toon-sand', '#E6DDC2') }));
  const trailLine = new THREE.Mesh(new THREE.TubeGeometry(curve, trailSeg, 5.6, 6, false), new THREE.MeshBasicMaterial({ color: ink, side: THREE.BackSide }));
  // в обзоре сверху тропа рисуется шире, иначе с 5 км она тоньше пикселя
  const wide = [new THREE.Mesh(new THREE.TubeGeometry(curve, trailSeg, 13, 6, false), trail.material),
    new THREE.Mesh(new THREE.TubeGeometry(curve, trailSeg, 17, 6, false), trailLine.material)];
  scene.add(trail, trailLine, ...wide); for (const w of wide) w.visible = false;
  // пройденный участок — цветом акцента
  // Трубка строится один раз по всей тропе с тем же шагом, что и сама тропа, а показывается её начало
  // до лошади (drawRange). Поэтому линия растёт плавно и точно повторяет изгибы, без перестройки на ходу.
  // чуть толще белой тропы и «ближе» к камере по глубине — иначе белая проступает штрихами сквозь жёлтую
  const doneMat = new THREE.MeshBasicMaterial({ color: accent, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const doneSeg = trailSeg * 2, RS = 6;
  const done = new THREE.Mesh(new THREE.TubeGeometry(curve, doneSeg, 4.6, RS, false), doneMat);
  const doneWide = new THREE.Mesh(new THREE.TubeGeometry(curve, doneSeg, 14, RS, false), doneMat);
  scene.add(done, doneWide);
  function drawDone(u) {
    const count = Math.floor(u * doneSeg) * RS * 6;   // 6 индексов на каждую из RS граней сегмента
    done.geometry.setDrawRange(0, count); doneWide.geometry.setDrawRange(0, count);
  }
  for (const [p, r] of [[pts[0], 22], [pts[pts.length - 1], 26]]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 8, 24), new THREE.MeshBasicMaterial({ color: accent }));
    pin.position.copy(p); scene.add(pin);
  }

  // ---------- трава и камни вдоль тропы: дают масштаб, когда камера рядом с лошадью ----------
  {
    const rnd = (a, b) => a + Math.random() * (b - a);
    const tuft = new THREE.ConeGeometry(.35, 1.4, 4); tuft.translate(0, .7, 0);
    const stone = new THREE.DodecahedronGeometry(.6, 0);
    const grassMat = toonMat('#6F8D3E'), stoneMat = toonMat('#BDB59B');
    const G = 9000, S = 1400;
    const grass = new THREE.InstancedMesh(tuft, grassMat, G), stones = new THREE.InstancedMesh(stone, stoneMat, S);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const place = (mesh, count, near, far, sMin, sMax) => {
      for (let i = 0; i < count; i++) {
        const p = curve.getPointAt(Math.random()), side = (Math.random() < .5 ? -1 : 1) * rnd(near, far), ang = Math.random() * Math.PI * 2;
        v.set(p.x + Math.cos(ang) * side, 0, p.z + Math.sin(ang) * side); v.y = height(v.x, v.z) - .1;
        e.set(rnd(-.25, .25), rnd(0, Math.PI * 2), rnd(-.25, .25)); q.setFromEuler(e);
        const k = rnd(sMin, sMax); sc.set(k * rnd(.7, 1.3), k, k * rnd(.7, 1.3));
        mesh.setMatrixAt(i, m4.compose(v, q, sc));
      }
      scene.add(mesh);
    };
    place(grass, G, 3.5, 40, .6, 1.4);
    place(stones, S, 4, 45, .4, 1.6);
  }

  // ---------- лошадь ----------
  const horse = new THREE.Group(); scene.add(horse);
  let mixer = null, action = null, gaits = null, gait = null;
  if (box.dataset.model && THREE.GLTFLoader) {
    const loader = new THREE.GLTFLoader();
    // сжатая модель (meshopt): декодер подключается на странице отдельным скриптом
    if (window.MeshoptDecoder) loader.setMeshoptDecoder(window.MeshoptDecoder);
    var horseReady = new Promise(res => loader.load(box.dataset.model, gltf => {
      const m = gltf.scene;
      // У моделей со скелетом рамка «до анимации» обманывает — меряем по костям, если они есть
      m.updateMatrixWorld(true);
      const box = new THREE.Box3();
      m.traverse(o => { if (o.isBone) box.expandByPoint(o.getWorldPosition(new THREE.Vector3())); if (o.isMesh) { o.frustumCulled = false; } });
      if (box.isEmpty()) box.setFromObject(m);
      const s = box.getSize(new THREE.Vector3());
      m.scale.setScalar(HORSE_M / s.y);
      m.position.y = -box.min.y * HORSE_M / s.y;
      m.rotation.y = Math.PI / 2;   // модель смотрит вдоль +Z, группа ведёт её вдоль +X
      horse.add(m);
      {
        // мультяшная лошадь: те же текстуры, но ступенчатый свет и тёмный контур (обратная оболочка)
        m.updateMatrixWorld(true);
        const hulls = [];
        m.traverse(o => {
          if (!o.isMesh) return;
          const old = o.material;
          o.material = new THREE.MeshToonMaterial({ map: old.map || null, color: old.color, gradientMap: toonGrad, skinning: !!o.isSkinnedMesh });
          const line = new THREE.MeshBasicMaterial({ color: ink, side: THREE.BackSide, skinning: !!o.isSkinnedMesh });
          // контур: после скиннинга сдвигаем вершину по нормали в метрах вида — не зависит от масштаба и сжатия модели
          line.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `vec3 hn = normal;
            #ifdef USE_SKINNING
              mat4 sm = bindMatrixInverse * (skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW) * bindMatrix;
              hn = (sm * vec4(hn, 0.0)).xyz;
            #endif
            vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
            mvPosition.xyz += normalize((modelViewMatrix * vec4(hn, 0.0)).xyz) * 0.22;
            gl_Position = projectionMatrix * mvPosition;`); };
          const hull = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, line) : new THREE.Mesh(o.geometry, line);
          if (o.isSkinnedMesh) hull.bind(o.skeleton, o.bindMatrix);
          hull.frustumCulled = false;
          hulls.push([o, hull]);
        });
        for (const [o, hull] of hulls) { hull.position.copy(o.position); hull.quaternion.copy(o.quaternion); hull.scale.copy(o.scale); o.parent.add(hull); }
      }
      res();
      if (!gltf.animations.length) return;
      mixer = new THREE.AnimationMixer(m);
      const find = re => gltf.animations.find(a => re.test(a.name));
      const walk = find(/(^|\|)walk$/i), gallop = find(/(^|\|)gallop$/i) || find(/run|gallop/i);
      if (walk && gallop) {
        // настоящая модель: шаг на крутых подъёмах, галоп на пологих участках
        gaits = { walk: mixer.clipAction(walk), gallop: mixer.clipAction(gallop) };
        for (const a of Object.values(gaits)) { a.play(); a.setEffectiveWeight(0); }
        gait = 'gallop'; gaits.gallop.setEffectiveWeight(1);
      } else { action = mixer.clipAction(gltf.animations[0]); action.play(); }
    }));
  }

  // ---------- подписи и панель ----------
  const label = (text, p) => { const el = document.createElement('div'); el.className = 'map-label'; el.textContent = text; box.append(el); return { el, p }; };
  const labels = [label(route.start_name || 'Старт', pts[0]), label(`${route.finish_name || 'Финиш'}, ${Math.round(route.points[route.points.length - 1][2])} м`, pts[pts.length - 1])];
  fillPanel(route);

  // ---------- камера ----------
  let modeCam = reduce && !DRIVE ? 'overview' : 'follow';
  const center = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
  let orbit = { yaw: -.9, pitch: .55, dist: THREE.MathUtils.clamp(len * 1.9, 2400, 6000) }, drag = null;
  box.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; drag = { x: e.clientX, y: e.clientY }; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', e => {
    if (!drag) return;
    if (modeCam !== 'overview') setMode('overview');
    orbit.yaw -= (e.clientX - drag.x) * .005; orbit.pitch = Math.min(1.35, Math.max(.2, orbit.pitch + (e.clientY - drag.y) * .004));
    drag = { x: e.clientX, y: e.clientY };
  });
  box.addEventListener('wheel', e => { if (modeCam !== 'overview') return; e.preventDefault(); orbit.dist = Math.min(11000, Math.max(1500, orbit.dist * (1 + e.deltaY * .001))); }, { passive: false });
  function setMode(m) {
    modeCam = m;
    for (const btn of document.querySelectorAll('[data-cam]')) btn.setAttribute('aria-pressed', String(btn.dataset.cam === m));
  }
  for (const btn of document.querySelectorAll('[data-cam]')) btn.addEventListener('click', () => setMode(btn.dataset.cam));
  setMode(modeCam);

  // ---------- движение ----------
  const tan0 = curve.getTangentAt(0);
  let rideSpeed = 0, rideDir = 1, lastSent = -1, idle = 0, needDraw = true, sharp = false;
  const frame = { x: 0, y: 0 }, frameTmp = new THREE.Vector3();
  // общие планы: в начале — от города на склон с тропой, в конце — со смотровой вниз на город и море
  const pS = pts[0], pF = pts[pts.length - 1];
  const down = new THREE.Vector3(pS.x - pF.x, 0, pS.z - pF.z).normalize(), across = new THREE.Vector3(-down.z, 0, down.x);
  const shotStart = { pos: pS.clone().addScaledVector(down, 1500).addScaledVector(across, -500).setY(pS.y + 820), look: pS.clone().lerp(pF, .5).setY(pF.y * .6) };
  const shotEnd = { pos: pF.clone().addScaledVector(down, -380).addScaledVector(across, 160).setY(pF.y + 210), look: pF.clone().addScaledVector(down, 2400).setY(0) };
  let u = 0, last = performance.now(), heading = Math.atan2(-tan0.z, tan0.x);
  const frustum = new THREE.Frustum(), projView = new THREE.Matrix4();
  // подстройка разрешения: если кадров мало, рисуем меньше пикселей (и наоборот)
  // на главной картинка во весь экран: в покое дорисовываем кадр в полном разрешении, чтобы не было «мыла»
  const maxDpr = Math.min(devicePixelRatio, DRIVE ? 2 : 1.5), minDpr = DRIVE ? 1 : .75;
  let dpr = maxDpr, frames = 0, frameTime = 0, slow = 0;
  function adapt(dt) {
    frames++; frameTime += dt;
    if (frameTime < 2) return;
    const fps = frames / frameTime; frames = 0; frameTime = 0;
    // уже на минимальном разрешении и всё равно меньше 18 кадров дважды подряд — переходим на видео
    if (fps < 18 && dpr <= minDpr && !RECORD) { if (++slow >= 2 && useVideo(`${Math.round(fps)} кадров/с`)) return; } else slow = 0;
    const next = fps < 30 ? Math.max(minDpr, dpr - .25) : fps > 55 ? Math.min(maxDpr, dpr + .25) : dpr;
    if (next !== dpr) { dpr = next; if (!sharp) { renderer.setPixelRatio(dpr); resize(); } }
  }
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  // fixedDt — шаг для записи видео, draw = false — только просчитать без отрисовки
  function step(now, fixedDt, draw = true) {
    const rawDt = Math.max(0, (now - last) / 1000), dt = fixedDt || Math.min(.05, rawDt); last = now;
    if (!fixedDt && rawDt < 1 && idle < 20) adapt(rawDt);
    let moving = true;
    if (DRIVE) {
      const target = Math.min(1, Math.max(0, +box.rideTarget || 0)), prevU = u;
      u = reduce ? target : u + (target - u) * (1 - Math.exp(-dt * 3.2));
      if (Math.abs(target - u) < 2e-5) u = target;
      const v = (u - prevU) * len / Math.max(dt, 1e-3);           // метров сцены в секунду, со знаком
      rideSpeed += (Math.abs(v) - rideSpeed) * Math.min(1, dt * 5);
      if (v < -1) rideDir = -1; else if (v > 1) rideDir = 1;
      if (gaits) {
        // медленная прокрутка — шаг, быстрая — галоп; стоит страница — лошадь замирает
        const want = rideSpeed > 60 ? 'gallop' : 'walk';
        if (want !== gait) { gaits[want].reset().setEffectiveWeight(1).play(); gaits[gait].crossFadeTo(gaits[want], .4, false); gait = want; }
        gaits.walk.timeScale = Math.min(2.2, rideSpeed / 26); gaits.gallop.timeScale = Math.min(1.8, rideSpeed / 70);
      } else if (action) action.timeScale = Math.min(2, rideSpeed / 40);
      if (mixer && !reduce) mixer.update(dt);
      moving = u !== target || rideSpeed > .3;
    } else if (!reduce) {
      // на крутом подъёме лошадь идёт медленнее, на ровном — быстрее
      const p0 = curve.getPointAt(u), p1 = curve.getPointAt(Math.min(1, u + .002));
      const grade = (p1.y - p0.y) / EXAG / Math.max(1, Math.hypot(p1.x - p0.x, p1.z - p0.z));
      const speed = THREE.MathUtils.clamp(70 - grade * 260, 22, 80);        // метров сцены в секунду
      u += speed * dt / len;
      if (!(u >= 0 && u < 1)) u = 0;   // конец маршрута или сбой — начинаем сначала
      if (action) action.timeScale = speed / 60;
      if (gaits) {
        const want = speed < 42 ? 'walk' : 'gallop';
        if (want !== gait) { gaits[want].reset().setEffectiveWeight(1).play(); gaits[gait].crossFadeTo(gaits[want], .6, false); gait = want; }
        gaits.walk.timeScale = speed / 26; gaits.gallop.timeScale = speed / 70;
      }
      if (mixer) mixer.update(dt);
    }
    // направление берём по касательной (у самого конца тропы точка «впереди» совпадает с текущей),
    // а поворот лошади и камеры сглаживаем, чтобы на серпантине не дёргало
    const p = curve.getPointAt(u), tan = curve.getTangentAt(u);
    const yawWant = Math.atan2(-tan.z, tan.x) + (rideDir < 0 ? Math.PI : 0);
    heading += Math.atan2(Math.sin(yawWant - heading), Math.cos(yawWant - heading)) * (reduce ? 1 : Math.min(1, dt * 6));
    horse.position.copy(p).y -= 1.5;
    horse.rotation.y = heading;
    drawDone(u);
    // общий план в начале и в конце прогулки по странице: 0 — за лошадью, 1 — общий план
    const k = DRIVE ? Math.max(1 - THREE.MathUtils.smoothstep(u, 0, .07), THREE.MathUtils.smoothstep(u, .93, 1)) : 0;
    { const far = modeCam !== 'follow' || (k > .55 && u < .5); for (const w of wide) w.visible = far; trail.visible = trailLine.visible = !far; done.visible = !far; doneWide.visible = far; }

    if (modeCam === 'follow') {
      // камера смотрит по усреднённому направлению участка ±40 м — плавнее, чем по самой лошади
      const a = curve.getPointAt(Math.max(0, u - 40 / len)), c = curve.getPointAt(Math.min(1, u + 40 / len));
      const dir = new THREE.Vector3(c.x - a.x, 0, c.z - a.z).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const back = DRIVE ? 380 : 240, off = DRIVE ? 230 : 170, up = DRIVE ? 210 : 170;
      const want = p.clone().addScaledVector(dir, -back).addScaledVector(side, off); want.y = Math.max(p.y + up, height(want.x, want.z) + 60);
      const look = p.clone().addScaledVector(dir, 60).setY(p.y + 8);
      if (DRIVE) {
        const wp = u < .5 ? shotStart : shotEnd;
        want.lerp(wp.pos, k); look.lerp(wp.look, k);
        moving = moving || camPos.distanceToSquared(want) > .25;
        camPos.lerp(want, reduce ? 1 : .06); camLook.lerp(look, reduce ? 1 : .08);
      } else { camPos.lerp(want, reduce ? 1 : .04); camLook.lerp(look, reduce ? 1 : .08); }
    } else {
      if (!drag && !reduce) orbit.yaw += dt * .03;
      const want = new THREE.Vector3(Math.sin(orbit.yaw) * Math.cos(orbit.pitch), Math.sin(orbit.pitch), Math.cos(orbit.yaw) * Math.cos(orbit.pitch)).multiplyScalar(orbit.dist).add(center);
      camPos.lerp(want, reduce ? 1 : .05); camLook.lerp(center, reduce ? 1 : .05);
    }
    camera.position.copy(camPos); camera.lookAt(camLook);
    // кадрирование: лошадь (в начале — вся тропа) ставим в свободную от табличек часть экрана (box.rideFocus = [x, y], доли экрана).
    // Сдвигаем не камеру, а «окно» объектива — перспектива та же, меняется только место объекта в кадре.
    if (DRIVE) {
      const w = box.clientWidth, h = box.clientHeight, f = box.rideFocus || [.5, .5];
      camera.clearViewOffset();
      const subj = (k > .5 && u < .5 ? frameTmp.copy(center) : frameTmp.copy(horse.position).setY(horse.position.y + 10)).project(camera);
      const endFade = u > .5 ? 1 - k : 1;
      if (subj.z < 1) {
        const wx = THREE.MathUtils.clamp(((subj.x + 1) / 2 - f[0]) * w, -.4 * w, .4 * w) * endFade;
        const wy = THREE.MathUtils.clamp(((1 - subj.y) / 2 - f[1]) * h, -.35 * h, .35 * h) * endFade;
        const a = reduce ? 1 : Math.min(1, dt * 3);
        if (Math.abs(wx - frame.x) + Math.abs(wy - frame.y) > .3) moving = true;
        frame.x += (wx - frame.x) * a; frame.y += (wy - frame.y) * a;
      }
      camera.setViewOffset(w, h, frame.x, frame.y, w, h);
      applyLight(u);
    }
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const c of culled) c.obj.visible = frustum.intersectsSphere(c.sphere) && (modeCam !== 'follow' || c.sphere.distanceToPoint(camPos) < c.far);
    skyDome.position.copy(camPos);
    sun.position.copy(SUN_DIR);
    // в обзоре дымка зависит от расстояния камеры: край участка всегда тонет в ней
    scene.fog.near = modeCam === 'follow' ? (DRIVE ? 2600 + k * 1800 : 1500) : orbit.dist * .7; scene.fog.far = modeCam === 'follow' ? (DRIVE ? 14000 + k * 5000 : 9000) : orbit.dist * 2.2;

    // прогресс в панели
    const meters = u * route.length_m, alt = Math.round(p.y / EXAG + meta.min_m);
    if ($('route-now')) $('route-now').textContent = `${(meters / 1000).toFixed(1).replace('.', ',')} км, высота ${alt} м`;

    if (DRIVE && Math.abs(u - lastSent) > 1e-6) { lastSent = u; box.dispatchEvent(new CustomEvent('ride', { detail: { u, meters, alt } })); }
    if (!draw) return;
    // страница стоит, лошадь и камера на месте — кадр не меняется, не рисуем его заново
    idle = moving || needDraw ? 0 : idle + 1; needDraw = false;
    if (DRIVE) {
      // остановились — один кадр в полном разрешении; поехали — снова подстраиваемся под скорость
      if (idle === 12 && dpr < maxDpr && !sharp) { sharp = true; renderer.setPixelRatio(maxDpr); resize(); needDraw = false; }
      else if (idle === 0 && sharp) { sharp = false; renderer.setPixelRatio(dpr); resize(); needDraw = false; }
      else if (idle > 12) return;
    }
    renderer.render(scene, camera);
    const w = RECORD ? REC_W : box.clientWidth, h = RECORD ? REC_H : box.clientHeight;
    for (const l of labels) {
      const v = l.p.clone().project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.opacity = vis ? 1 : 0;
      l.el.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(-50%, -140%)`;
      l.x = (v.x + 1) / 2 * w; l.y = (1 - v.y) / 2 * h; l.vis = vis;
    }
  }

  function resize() {
    if (RECORD) { renderer.setPixelRatio(1); renderer.setSize(REC_W, REC_H, false); camera.aspect = REC_W / REC_H; camera.updateProjectionMatrix(); return; }
    const w = box.clientWidth, h = box.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    needDraw = true;
  }
  new ResizeObserver(resize).observe(box);
  resize();
  camPos.set(center.x - 3000, 2600, center.z + 3000); camLook.copy(center);
  var running = true;
  if (RECORD) step(performance.now(), 1 / REC_FPS);
  else if (reduce && !DRIVE) { setMode('overview'); step(performance.now()); }
  else (function loop(now) { if (running) { step(now); requestAnimationFrame(loop); } })(performance.now());
  box.classList.add('is-ready');
  mark('первый кадр');
  // тяжёлое — после того, как карта уже видна
  await new Promise(r => setTimeout(r, 50));
  buildCity(); needDraw = true; mark('город построен');
  await new Promise(r => setTimeout(r, 30));
  await buildForest(); needDraw = true; mark('лес построен');
  if (horseReady) horseReady.then(() => { needDraw = true; });
  if (DEBUG) window.__terrain = { renderer, scene };
  if (RECORD) await record();

  // Запись: первый круг просчитываем без отрисовки (камера встаёт на место), второй — снимаем кадр за кадром.
  // Конец второго круга совпадает с началом, поэтому видео зацикливается без шва.
  async function record() {
    await horseReady;
    const to = box.dataset.recordTo || 'http://127.0.0.1:8766';
    setMode('follow');
    const cap = document.createElement('canvas'); cap.width = REC_W; cap.height = REC_H;
    const g = cap.getContext('2d');
    const css2 = getComputedStyle(document.body), font = getComputedStyle(document.body).fontFamily;
    let prev = u, t = performance.now(), guard = 0;
    while (!(u < prev) && guard++ < 100000) { prev = u; step(t += 1000 / REC_FPS, 1 / REC_FPS, false); }
    prev = u;
    for (let i = 0; ; i++) {
      step(t += 1000 / REC_FPS, 1 / REC_FPS, true);
      // круг замкнулся — этот кадр совпал бы с первым, его не пишем
      if (u < prev) { await fetch(`${to}/done`, { method: 'POST', body: String(i) }); console.info('[terrain] запись готова:', i, 'кадров'); break; }
      prev = u;
      g.drawImage(renderer.domElement, 0, 0);
      // подписи «Старт» / «Смотровая» в DOM не попадают на холст — рисуем их сами, как на странице
      g.font = '600 20px ' + font; g.textBaseline = 'middle';
      for (const l of labels) if (l.vis) {
        const tw = g.measureText(l.el.textContent).width, bw = tw + 28, bh = 36, x = l.x - bw / 2, y = l.y - bh * 1.4;
        g.fillStyle = css2.getPropertyValue('--ink').trim() || '#1F2A22'; g.beginPath(); g.roundRect(x, y, bw, bh, bh / 2); g.fill();
        g.fillStyle = css2.getPropertyValue('--bg').trim() || '#F4EFE4'; g.fillText(l.el.textContent, x + 14, y + bh / 2 + 1);
      }
      // toDataURL синхронный: toBlob в фоновом окне Chrome откладывает до простоя и запись ползёт
      const b64 = atob(cap.toDataURL('image/jpeg', .9).split(',')[1]), bytes = new Uint8Array(b64.length);
      for (let k = 0; k < b64.length; k++) bytes[k] = b64.charCodeAt(k);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      await fetch(`${to}/frame?i=${i}`, { method: 'POST', body: blob });
    }
  }
})();
