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
      if (e.code === '42501') return screen('Ссылка больше не работает', 'Попросите новую у главного: он выдаст её в разделе «Команда и лошади».');
      return screen('Нет связи', errText(e), h('button', { class: 'btn btn-main', type: 'button', onclick: start, text: 'Попробовать ещё раз' }));
    }
    $('#who').textContent = st.me.role === 'head' ? 'Главный' : (st.me.name || 'Инструктор');
    const tabs = st.me.role === 'head'
      ? [['schedule', 'Расписание'], ['team', 'Команда и лошади']]
      : [['mine', 'Мои выезды'], ['schedule', 'Расписание'], ['record', 'Записать гостя']];
    tabsNav.replaceChildren(...tabs.map(([k, t]) => h('button', { type: 'button', 'data-tab': k, text: t, onclick: () => go(k) })));
    tabsNav.hidden = false;
    await go(tabs[0][0]);
    if (st.openId) { const id = st.openId; st.openId = null; openRequest(id); }
  }

  async function go(tab) {
    st.tab = tab;
    for (const b of tabsNav.children) b.setAttribute('aria-current', String(b.dataset.tab === tab));
    main.replaceChildren(h('p', { class: 'state', text: 'Загружаем…' }));
    try {
      if (tab === 'schedule') await viewSchedule();
      else if (tab === 'team') await viewTeam();
      else if (tab === 'mine') await viewMine();
      else if (tab === 'record') await viewRecord();
    } catch (e) {
      if (e.code === '42501' && /forbidden/.test(e.message)) return screen('Ссылка больше не работает', 'Попросите новую у главного.');
      main.replaceChildren(h('p', { class: 'state err', text: errText(e) }),
        h('button', { class: 'btn', type: 'button', text: 'Попробовать ещё раз', onclick: () => go(tab) }));
    }
  }
  const refresh = () => st.tab && go(st.tab);

  // ---------- расписание дня ----------
  async function viewSchedule() {
    const isHead = st.me.role === 'head';
    const [day, pend] = await Promise.all([
      call('team_day', { p_day: st.day }),
      isHead ? call('team_requests', { p_from: today(), p_to: addDays(today(), 60), p_status: 'pending' }) : Promise.resolve(null),
    ]);
    st.routes = day.routes || st.routes;
    if (pend) { st.pending = pend; badge(pend.length); }

    const nav = h('div', { class: 'daynav' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущий день', onclick: () => { st.day = addDays(st.day, -1); go('schedule'); } }, arrow('M10 3 5 8l5 5')),
      h('label', { class: 'daypick' }, h('span', { text: dayLabel(st.day) }),
        h('input', { type: 'date', value: st.day, 'aria-label': 'Выбрать дату', onchange: e => { if (e.target.value) { st.day = e.target.value; go('schedule'); } } })),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Следующий день', onclick: () => { st.day = addDays(st.day, 1); go('schedule'); } }, arrow('m6 3 5 5-5 5')));
    const quick = h('div', { class: 'quick' }, ...[[-1, 'Вчера'], [0, 'Сегодня'], [1, 'Завтра']].map(([n, t]) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(st.day === addDays(today(), n)), text: t, onclick: () => { st.day = addDays(today(), n); go('schedule'); } })));

    const parts = [];
    if (isHead) {
      parts.push(h('section', { class: 'card new' },
        h('h2', { text: pend.length ? `Новые заявки: ${pend.length}` : 'Новых заявок нет' }),
        pend.length ? h('ul', { class: 'reqs' }, ...pend.map(r => reqRow(r, true))) : h('p', { class: 'muted', text: 'Когда гость или инструктор оставит заявку, она появится здесь.' })));
    }
    parts.push(h('div', { class: 'daybar' }, nav, quick));
    parts.push(grid(day));
    const free = day.horses.total - day.horses.resting.length;
    parts.push(h('p', { class: 'horses' }, h('b', { text: `Лошади: свободно ${free} из ${day.horses.total}` }),
      day.horses.resting.length ? `, отдыхают: ${day.horses.resting.join(', ')}` : ', все в строю'));
    if (!isHead) parts.push(h('p', { class: 'muted', text: 'Подтверждает и переносит выезды главный. Телефоны гостей видны только в ваших выездах.' }));
    main.replaceChildren(...parts);
  }

  function reqRow(r, withDay) {
    return h('li', null, h('button', { type: 'button', class: `req ${r.status}`, onclick: () => openRequest(r.id) },
      h('span', { class: 'req-when', text: (withDay ? dayLabel(r.day).replace(/,.*/, '') + ', ' : '') + r.start_time }),
      h('span', { class: 'req-what' }, h('b', { text: r.guest_name }), ` · ${people(r.people)} · ${routeName(r.route_key)}`),
      h('span', { class: 'req-tag', text: r.source === 'instructor' ? 'от инструктора' : STATUS[r.status] })));
  }

  // Сетка: строки — время выезда всех маршрутов, столбцы — инструкторы (плюс «без инструктора» для ждущих).
  function grid(day) {
    const times = [...new Set(day.routes.flatMap(r => r.slots))].sort();
    const cols = [{ id: null, name: 'Ждут', day_off: false }, ...day.instructors];
    const span = r => [mins(r.start_time), mins(r.start_time) + routeDur(r.route_key)];
    const at = (col, t) => day.requests.filter(r =>
      col.id ? r.instructors.some(i => i.id === col.id) : r.instructors.length === 0);

    const head = h('tr', null, h('th', { scope: 'col', class: 'tcol', text: 'Время' }),
      ...cols.map(c => h('th', { scope: 'col', class: c.day_off ? 'off' : null }, c.name, c.day_off ? h('small', { text: 'выходной' }) : null)));
    const rows = times.map(t => h('tr', null, h('th', { scope: 'row', class: 'tcol', text: t }), ...cols.map(c => {
      const td = h('td', { class: c.day_off ? 'off' : null });
      for (const r of at(c, t)) {
        const [s, e] = span(r);
        if (r.start_time === t) {
          td.append(h('button', { type: 'button', class: `cell ${r.status}`, onclick: () => openRequest(r.id) },
            h('b', { text: r.guest_name }), h('span', { text: `${people(r.people)}, ${routeName(r.route_key)}` }),
            routeDur(r.route_key) > 90 ? h('span', { text: `до ${hhmm(e)}` }) : null));
        } else if (mins(t) > s && mins(t) < e && c.id) {
          td.classList.add('busy'); td.title = `Занят: ${r.guest_name}`;
        }
      }
      return td;
    })));
    const wrap = h('div', { class: 'grid-wrap', tabindex: '0', 'aria-label': `Расписание на ${dayLabel(day.day)}` },
      h('table', { class: 'grid' }, h('thead', null, head), h('tbody', null, ...rows)));
    return h('section', { class: 'card grid-card' }, wrap,
      h('p', { class: 'legend' }, h('span', { class: 'dot pending' }), 'ждёт ', h('span', { class: 'dot confirmed' }), 'подтверждено ',
        h('span', { class: 'dot busy' }), 'занят в пути'));
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
      r.instructors.length ? fact('Инструктор', r.instructors.map(i => i.name).join(', ')) : null,
      r.horses_count ? fact('Лошадей', String(r.horses_count)) : null);
    const status = h('p', { class: `status ${r.status}`, text: STATUS[r.status] });
    const parts = [sheetHead(`${r.start_time}, ${r.guest_name}`), status, info];
    if (isHead && r.status !== 'rejected' && opt) parts.push(headActions(r, opt));
    if (isHead && r.status === 'rejected') parts.push(notify(r, 'reject'));
    sheetBody.replaceChildren(...parts);
  }
  const fact = (k, v) => h('div', null, h('dt', { text: k }), h('dd', null, v));

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
      h('fieldset', null, h('legend', { text: `Инструкторы (нужно ${need})` }), h('div', { class: 'checks' }, ...boxes)),
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
  async function viewTeam() {
    const to = addDays(today(), 29);
    const data = await call('head_team', { p_from: today(), p_to: to });
    const days = Array.from({ length: 30 }, (_, i) => addDays(today(), i));
    main.replaceChildren(
      h('section', { class: 'card' }, h('h2', { text: 'Инструкторы' }),
        h('p', { class: 'muted', text: 'Нажмите на день, чтобы отметить выходной. Выходные дни не предлагаются гостям на сайте.' }),
        ...data.instructors.map(i => personCard(i, 'instructor', days)),
        addButton('+ добавить инструктора', 'instructor', days)),
      h('section', { class: 'card' }, h('h2', { text: 'Лошади' }),
        h('p', { class: 'muted', text: 'Отмеченные дни — отдых. Лошадь «не работает» не считается совсем.' }),
        ...data.horses.map(x => personCard(x, 'horse', days)),
        addButton('+ добавить лошадь', 'horse', days)),
      h('section', { class: 'card' }, h('h2', { text: 'Ваша ссылка' }),
        h('p', { class: 'muted', text: 'Если телефон потерялся или ссылка попала к чужому, выдайте себе новую — старая перестанет работать.' }),
        linkBox({ role: 'head' })));
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
        msg.textContent = 'Сохранено';
        card.classList.toggle('inactive', !active.checked);
        strip.hidden = false; if (link) link.hidden = false;
      } catch (e) { msg.textContent = errText(e); }
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
    const f = { route: st.routes[0].key, day: today(), people: 1, time: null };
    const routes = h('div', { class: 'pick' }, ...st.routes.map((r, i) => h('label', null,
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
