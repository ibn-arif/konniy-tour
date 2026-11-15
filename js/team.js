// Расписание для команды: главный подтверждает заявки и ведёт команду, инструктор видит свои выезды.
// Доступ — личный ключ из ссылки team.html#k=…; ключ хранится в localStorage (kt_key), из адреса убирается.
(function () {
  const api = window.KTApi, S = window.KTSlots;
  const $ = s => document.querySelector(s);
  const main = $('#main'), tabsNav = $('#tabs'), sheet = $('#sheet'), sheetBody = $('#sheet-body');

  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const STATUS = { pending: 'ждёт', confirmed: 'подтверждено', rejected: 'отклонено' };
  const EXP = ['Ни разу не ездил(а)', 'Пару раз катался(ась)', 'Уверенно езжу'];

  // ---------- мелочи ----------
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const today = () => iso(new Date());
  const dayLabel = s => { const d = parse(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${WD_FULL[d.getDay()]}`; };
  const whenLabel = (day, time) => `${dayLabel(day)}, в ${time}`;
  const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many; };
  const people = n => `${n} ${plural(n, 'человек', 'человека', 'человек')}`;
  const phoneH = d => d && d.length === 11 ? `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : (d ? '+' + d : '');

  // Элемент без innerHTML: всё, что пришло от гостей, попадает только в текст.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const icon = id => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
  const arrow = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };

  let toastTimer;
  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ---------- ключ и вызовы ----------
  const store = {
    get() { try { return localStorage.getItem('kt_key'); } catch (e) { return mem; } },
    set(v) { mem = v; try { localStorage.setItem('kt_key', v); } catch (e) { /* приватный режим: держим в памяти */ } },
  };
  let mem = null;
  const st = { key: null, me: null, tab: null, day: today(), routes: [], pending: [], openId: null };

  const call = (name, args) => api.rpc(name, Object.assign({ p_key: st.key }, args), { timeout: 8000 });
  const routeName = k => (st.routes.find(r => r.key === k) || {}).name || k;
  const routeDur = k => (st.routes.find(r => r.key === k) || {}).duration_min || 60;
  const errText = e => e.code === 'timeout' || e.code === 'network' ? 'Нет связи с расписанием. Проверьте интернет и попробуйте ещё раз.' : e.message;

  function screen(title, text, action) {
    tabsNav.hidden = true;
    main.replaceChildren(h('section', { class: 'empty-screen' },
      h('svg', null), h('h1', { text: title }), h('p', { text }), action || null));
    main.querySelector('svg').replaceWith(icon('horse'));
  }

  async function start() {
    const m = location.hash.match(/k=([0-9a-f]{16,128})/i);
    const r = location.hash.match(/r=([0-9a-f-]{36})/i);
    if (m) store.set(m[1].toLowerCase());
    if (r) st.openId = r[1];
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    st.key = store.get();
    if (!st.key) return screen('Нужна личная ссылка', 'Попросите у главного личную ссылку на расписание и откройте её на этом телефоне.');
    try {
      st.me = await call('team_whoami', {});
    } catch (e) {
      if (e.code === '42501') return screen('Ссылка больше не работает', 'Попросите новую у главного: он выдаст её в разделе «Команда».');
      return screen('Нет связи', errText(e), h('button', { class: 'btn btn-main', type: 'button', onclick: start, text: 'Попробовать ещё раз' }));
    }
    $('#who').textContent = st.me.role === 'head' ? 'Главный' : (st.me.name || 'Инструктор');
    const isHead = st.me.role === 'head';
    const tabs = isHead
      ? [['requests', 'Заявки'], ['schedule', 'День'], ['history', 'История'], ['team', 'Команда']]
      : [['mine', 'Мои выезды'], ['schedule', 'День'], ['record', 'Записать']];
    tabsNav.replaceChildren(...tabs.map(([k, t]) => h('button', { type: 'button', 'data-tab': k, onclick: () => go(k) },
      tabIcon(ICONS[k]), h('span', { text: t }), k === 'requests' ? h('b', { class: 'badge', hidden: true, 'aria-label': 'новых' }) : null)));
    tabsNav.hidden = false;
    // Главный попадает сразу к заявкам, если они есть, иначе — в день.
    const first = isHead ? ((await refreshBadge()) ? 'requests' : 'schedule') : 'mine';
    await go(first);
    if (st.openId) { const id = st.openId; st.openId = null; openRequest(id); }
  }

  const TITLES = { requests: 'Заявки', schedule: 'День', history: 'История', team: 'Команда', mine: 'Мои выезды', record: 'Записать гостя' };
  const ICONS = {
    requests: 'M3 13h5l2 3h4l2-3h5M5.5 5h13L21 13v6H3v-6z',
    schedule: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3',
    history: 'M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 3v4h4',
    team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M16 5.2a3 3 0 0 1 0 5.6M18 15c1.8.6 3 2.2 3 5',
    mine: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4',
    record: 'M12 5v14M5 12h14',
  };
  function tabIcon(d) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p);
    return s;
  }
  // Число ждущих заявок: на вкладке «Заявки» и на значке приложения.
  function setPending(n) {
    const b = tabsNav.querySelector('.badge');
    if (b) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; }
    badge(n);
  }
  async function refreshBadge() {
    if (!st.me || st.me.role !== 'head') return 0;
    try {
      const list = await call('team_requests', { p_from: today(), p_to: addDays(today(), 60), p_status: 'pending' });
      setPending(list.length);
      return list.length;
    } catch (e) { return 0; }
  }

  async function go(tab, arg) {
    st.tab = tab;
    for (const b of tabsNav.children) b.setAttribute('aria-current', String(b.dataset.tab === tab));
    $('.brand b').textContent = TITLES[tab] || 'Расписание';
    window.scrollTo(0, 0);
    main.replaceChildren(h('p', { class: 'state', text: 'Загружаем…' }));
    try {
      if (tab === 'requests') await viewRequests();
      else if (tab === 'schedule') await viewSchedule();
      else if (tab === 'team') await viewTeam();
      else if (tab === 'mine') await viewMine();
      else if (tab === 'record') await viewRecord();
      else if (tab === 'history') await viewHistory(arg);
    } catch (e) {
      if (e.code === '42501' && /forbidden/.test(e.message)) return screen('Ссылка больше не работает', 'Попросите новую у главного.');
      main.replaceChildren(h('p', { class: 'state err', text: errText(e) }),
        h('button', { class: 'btn', type: 'button', text: 'Попробовать ещё раз', onclick: () => go(tab) }));
    }
  }
  const refresh = () => { if (!st.tab) return; go(st.tab); if (st.tab !== 'requests') refreshBadge(); };

  // ---------- расписание дня ----------
  async function viewSchedule() {
    const isHead = st.me.role === 'head';
    const day = await call('team_day', { p_day: st.day });
    st.routes = day.routes || st.routes;

    const nav = h('div', { class: 'daynav' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущий день', onclick: () => { st.day = addDays(st.day, -1); go('schedule'); } }, arrow('M10 3 5 8l5 5')),
      h('label', { class: 'daypick' }, h('span', { text: dayLabel(st.day) }),
        h('input', { type: 'date', value: st.day, 'aria-label': 'Выбрать дату', onchange: e => { if (e.target.value) { st.day = e.target.value; go('schedule'); } } })),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Следующий день', onclick: () => { st.day = addDays(st.day, 1); go('schedule'); } }, arrow('m6 3 5 5-5 5')));
    const quick = h('div', { class: 'quick' }, ...[[-1, 'Вчера'], [0, 'Сегодня'], [1, 'Завтра']].map(([n, t]) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(st.day === addDays(today(), n)), text: t, onclick: () => { st.day = addDays(today(), n); go('schedule'); } })));

    const parts = [];
    parts.push(h('div', { class: 'daybar' }, nav, quick));
    parts.push(grid(day));
    const free = day.horses.total - day.horses.resting.length;
    parts.push(h('p', { class: 'horses' }, h('b', { text: `Лошади: в строю ${free} из ${day.horses.total}` }),
      day.horses.resting.length ? `, отдыхают: ${day.horses.resting.join(', ')}` : ', все в строю'));
    if (!isHead) parts.push(h('p', { class: 'muted', text: 'Подтверждает и переносит выезды главный. Телефоны гостей видны только в ваших выездах.' }));
    main.replaceChildren(...parts);
  }

  // ---------- заявки (главный) ----------
  async function viewRequests() {
    const [pend, soon] = await Promise.all([
      call('team_requests', { p_from: today(), p_to: addDays(today(), 60), p_status: 'pending' }),
      call('team_requests', { p_from: today(), p_to: addDays(today(), 2), p_status: 'confirmed' }),
    ]);
    if (!st.routes.length) st.routes = (await call('team_day', { p_day: today() })).routes;
    setPending(pend.length);
    const byDay = list => { const m = new Map(); for (const r of list) { if (!m.has(r.day)) m.set(r.day, []); m.get(r.day).push(r); } return [...m]; };
    const dayName = d => d === today() ? 'Сегодня' : d === addDays(today(), 1) ? 'Завтра' : dayLabel(d);
    const groups = list => byDay(list).map(([d, rs]) => h('div', { class: 'req-day' },
      h('h3', { text: dayName(d) }), h('ul', { class: 'reqs' }, ...rs.map(r => reqRow(r, false)))));
    main.replaceChildren(
      h('section', { class: 'card' },
        h('h2', { text: pend.length ? `Ждут ответа: ${pend.length}` : 'Новых заявок нет' }),
        pend.length ? h('p', { class: 'muted', text: 'Нажмите на заявку, чтобы подтвердить, перенести или отклонить.' })
          : h('p', { class: 'muted', text: 'Когда гость оставит заявку на сайте или инструктор запишет гостя, она появится здесь, а на вкладке загорится число.' }),
        ...groups(pend)),
      h('section', { class: 'card' },
        h('h2', { text: 'Ближайшие выезды' }),
        soon.length ? groups(soon) : h('p', { class: 'muted', text: 'На сегодня, завтра и послезавтра подтверждённых выездов нет.' })));
  }

  function reqRow(r, withDay) {
    return h('li', null, h('button', { type: 'button', class: `req ${r.status}`, onclick: () => openRequest(r.id) },
      h('span', { class: 'req-when', text: (withDay ? dayLabel(r.day).replace(/,.*/, '') + ', ' : '') + r.start_time }),
      h('span', { class: 'req-what' }, h('b', { text: r.guest_name }), ` · ${people(r.people)} · ${routeName(r.route_key)}`),
      h('span', { class: 'req-tag', text: r.source === 'instructor' ? 'от инструктора' : STATUS[r.status] })));
  }

  // Сетка-шкала: по вертикали время, каждый выезд — блок длиной в свой маршрут
  // (дальний 08:00–15:00 тянется на семь часов). Столбцы — инструкторы и «Ждут».
  const PX = 1.1;   // пикселей на минуту: час = 66 px
  function grid(day) {
    const listed = new Set(day.instructors.map(i => i.id));
    const cols = [{ id: null, name: 'Ждут', day_off: false }, ...day.instructors];
    const span = r => [mins(r.start_time), mins(r.start_time) + routeDur(r.route_key)];
    // В «Ждут» — заявки без инструктора и выезды, чьих инструкторов нет среди столбцов (например, отключили).
    const at = col => day.requests.filter(r =>
      col.id ? r.instructors.some(i => i.id === col.id) : !r.instructors.some(i => listed.has(i.id)));
    const ranges = [...day.routes.flatMap(r => r.slots.map(t => [mins(t), mins(t) + r.duration_min])), ...day.requests.map(span)];
    const from = Math.floor(Math.min(...ranges.map(x => x[0])) / 60) * 60;
    const to = Math.ceil(Math.max(...ranges.map(x => x[1])) / 60) * 60;
    const height = (to - from) * PX;
    const hours = []; for (let m = from; m < to; m += 60) hours.push(m);

    const axis = h('div', { class: 'tl-axis', style: `height:${height}px` },
      ...hours.map(m => h('span', { style: `top:${(m - from) * PX}px`, text: hhmm(m) })));
    const nowLine = () => {
      if (st.day !== today()) return null;
      const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
      return m >= from && m <= to ? h('i', { class: 'tl-now', style: `top:${(m - from) * PX}px`, 'aria-hidden': 'true' }) : null;
    };
    const widths = [];   // столбец шире, если в нём несколько заявок рядом
    const columns = cols.map(c => {
      const list = at(c).map(r => { const [a, b] = span(r); return { r, a, b }; }).sort((x, y) => x.a - y.a || x.b - y.b);
      const lanes = [];   // пересекающиеся заявки в одном столбце встают рядом
      for (const it of list) {
        let i = lanes.findIndex(end => end <= it.a);
        if (i < 0) { i = lanes.length; lanes.push(0); }
        lanes[i] = it.b; it.lane = i;
      }
      const n = Math.max(1, lanes.length);
      widths.push(`minmax(${n * 116}px, ${n}fr)`);
      const blocks = list.map(({ r, a, b, lane }) => {
        const dur = b - a, many = r.instructors.length > 1;
        return h('button', {
          type: 'button', class: `tl-ride ${r.status}${dur <= 60 ? ' short' : ''}`,
          style: `top:${(a - from) * PX + 1}px;height:${dur * PX - 3}px;left:calc(${lane * 100 / n}% + 3px);width:calc(${100 / n}% - 6px)`,
          'aria-label': `${r.start_time}–${hhmm(b)}, ${r.guest_name}, ${people(r.people)}, ${routeName(r.route_key)}, ${STATUS[r.status]}${many ? ', инструкторов: ' + r.instructors.length : ''}`,
          onclick: () => openRequest(r.id),
        },
          h('span', { class: 'tl-time', text: `${r.start_time}–${hhmm(b)}` }),
          h('b', { text: r.guest_name }),
          h('span', { text: `${people(r.people)} · ${routeName(r.route_key)}` }),
          many ? h('span', { class: 'tl-team', text: `вместе: ${r.instructors.map(i => i.name).join(', ')}` }) : null);
      });
      return h('div', { class: 'tl-colwrap' },
        h('div', { class: 'tl-head' + (c.day_off ? ' off' : '') }, h('span', { text: c.name }), c.day_off ? h('small', { text: 'выходной' }) : null),
        h('div', { class: 'tl-col' + (c.day_off ? ' off' : ''), style: `height:${height}px` }, nowLine(), ...blocks));
    });
    const tl = h('div', { class: 'tl', style: `grid-template-columns:52px ${widths.join(' ')}` },
      h('div', { class: 'tl-colwrap tl-axiswrap' }, h('div', { class: 'tl-head', text: 'Время' }), axis), ...columns);
    const wrap = h('div', { class: 'grid-wrap', tabindex: '0', 'aria-label': `Расписание на ${dayLabel(day.day)}` }, tl);
    return h('section', { class: 'card grid-card' }, wrap,
      h('p', { class: 'legend' }, h('span', { class: 'dot pending' }), 'ждёт ', h('span', { class: 'dot confirmed' }), 'подтверждено',
        st.day === today() ? h('span', { class: 'dot now' }) : null, st.day === today() ? 'сейчас' : null));
  }

  // ---------- заявка (нижний лист) ----------
  async function openRequest(id) {
    sheetBody.replaceChildren(h('p', { class: 'state', text: 'Загружаем заявку…' }));
    if (!sheet.open) sheet.showModal();
    try {
      const isHead = st.me.role === 'head';
      if (!st.routes.length) st.routes = (await call('team_day', { p_day: today() })).routes;
      const [r, opt] = await Promise.all([call('team_request', { p_id: id }),
        isHead ? call('head_options', { p_id: id }).catch(() => null) : null]);
      if (!r) { sheetBody.replaceChildren(sheetHead('Заявка не найдена'), h('p', { text: 'Возможно, её уже удалили.' })); return; }
      renderRequest(r, opt);
    } catch (e) {
      sheetBody.replaceChildren(sheetHead('Не получилось открыть'), h('p', { class: 'err', text: errText(e) }));
    }
  }
  const sheetHead = title => h('div', { class: 'sheet-head' }, h('h2', { id: 'sheet-title', text: title }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onclick: () => sheet.close() }, arrow('M4 4l8 8M12 4l-8 8')));

  function renderRequest(r, opt) {
    const isHead = st.me.role === 'head';
    const info = h('dl', { class: 'facts' },
      fact('Когда', whenLabel(r.day, r.start_time)),
      fact('Маршрут', routeName(r.route_key)),
      fact('Сколько', people(r.people)),
      fact('Гость', r.guest_name),
      r.guest_phone ? fact('Телефон', h('span', { class: 'phone' }, h('a', { href: 'tel:+' + r.guest_phone, text: phoneH(r.guest_phone) }),
        h('a', { class: 'wa', href: S.waLink(r.guest_phone, `Здравствуйте, ${r.guest_name}!`), target: '_blank', rel: 'noopener', 'aria-label': 'Написать в WhatsApp' }, icon('wa')))) : null,
      r.experience ? fact('Опыт', r.experience) : null,
      fact('Откуда', r.source === 'instructor' ? 'записал инструктор' : 'с сайта'),
      r.instructors.length ? fact(r.instructors.length > 1 ? 'Инструкторы' : 'Инструктор', r.instructors.map(i => i.name).join(', ')) : null,
      r.horses_count ? fact('Лошадей', String(r.horses_count)) : null);
    const status = h('p', { class: `status ${r.status}`, text: STATUS[r.status] });
    const parts = [sheetHead(`${r.start_time}, ${r.guest_name}`), status, info];
    if (isHead && r.status !== 'rejected' && opt) parts.push(headActions(r, opt));
    if (isHead && r.status === 'rejected') parts.push(notify(r, 'reject'));
    if (r.history && r.history.length) parts.push(historyBlock(r.history));
    sheetBody.replaceChildren(...parts);
  }
  const fact = (k, v) => h('div', null, h('dt', { text: k }), h('dd', null, v));

  // ---------- история ----------
  const shortDay = s => { const d = parse(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; };
  const stamp = at => { const d = new Date(at); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${hhmm(d.getHours() * 60 + d.getMinutes())}`; };
  const clock = at => { const d = new Date(at); return hhmm(d.getHours() * 60 + d.getMinutes()); };
  function eventText(e) {
    const d = e.details || {};
    const team = () => `инструкторы: ${(d.instructors || []).join(', ') || '—'}, лошадей: ${d.horses}`;
    switch (e.action) {
      case 'created': return e.actor_role === 'site' ? 'Заявка с сайта' : e.actor_role === 'head' ? 'Записал главный' : `Записал(а) ${e.actor_name}`;
      case 'confirmed': return `Подтверждено — ${team()}`;
      case 'updated': return `Изменено — ${team()}`;
      case 'moved': return `Перенесено: ${shortDay(d.from_day)}, ${d.from_time} → ${shortDay(d.to_day)}, ${d.to_time}` + (d.dropped ? '. Подтверждение снято' : '');
      case 'rejected': return 'Отклонено';
      default: return e.action;
    }
  }
  function historyBlock(list) {
    return h('details', { class: 'history' }, h('summary', { text: `История заявки (${list.length})` }),
      h('ol', { class: 'events' }, ...list.map(e => h('li', null,
        h('span', { class: 'ev-at', text: stamp(e.at) }),
        h('span', { class: `ev-what ${e.action}`, text: eventText(e) }),
        e.actor_role === 'instructor' && e.action !== 'created' ? h('span', { class: 'ev-who', text: e.actor_name }) : null))));
  }

  // Вкладка «История» у главного: что происходило с заявками, по дням, новые сверху.
  async function viewHistory(days) {
    days = days || 7;
    const list = await call('head_history', { p_from: addDays(today(), -(days - 1)), p_to: today() });
    if (!st.routes.length) st.routes = (await call('team_day', { p_day: today() })).routes;
    const groups = new Map();
    for (const e of list) { const k = iso(new Date(e.at)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const more = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Показать ещё неделю', onclick: () => go('history', days + 7) });
    if (!list.length) {
      main.replaceChildren(h('section', { class: 'card' }, h('h2', { text: 'История' }),
        h('p', { class: 'muted', text: `За последние ${days} дн. изменений не было. Здесь появится всё, что происходит с заявками: кто записал, подтвердил, перенёс или отклонил.` }), more));
      return;
    }
    main.replaceChildren(
      h('p', { class: 'muted', text: 'Что происходило с заявками. Нажмите на запись, чтобы открыть заявку.' }),
      ...[...groups].map(([d, evs]) => h('section', { class: 'card' },
        h('h2', { text: d === today() ? 'Сегодня' : d === addDays(today(), -1) ? 'Вчера' : dayLabel(d) }),
        h('ul', { class: 'feed' }, ...evs.map(e => h('li', null, h('button', { type: 'button', class: 'feed-item', onclick: () => openRequest(e.request_id) },
          h('span', { class: 'ev-at', text: clock(e.at) }),
          h('span', { class: 'feed-main' },
            h('span', { class: `ev-what ${e.action}`, text: eventText(e) }),
            h('span', { class: 'muted', text: `${e.guest_name}, ${people(e.people)} · ${shortDay(e.day)}, ${e.start_time} · ${routeName(e.route_key)}` }),
            e.actor_role === 'instructor' && e.action !== 'created' ? h('span', { class: 'muted', text: e.actor_name }) : null))))))),
      more);
  }

  function headActions(r, opt) {
    const need = Math.ceil(r.people / 5);
    const assigned = new Set(opt.instructors.filter(i => i.assigned).map(i => i.id));
    const list = [...opt.instructors].sort((a, b) => (a.busy || a.day_off) - (b.busy || b.day_off));
    if (!assigned.size) list.filter(i => !i.busy && !i.day_off).slice(0, need).forEach(i => assigned.add(i.id));
    const boxes = list.map(i => {
      const off = i.busy || i.day_off;
      return h('label', { class: 'check' + (off ? ' dis' : '') },
        h('input', { type: 'checkbox', value: i.id, checked: assigned.has(i.id) && !off, disabled: off }),
        h('span', { text: i.name }), off ? h('small', { text: i.day_off ? 'выходной' : 'занят' }) : null);
    });
    const horses = h('input', { type: 'number', inputmode: 'numeric', min: String(r.people), max: String(opt.free_horses), value: String(r.horses_count || r.people), 'aria-describedby': 'horses-hint' });
    const err = h('p', { class: 'err', role: 'alert', hidden: true });
    const fail = e => { err.textContent = errText(e); err.hidden = false; };

    const confirmBtn = h('button', { type: 'button', class: 'btn btn-main', text: r.status === 'confirmed' ? 'Сохранить' : 'Подтвердить' });
    confirmBtn.addEventListener('click', async () => {
      const ids = boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value);
      if (ids.length * 5 < r.people) return fail({ message: `Для ${people(r.people)} нужно инструкторов: ${need}.` });
      if (ids.length > opt.free_instructors) return fail({ message: `В это время можно взять инструкторов: ${opt.free_instructors}. Остальные нужны для ждущих заявок в то же время — сначала подтвердите или отклоните их.` });
      busy(confirmBtn, true);
      try {
        await call('head_confirm', { p_id: r.id, p_instructors: ids, p_horses: Number(horses.value) });
        const fresh = await call('team_request', { p_id: r.id });
        sheetBody.replaceChildren(sheetHead('Подтверждено'), h('p', { class: 'status confirmed', text: whenLabel(fresh.day, fresh.start_time) }),
          h('p', { text: `${fresh.guest_name}, ${people(fresh.people)}. Инструктор: ${fresh.instructors.map(i => i.name).join(', ')}.` }),
          notify(fresh, 'confirm'));
        refresh();
      } catch (e) { fail(e); busy(confirmBtn, false); }
    });

    let sure = false;
    const rejectBtn = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Отклонить' });
    rejectBtn.addEventListener('click', async () => {
      if (!sure) { sure = true; rejectBtn.textContent = 'Точно отклонить?'; rejectBtn.classList.add('danger'); return; }
      busy(rejectBtn, true);
      try {
        await call('head_reject', { p_id: r.id });
        sheetBody.replaceChildren(sheetHead('Заявка отклонена'), h('p', { text: `${r.guest_name}, ${whenLabel(r.day, r.start_time)}. Время снова свободно на сайте.` }), notify(r, 'reject'));
        refresh();
      } catch (e) { fail(e); busy(rejectBtn, false); }
    });

    const moveBox = moveForm(r, fail);
    const moveBtn = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Перенести', onclick: () => { moveBox.hidden = !moveBox.hidden; } });

    return h('div', { class: 'actions' },
      h('fieldset', null, h('legend', { text: 'Инструкторы' }),
        h('p', { class: 'muted', text: `Можно отметить нескольких: для ${people(r.people)} нужно не меньше ${need}` +
          (opt.free_instructors < list.filter(i => !i.busy && !i.day_off).length ? `, взять сейчас можно до ${opt.free_instructors} — остальные держат ждущие заявки в это же время.` : '.') }),
        h('div', { class: 'checks' }, ...boxes)),
      h('label', { class: 'field' }, h('span', { text: 'Лошадей' }), horses, h('small', { id: 'horses-hint', text: `свободно в это время: ${opt.free_horses}` })),
      err,
      h('div', { class: 'btn-row' }, confirmBtn),
      h('div', { class: 'btn-row two' }, moveBtn, rejectBtn),
      moveBox,
      r.status === 'confirmed' ? notify(r, 'confirm') : null);
  }

  function moveForm(r, fail) {
    const slots = (st.routes.find(x => x.key === r.route_key) || { slots: [r.start_time] }).slots;
    const day = h('input', { type: 'date', value: r.day, min: today() });
    const time = h('select', null, ...slots.map(t => h('option', { value: t, selected: t === r.start_time, text: t })));
    const btn = h('button', { type: 'button', class: 'btn btn-main', text: 'Перенести' });
    btn.addEventListener('click', async () => {
      busy(btn, true);
      try {
        const status = await call('head_move', { p_id: r.id, p_day: day.value, p_start: time.value });
        const fresh = await call('team_request', { p_id: r.id });
        sheetBody.replaceChildren(sheetHead('Перенесено'),
          h('p', { class: `status ${status}`, text: whenLabel(fresh.day, fresh.start_time) }),
          status === 'pending' && r.status === 'confirmed' ? h('p', { class: 'err', text: 'Инструктор в это время занят — подтвердите заявку заново.' }) : null,
          notify(fresh, 'move'),
          h('button', { type: 'button', class: 'btn btn-quiet', text: 'Открыть заявку', onclick: () => openRequest(r.id) }));
        refresh();
      } catch (e) { fail(e); busy(btn, false); }
    });
    return h('div', { class: 'move', hidden: true },
      h('label', { class: 'field' }, h('span', { text: 'День' }), day),
      h('label', { class: 'field' }, h('span', { text: 'Время' }), time), btn);
  }

  // «Сообщить гостю»: готовый текст в WhatsApp на номер гостя
  function notify(r, kind) {
    if (!r.guest_phone) return null;
    const when = whenLabel(r.day, r.start_time);
    const text = kind === 'confirm' ? S.waConfirmText({ name: r.guest_name, routeName: routeName(r.route_key), when, instructors: r.instructors.map(i => i.name), people: people(r.people) })
      : kind === 'reject' ? S.waRejectText({ name: r.guest_name, when })
      : S.waMoveText({ name: r.guest_name, when });
    return h('a', { class: 'btn btn-wa', href: S.waLink(r.guest_phone, text), target: '_blank', rel: 'noopener' }, icon('wa'), 'Сообщить гостю');
  }

  function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', String(on)); }

  // ---------- команда и лошади ----------
  // «Команда»: инструкторы, лошади, маршруты и своя ссылка — по одному разделу на экране.
  const TEAM_PARTS = [['instructors', 'Инструкторы'], ['horses', 'Лошади'], ['routes', 'Маршруты'], ['link', 'Ссылка']];
  async function viewTeam() {
    const to = addDays(today(), 29);
    const [data, day] = await Promise.all([call('head_team', { p_from: today(), p_to: to }), call('team_day', { p_day: today() })]);
    st.routes = day.routes;
    const days = Array.from({ length: 30 }, (_, i) => addDays(today(), i));
    st.teamPart = st.teamPart || 'instructors';
    const body = h('div', { class: 'team-body' });
    const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Разделы команды' }, ...TEAM_PARTS.map(([k, t]) =>
      h('button', { type: 'button', role: 'tab', 'data-part': k, text: t, onclick: () => { st.teamPart = k; show(); } })));
    function show() {
      for (const b of seg.children) b.setAttribute('aria-selected', String(b.dataset.part === st.teamPart));
      body.replaceChildren(part(st.teamPart));
    }
    function part(k) {
      if (k === 'instructors') return h('section', { class: 'card' }, h('h2', { text: 'Инструкторы' }),
        h('p', { class: 'muted', text: 'Нажмите на день в полоске, чтобы отметить выходной. Здесь же выдаются личные ссылки.' }),
        ...data.instructors.map(i => personCard(i, 'instructor', days)),
        addButton('+ добавить инструктора', 'instructor', days));
      if (k === 'horses') return h('section', { class: 'card' }, h('h2', { text: 'Лошади' }),
        h('p', { class: 'muted', text: 'Отмеченные дни — отдых. Лошадь «не в строю» не считается совсем.' }),
        ...data.horses.map(x => personCard(x, 'horse', days)),
        addButton('+ добавить лошадь', 'horse', days));
      if (k === 'routes') {
        const addRoute = h('button', { type: 'button', class: 'btn btn-quiet add', text: '+ добавить маршрут' });
        addRoute.addEventListener('click', () => {
          addRoute.before(routeCard({ key: null, name: '', duration_min: 60, slots: [], dur_label: '', note: '', active: true }, true));
          addRoute.previousElementSibling.querySelector('input').focus();
        });
        return h('section', { class: 'card' }, h('h2', { text: 'Маршруты' }),
          h('p', { class: 'muted', text: 'Что видят гости в форме записи: название, подпись и время выездов. Снимите «проводится», чтобы убрать маршрут с сайта, — уже записанные заявки останутся.' }),
          ...st.routes.map(r => routeCard(r)), addRoute);
      }
      return h('section', { class: 'card' }, h('h2', { text: 'Ваша ссылка' }),
        h('p', { class: 'muted', text: 'Если телефон потерялся или ссылка попала к чужому, выдайте себе новую — старая перестанет работать.' }),
        linkBox({ role: 'head' }));
    }
    main.replaceChildren(seg, body);
    show();
  }

  // Карточка маршрута: название, длительность, подписи для сайта, время выездов, «проводится».
  const DURS = [30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 420, 480, 600, 720];
  const durText = m => m % 60 === 0 ? `${m / 60} ч` : m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
  function routeCard(r, fresh) {
    const times = [...r.slots];
    const name = h('input', { value: r.name, placeholder: 'Название маршрута', 'aria-label': 'Название маршрута', autocomplete: 'off' });
    const dur = h('select', { 'aria-label': 'Длительность' },
      ...[...new Set([...DURS, r.duration_min])].sort((a, b) => a - b).map(m => h('option', { value: String(m), selected: m === r.duration_min, text: durText(m) })));
    const durLabel = h('input', { value: r.dur_label || '', placeholder: 'например, 45–60 мин' });
    const note = h('input', { value: r.note || '', placeholder: 'например, 3,5 км, 45–60 мин' });
    const active = h('input', { type: 'checkbox', checked: r.active });
    const chips = h('div', { class: 'chips', role: 'list', 'aria-label': 'Время выездов' });
    const drawChips = () => chips.replaceChildren(...(times.length ? times.sort().map(t => h('span', { class: 'chip-t', role: 'listitem' }, t,
      h('button', { type: 'button', 'aria-label': `Убрать ${t}`, text: '×', onclick: () => { times.splice(times.indexOf(t), 1); drawChips(); } }))) : [h('span', { class: 'muted', text: 'Времени пока нет — добавьте ниже.' })]));
    drawChips();
    const newTime = h('input', { type: 'time', step: '900', 'aria-label': 'Новое время выезда' });
    const addTime = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Добавить время' });
    addTime.addEventListener('click', () => { const t = newTime.value; if (t && !times.includes(t)) { times.push(t); drawChips(); } newTime.value = ''; });
    const msg = h('p', { class: 'saved', 'aria-live': 'polite', text: fresh ? 'Заполните и нажмите «Сохранить маршрут».' : '' });
    const save = h('button', { type: 'button', class: 'btn btn-main', text: 'Сохранить маршрут' });
    save.addEventListener('click', async () => {
      busy(save, true); msg.textContent = 'Сохраняем…';
      try {
        r.key = await call('head_save_route', { p_route: r.key, p_name: name.value, p_duration: Number(dur.value), p_slots: times,
          p_dur_label: durLabel.value, p_note: note.value, p_active: active.checked });
        st.routes = (await call('team_day', { p_day: today() })).routes;
        msg.textContent = active.checked ? 'Сохранено. На сайте уже новое.' : 'Сохранено. Маршрут убран с сайта.';
        card.classList.toggle('inactive', !active.checked);
      } catch (e) { msg.textContent = errText(e); }
      busy(save, false);
    });
    const card = h('div', { class: 'person route' + (r.active ? '' : ' inactive') },
      h('div', { class: 'person-top' }, name, h('label', { class: 'toggle' }, active, h('span', { text: 'проводится' }))),
      h('div', { class: 'two-col' },
        h('label', { class: 'field' }, h('span', { text: 'Длится' }), dur),
        h('label', { class: 'field' }, h('span', { text: 'Как писать на сайте' }), durLabel)),
      h('label', { class: 'field' }, h('span', { text: 'Подпись в форме записи' }), note),
      h('div', { class: 'field' }, h('span', { text: 'Время выездов' }), chips,
        h('div', { class: 'add-time' }, newTime, addTime)),
      save, msg);
    return card;
  }

  function addButton(text, kind, days) {
    const b = h('button', { type: 'button', class: 'btn btn-quiet add', text });
    b.addEventListener('click', () => {
      b.before(personCard({ id: null, name: '', phone: '', active: true, days_off: [], rest_days: [] }, kind, days, true));
      b.previousElementSibling.querySelector('input').focus();
    });
    return b;
  }

  function personCard(p, kind, days, fresh) {
    const isI = kind === 'instructor';
    const off = new Set(isI ? p.days_off : p.rest_days);
    const name = h('input', { value: p.name, placeholder: isI ? 'Имя инструктора' : 'Кличка', 'aria-label': isI ? 'Имя' : 'Кличка', autocomplete: 'off' });
    const phone = isI ? h('input', { type: 'tel', inputmode: 'tel', value: p.phone ? '+' + p.phone : '', placeholder: '+7 9__ ___-__-__', 'aria-label': 'Телефон' }) : null;
    const active = h('input', { type: 'checkbox', checked: p.active });
    const msg = h('small', { class: 'saved', 'aria-live': 'polite' });
    const card = h('div', { class: 'person' + (p.active ? '' : ' inactive') });

    async function save() {
      if (!name.value.trim()) { msg.textContent = 'Укажите имя'; return; }
      msg.textContent = 'Сохраняем…';
      try {
        p.id = await call(isI ? 'head_save_instructor' : 'head_save_horse', isI
          ? { p_id: p.id, p_name: name.value, p_phone: phone.value, p_active: active.checked }
          : { p_id: p.id, p_name: name.value, p_active: active.checked });
        p.phone = isI ? phone.value.replace(/\D/g, '') : null;
        p.active = active.checked;
        msg.textContent = 'Сохранено';
        card.classList.toggle('inactive', !active.checked);
        strip.hidden = false; if (link) link.hidden = false;
      } catch (e) {
        msg.textContent = errText(e);
        if (p.id && active.checked !== p.active) active.checked = p.active;   // отключить не дали — вернуть галочку
      }
    }
    name.addEventListener('change', save);
    if (phone) phone.addEventListener('change', save);
    active.addEventListener('change', save);

    const strip = h('div', { class: 'strip', hidden: !p.id, role: 'group', 'aria-label': isI ? 'Выходные' : 'Дни отдыха' }, ...days.map(d => {
      const dt = parse(d);
      const b = h('button', { type: 'button', class: 'dd' + (dt.getDay() === 0 || dt.getDay() === 6 ? ' we' : ''), 'aria-pressed': String(off.has(d)),
        'aria-label': `${dayLabel(d)}${isI ? ', выходной' : ', отдых'}` }, h('small', { text: WD[dt.getDay()] }), String(dt.getDate()));
      b.addEventListener('click', async () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        try { await call('head_set_day_off', { p_kind: kind, p_id: p.id, p_day: d, p_off: on }); }
        catch (e) { b.setAttribute('aria-pressed', String(!on)); toast(errText(e)); }
      });
      return b;
    }));
    const link = isI ? linkBox({ role: 'instructor', person: p, phoneInput: phone }) : null;
    if (link) link.hidden = !p.id;

    card.append(
      h('div', { class: 'person-top' }, name, h('label', { class: 'toggle' }, active, h('span', { text: isI ? 'работает' : 'в строю' }))),
      phone, msg, strip, link);
    if (fresh) msg.textContent = 'Впишите имя — сохранится само.';
    return card;
  }

  // «Выдать ссылку»: новый ключ, старая ссылка перестаёт работать
  function linkBox({ role, person, phoneInput }) {
    const out = h('div', { class: 'link-out', hidden: true });
    const btn = h('button', { type: 'button', class: 'btn btn-quiet', text: role === 'head' ? 'Выдать себе новую ссылку' : (person.has_key ? 'Выдать новую ссылку' : 'Выдать ссылку') });
    let sure = false;
    btn.addEventListener('click', async () => {
      if (!sure) { sure = true; btn.textContent = 'Старая ссылка перестанет работать. Выдать?'; return; }
      busy(btn, true);
      try {
        const key = await call('head_issue_key', { p_role: role, p_instructor: role === 'head' ? null : person.id });
        const url = new URL('team.html', location.href).href + '#k=' + key;
        if (role === 'head') { store.set(key); st.key = key; }
        const field = h('input', { readonly: true, value: url, 'aria-label': 'Ссылка', onfocus: e => e.target.select() });
        const copy = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Скопировать' });
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(url); copy.textContent = 'Скопировано'; } catch (e) { field.select(); }
        });
        const digits = phoneInput ? phoneInput.value.replace(/\D/g, '') : '';
        out.replaceChildren(
          h('p', { class: 'warn', text: 'Старая ссылка больше не работает. Новую отправьте только этому человеку.' }),
          field, h('div', { class: 'btn-row two' }, copy,
            role === 'instructor' && digits.length >= 10
              ? h('a', { class: 'btn btn-wa', href: S.waLink(digits, `Ваша ссылка на расписание Konniy Tour: ${url}\nОткройте её на телефоне и добавьте на главный экран.`), target: '_blank', rel: 'noopener' }, icon('wa'), 'Отправить в WhatsApp')
              : null));
        out.hidden = false;
        btn.textContent = 'Выдать ещё раз'; sure = false;
        if (person) person.has_key = true;
      } catch (e) { toast(errText(e)); }
      busy(btn, false);
    });
    return h('div', { class: 'linkbox' }, btn, out);
  }

  // ---------- инструктор: мои выезды ----------
  async function viewMine() {
    const [list, day] = await Promise.all([
      call('team_requests', { p_from: today(), p_to: addDays(today(), 13), p_mine: true }),
      st.routes.length ? null : call('team_day', { p_day: today() }),
    ]);
    if (day) st.routes = day.routes;
    if (!list.length) {
      main.replaceChildren(h('section', { class: 'card' }, h('h2', { text: 'Выездов пока нет' }),
        h('p', { class: 'muted', text: 'Здесь появятся прогулки на ближайшие две недели, когда главный назначит вас инструктором.' })));
      return;
    }
    const byDay = new Map();
    for (const r of list) { if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push(r); }
    main.replaceChildren(...[...byDay].map(([d, rs]) => h('section', { class: 'card' },
      h('h2', { text: d === today() ? 'Сегодня, ' + dayLabel(d).replace(/^.*?, /, '') : dayLabel(d) }),
      h('ul', { class: 'rides' }, ...rs.map(r => h('li', { class: 'ride' },
        h('p', { class: 'ride-time' }, h('b', { text: r.start_time }), ` — ${hhmm(mins(r.start_time) + routeDur(r.route_key))}, ${routeName(r.route_key)}`),
        h('p', null, h('b', { text: r.guest_name }), `, ${people(r.people)}`, r.experience ? ` · ${r.experience}` : ''),
        r.guest_phone ? h('p', { class: 'phone' }, h('a', { href: 'tel:+' + r.guest_phone, text: phoneH(r.guest_phone) }),
          h('a', { class: 'wa', href: S.waLink(r.guest_phone, `Здравствуйте, ${r.guest_name}! Я ваш инструктор на прогулке ${whenLabel(r.day, r.start_time)}.`), target: '_blank', rel: 'noopener', 'aria-label': 'Написать в WhatsApp' }, icon('wa'))) : null,
        r.instructors.length > 1 ? h('p', { class: 'muted', text: 'Вместе с: ' + r.instructors.filter(i => i.id !== st.me.instructor_id).map(i => i.name).join(', ') }) : null,
        h('p', { class: `status ${r.status}`, text: STATUS[r.status] })))))));
  }

  // ---------- инструктор: записать гостя ----------
  async function viewRecord() {
    if (!st.routes.length) st.routes = (await call('team_day', { p_day: today() })).routes;
    const open = st.routes.filter(r => r.active !== false);
    const f = { route: open[0].key, day: today(), people: 1, time: null };
    const routes = h('div', { class: 'pick' }, ...open.map((r, i) => h('label', null,
      h('input', { type: 'radio', name: 'route', value: r.key, checked: i === 0, onchange: () => { f.route = r.key; load(); } }), h('span', { text: r.name }))));
    const day = h('input', { type: 'date', value: f.day, min: today(), max: addDays(today(), 60), onchange: e => { f.day = e.target.value; load(); } });
    const ppl = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '10', value: '1', onchange: e => { f.people = Math.min(10, Math.max(1, Number(e.target.value) || 1)); e.target.value = f.people; load(); } });
    const slots = h('div', { class: 'slots', role: 'group', 'aria-label': 'Время выезда' });
    const name = h('input', { autocomplete: 'off', placeholder: 'Как зовут гостя' });
    const phone = h('input', { type: 'tel', inputmode: 'tel', placeholder: '+7 9__ ___-__-__' });
    const exp = h('select', null, ...EXP.map(t => h('option', { text: t })));
    const err = h('p', { class: 'err', role: 'alert', hidden: true });
    const send = h('button', { type: 'submit', class: 'btn btn-main', text: 'Отправить главному' });

    async function load() {
      f.time = null;
      slots.replaceChildren(h('p', { class: 'muted', text: 'Смотрим свободное время…' }));
      try {
        const rows = await api.rpc('free_slots', { p_route: f.route, p_from: f.day, p_to: f.day, p_people: f.people });
        const list = (S.byDay(rows).get(f.day) || []);
        slots.replaceChildren(...(list.length ? list.map(s => {
          const b = h('button', { type: 'button', class: 'slot', 'aria-pressed': 'false' }, s.time, s.spots < 10 ? h('small', { text: `мест: ${s.spots}` }) : null);
          b.addEventListener('click', () => { f.time = s.time; for (const x of slots.children) x.setAttribute('aria-pressed', String(x === b)); });
          return b;
        }) : [h('p', { class: 'muted', text: 'На этот день свободного времени нет.' })]));
      } catch (e) { slots.replaceChildren(h('p', { class: 'err', text: errText(e) })); }
    }

    const form = h('form', { class: 'card record', novalidate: true },
      h('h2', { text: 'Записать гостя' }),
      h('p', { class: 'muted', text: 'Гость позвонил вам? Запишите его — заявка уйдёт главному на подтверждение.' }),
      h('fieldset', null, h('legend', { text: 'Маршрут' }), routes),
      h('div', { class: 'two-col' }, h('label', { class: 'field' }, h('span', { text: 'День' }), day), h('label', { class: 'field' }, h('span', { text: 'Сколько человек' }), ppl)),
      h('fieldset', null, h('legend', { text: 'Время выезда' }), slots),
      h('label', { class: 'field' }, h('span', { text: 'Имя гостя' }), name),
      h('label', { class: 'field' }, h('span', { text: 'Телефон гостя' }), phone),
      h('label', { class: 'field' }, h('span', { text: 'Опыт' }), exp),
      err, send);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const problem = !f.time ? 'Выберите время выезда.' : !name.value.trim() ? 'Напишите имя гостя.' : phone.value.replace(/\D/g, '').length < 10 ? 'Проверьте телефон: нужно не меньше 10 цифр.' : '';
      if (problem) { err.textContent = problem; err.hidden = false; return; }
      err.hidden = true; busy(send, true);
      try {
        await call('team_create_request', { p_route: f.route, p_day: f.day, p_start: f.time, p_people: f.people, p_name: name.value, p_phone: phone.value, p_experience: exp.value });
        main.replaceChildren(h('section', { class: 'card done' }, h('h2', { text: 'Заявка отправлена главному' }),
          h('p', { text: `${name.value.trim()}, ${people(f.people)}, ${whenLabel(f.day, f.time)}. Время уже не предлагается на сайте. Когда главный подтвердит, выезд появится в «Мои выезды».` }),
          h('button', { type: 'button', class: 'btn btn-quiet', text: 'Записать ещё', onclick: () => go('record') })));
      } catch (x) { err.textContent = errText(x); err.hidden = false; busy(send, false); if (x.code === 'P0001') load(); }
    });
    main.replaceChildren(form);
    load();
  }

  // ---------- значок на иконке ----------
  function badge(n) {
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (!n && navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) { /* не поддерживается */ }
  }

  // ---------- общее ----------
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  $('#reload').addEventListener('click', () => { if (st.me) { refresh(); if (sheet.open) sheet.close(); } else start(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.me && !sheet.open) refresh(); });
  window.addEventListener('hashchange', () => {
    const r = location.hash.match(/r=([0-9a-f-]{36})/i);
    if (/k=/.test(location.hash)) return start();
    if (r && st.me) { history.replaceState(null, '', location.pathname); openRequest(r[1]); }
  });

  if (!api || !api.configured()) screen('Расписание недоступно', 'Не задан адрес базы (js/config.js).');
  else start();
})();
