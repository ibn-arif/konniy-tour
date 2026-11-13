// Прогулка прокруткой: позиция страницы → место лошади на тропе (0 — конюшня, 1 — смотровая).
// Каждый раздел с data-at — точка на тропе; между ними положение плавно растёт вместе с прокруткой.
// Здесь же высотный профиль внизу экрана, отметки «км · м» на табличках и ссылки WhatsApp с готовым текстом.
(function () {
  const world = document.querySelector('.world');
  const stops = [...document.querySelectorAll('.stop[data-at]')].map(el => ({ el, at: +el.dataset.at }));
  const fmtKm = m => (m / 1000).toFixed(1).replace('.', ',') + ' км';

  // ---------- профиль высоты по настоящей тропе ----------
  let prof = null;   // { dist: [м], alt: [м], total }
  const svg = document.querySelector('.alt-svg'), PW = 240, PH = 56;
  function at(u) {   // высота и путь в точке u
    if (!prof) return null;
    const d = u * prof.total; let i = 1;
    while (i < prof.dist.length - 1 && prof.dist[i] < d) i++;
    const t = Math.min(1, Math.max(0, (d - prof.dist[i - 1]) / (prof.dist[i] - prof.dist[i - 1] || 1)));
    return { m: d, alt: prof.alt[i - 1] + (prof.alt[i] - prof.alt[i - 1]) * t };
  }
  const xy = (d, a) => [d / prof.total * PW, PH - 6 - (a - prof.lo) / (prof.hi - prof.lo || 1) * (PH - 14)];
  fetch(world.dataset.terrain + 'route.json').then(r => r.json()).then(route => {
    const R = 6371000, rad = Math.PI / 180, dist = [0], alt = route.points.map(p => p[2]);
    for (let i = 1; i < route.points.length; i++) {
      const [lo1, la1] = route.points[i - 1], [lo2, la2] = route.points[i];
      const x = (lo2 - lo1) * rad * Math.cos((la1 + la2) / 2 * rad), y = (la2 - la1) * rad;
      dist.push(dist[i - 1] + Math.hypot(x, y) * R);
    }
    prof = { dist, alt, total: dist[dist.length - 1], lo: Math.min(...alt), hi: Math.max(...alt) };
    const line = dist.map((d, i) => xy(d, alt[i]).map(v => v.toFixed(1)).join(' ')).join(' L');
    svg.querySelector('.alt-line').setAttribute('d', 'M' + line);
    done.setAttribute('d', 'M' + line);
    svg.querySelector('.alt-area').setAttribute('d', `M${line} L${PW} ${PH} L0 ${PH}Z`);
    // отметки на табличках: «Лес · 0,9 км · 171 м»
    for (const s of stops) {
      const tag = s.el.querySelector('[data-stake]'); if (!tag) continue;
      const p = at(s.at);
      tag.textContent = `${tag.textContent.split(' · ')[0]} · ${fmtKm(p.m)} · ${Math.round(p.alt)} м`;
    }
    show(target);
  }).catch(() => {});

  const done = svg.querySelector('.alt-done'), clip = svg.querySelector('#alt-clip rect'), dot = document.querySelector('.alt-dot');
  const km = document.querySelector('.alt-km'), alt = document.querySelector('.alt-m');
  function show(u) {
    const p = at(u); if (!p) return;
    const [x, y] = xy(p.m, p.alt);
    dot.style.left = (x / PW * 100).toFixed(2) + '%'; dot.style.top = (y / PH * 100).toFixed(2) + '%';
    clip.setAttribute('width', x.toFixed(1));
    km.textContent = fmtKm(p.m); alt.textContent = Math.round(p.alt) + ' м';
  }

  // ---------- прокрутка → цель на тропе ----------
  let target = 0, queued = false;
  function measure() {
    queued = false;
    const mid = scrollY + innerHeight * .5;
    // середина экрана проходит середину каждого раздела ровно тогда, когда лошадь стоит в его точке
    const marks = stops.map(s => { const r = s.el.getBoundingClientRect(); return { y: r.top + scrollY + r.height * .5, at: s.at }; });
    marks[0].y = Math.min(marks[0].y, innerHeight * .5);   // в самом верху страницы лошадь у конюшни
    let u = marks[marks.length - 1].at;
    if (mid <= marks[0].y) u = marks[0].at;
    else for (let i = 1; i < marks.length; i++) if (mid < marks[i].y) {
      const t = (mid - marks[i - 1].y) / (marks[i].y - marks[i - 1].y);
      u = marks[i - 1].at + (marks[i].at - marks[i - 1].at) * t; break;
    }
    target = u;
    // где на экране свободно от текста: туда 3D-сцена ставит лошадь (world.rideFocus = [x, y] в долях экрана)
    let near = null, best = Infinity;
    for (const st of stops) { const r = st.el.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - innerHeight / 2); if (d < best) { best = d; near = st.el; } }
    world.rideFocus = near ? freeSpot(near) : [.5, .5];
    world.rideTarget = u;
    // в видео-режиме и до загрузки 3D профиль следует прямо за прокруткой
    if (!world.classList.contains('is-live')) show(u);
    // на смотровой профиль уже не нужен и закрыл бы кнопку записи
    document.documentElement.classList.toggle('at-end', u > .93);
  }
  // объединяем прямоугольники текста раздела и ищем самую большую свободную полосу: справа/слева или сверху/снизу
  function freeSpot(stop) {
    const W = innerWidth, H = innerHeight, TOP = 84;
    const rects = [...stop.children].filter(c => !c.matches('.scroll-cue')).map(c => c.getBoundingClientRect())
      .filter(q => q.bottom > TOP && q.top < H && q.width > 0).sort((p, q) => p.top - q.top);
    if (!rects.length) return [.5, .5];
    const l = Math.min(...rects.map(q => q.left)), r = Math.max(...rects.map(q => q.right));
    // свободная полоса сбоку (широкий экран)
    const right = W - r, left = l;
    if (Math.max(right, left) >= W * .3) return right >= left ? [(r + W) / 2 / W, .5] : [l / 2 / W, .5];
    // иначе — самый большой просвет по высоте: над текстом, между блоками или под ним
    let gap = 0, y = .5, prev = TOP;
    for (const q of [...rects, { top: H, bottom: H }]) {
      if (q.top - prev > gap) { gap = q.top - prev; y = (prev + q.top) / 2 / H; }
      prev = Math.max(prev, q.bottom);
    }
    return gap > 110 ? [.5, y] : [.5, .5];
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(measure); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  measure();
  world.addEventListener('ride', e => { world.classList.add('is-live'); show(e.detail.u); });

  // ---------- быстрый выбор маршрута на первом экране → форма записи ----------
  const quick = document.getElementById('quick');
  quick && quick.addEventListener('submit', e => {
    e.preventDefault();
    const v = quick.elements.q.value, r = document.querySelector(`#book-form input[name=route][value="${v}"]`);
    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('book').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  // ---------- WhatsApp с готовым текстом: написать первым проще ----------
  for (const a of document.querySelectorAll('.js-wa')) {
    const text = a.dataset.route === 'Абонемент'
      ? 'Здравствуйте! Хочу купить абонемент на конные прогулки.'
      : 'Здравствуйте! Хочу записаться на конную прогулку. Нас будет …, опыт верховой езды: …';
    a.href = 'https://wa.me/79640014458?text=' + encodeURIComponent(text);
  }
})();
