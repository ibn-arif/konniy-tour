// Онлайн-запись: маршрут, день в календаре, время, число людей.
// Свободное время берётся из расписания (js/api.js → free_slots), заявка сохраняется (create_request)
// и уходит в WhatsApp готовым сообщением со ссылкой на неё.
// Если база недоступна, форма работает по старому: время из CONFIG, только WhatsApp.
const CONFIG = {
  phone: '79640014458',
  daysAhead: 60,                 // на сколько дней вперёд можно записаться
  closedWeekdays: [],            // выходные дни недели: 0 — вс, 1 — пн … 6 — сб
  closedDates: [],               // отдельные даты без прогулок, '2026-12-31'
  minHoursBefore: 2,             // за сколько часов до выезда закрывается запись
  slots: {                       // время выезда по маршрутам
    short: ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30'],
    trails: ['09:00', '11:30', '14:00'],
    long: ['08:00'],
  },
  maxPeople: 10,
};

const $ = s => document.querySelector(s);
const form = $('#book-form');
if (form) init();

function init() {
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(today); last.setDate(last.getDate() + CONFIG.daysAhead);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const state = { month: new Date(today.getFullYear(), today.getMonth(), 1), date: null, time: null, people: 1 };
  const route = () => form.querySelector('input[name=route]:checked');

  // Свободное время из базы: Map 'YYYY-MM-DD' → [{time, spots}] на текущие маршрут, месяц и число людей.
  // null — ещё грузится. live.on = false — работаем по CONFIG.
  const live = { on: !!(window.KTApi && window.KTSlots && KTApi.configured()), cache: new Map(), avail: null, key: '' };
  async function loadAvail() {
    if (!live.on) return;
    const m = state.month;
    const from = m < today ? today : m;
    const to = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    const key = [route().value, iso(m), state.people].join('|');
    live.key = key;
    if (live.cache.has(key)) { live.avail = live.cache.get(key); return redraw(); }
    live.avail = null; redraw();
    try {
      const rows = await KTApi.rpc('free_slots', { p_route: route().value, p_from: iso(from), p_to: iso(to), p_people: state.people });
      live.cache.set(key, KTSlots.byDay(rows));
      if (live.key === key) { live.avail = live.cache.get(key); redraw(); }
    } catch (e) {
      live.on = false; redraw();     // база не ответила — время из CONFIG
    }
  }
  // Маршруты из базы: новые, добавленные главным, появляются в форме сами.
  // Если база не ответила — остаются три маршрута из разметки страницы.
  async function loadRoutes() {
    if (!live.on) return;
    try {
      const rs = await KTApi.rpc('public_routes', {});
      if (!Array.isArray(rs) || !rs.length) return;
      const pick = route().closest('.pick');
      const was = route().value;
      pick.replaceChildren(...rs.map(r => {
        const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'route', value: r.key });
        input.dataset.name = r.name;
        input.dataset.dur = r.dur_label;
        const label = document.createElement('label');
        label.append(input, Object.assign(document.createElement('b'), { textContent: r.name }));
        if (r.note) label.append(Object.assign(document.createElement('small'), { textContent: r.note }));
        return label;
      }));
      (pick.querySelector(`input[value="${CSS.escape(was)}"]`) || pick.querySelector('input')).checked = true;
      for (const r of rs) CONFIG.slots[r.key] = r.slots;
    } catch (e) { /* остаются маршруты из разметки */ }
  }
  function redraw() {
    if (state.date && dayOpen(state.date) === false) { state.date = null; state.time = null; }
    if (state.date && state.time && !slotList(state.date).some(s => s.time === state.time && s.open)) state.time = null;
    renderCal(); renderSlots(); summary();
  }
  // Время выезда на день: [{time, open, spots}]
  function slotList(d) {
    if (live.on) return live.avail ? (live.avail.get(iso(d)) || []).map(s => ({ ...s, open: true })) : [];
    return CONFIG.slots[route().value].map(t => ({ time: t, open: slotOpen(d, t), spots: null }));
  }
  // true / false, или null пока грузится
  function dayOpen(d) {
    if (live.on) return live.avail ? live.avail.has(iso(d)) : null;
    return isOpen(d) && CONFIG.slots[route().value].some(s => slotOpen(d, s));
  }

  function isOpen(d) {
    return d >= today && d <= last && !CONFIG.closedWeekdays.includes(d.getDay()) && !CONFIG.closedDates.includes(iso(d));
  }
  function slotOpen(d, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const at = new Date(d); at.setHours(h, m);
    return at - Date.now() >= CONFIG.minHoursBefore * 3600e3;
  }

  function renderCal() {
    const m = state.month;
    $('#cal-title').textContent = MONTHS[m.getMonth()][0].toUpperCase() + MONTHS[m.getMonth()].slice(1) + ' ' + m.getFullYear();
    $('#cal-prev').disabled = m <= new Date(today.getFullYear(), today.getMonth(), 1);
    $('#cal-next').disabled = new Date(m.getFullYear(), m.getMonth() + 1, 1) > last;
    const grid = $('#cal-grid');
    grid.setAttribute('aria-busy', String(live.on && !live.avail));
    const cells = WD.map(w => Object.assign(document.createElement('span'), { className: 'dow', textContent: w, ariaHidden: 'true' }));
    const lead = (m.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) cells.push(document.createElement('span'));
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    for (let n = 1; n <= days; n++) {
      const d = new Date(m.getFullYear(), m.getMonth(), n);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'day'; b.textContent = n;
      b.setAttribute('aria-label', `${n} ${MONTHS_GEN[d.getMonth()]}, ${WD_FULL[d.getDay()]}`);
      b.disabled = dayOpen(d) !== true;
      if (+d === +today) b.classList.add('today');
      b.setAttribute('aria-pressed', String(state.date && +d === +state.date));
      b.addEventListener('click', () => { state.date = d; state.time = null; renderCal(); renderSlots(); summary(); });
      cells.push(b);
    }
    grid.replaceChildren(...cells);
  }

  function renderSlots() {
    const box = $('#slots'), hint = $('#slots-hint');
    if (!state.date) { box.replaceChildren(); hint.textContent = 'Сначала выберите день.'; hint.hidden = false; return; }
    const list = slotList(state.date);
    box.replaceChildren(...list.map(s => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'slot'; b.textContent = s.time;
      if (s.spots != null && s.spots < CONFIG.maxPeople) {
        const left = Object.assign(document.createElement('small'), { textContent: `осталось мест: ${s.spots}` });
        b.append(left);
      }
      b.disabled = !s.open;
      b.setAttribute('aria-pressed', String(state.time === s.time));
      b.addEventListener('click', () => { state.time = s.time; renderSlots(); summary(); });
      return b;
    }));
    hint.textContent = list.length ? `Прогулка длится ${route().dataset.dur}. Точное время подтвердим в ответе.`
      : 'На этот день свободного времени не осталось, выберите другой.';
  }

  function people(n) {
    const was = state.people;
    state.people = Math.min(CONFIG.maxPeople, Math.max(1, n));
    if (was !== state.people) loadAvail();
    $('#ppl').textContent = state.people;
    $('#ppl-minus').disabled = state.people === 1;
    $('#ppl-plus').disabled = state.people === CONFIG.maxPeople;
    summary();
  }
  const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many; };
  const when = () => state.date ? `${state.date.getDate()} ${MONTHS_GEN[state.date.getMonth()]}, ${WD_FULL[state.date.getDay()]}${state.time ? ', в ' + state.time : ''}` : '';

  function summary() {
    $('#s-route').textContent = `${route().dataset.name}, ${route().dataset.dur}`;
    const w = $('#s-when');
    w.textContent = when() || 'Выберите день и время';
    w.classList.toggle('empty', !state.date || !state.time);
    $('#s-ppl').textContent = `${state.people} ${plural(state.people, 'человек', 'человека', 'человек')}`;
  }

  form.addEventListener('change', e => {
    if (e.target.name !== 'route') return;
    if (state.date && dayOpen(state.date) === false) state.date = null;
    state.time = null; renderCal(); renderSlots(); summary(); loadAvail();
  });
  $('#cal-prev').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCal(); loadAvail(); });
  $('#cal-next').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCal(); loadAvail(); });
  $('#ppl-minus').addEventListener('click', () => people(state.people - 1));
  $('#ppl-plus').addEventListener('click', () => people(state.people + 1));

  // Кнопки «Записаться на этот маршрут» сразу выбирают маршрут в форме
  for (const a of document.querySelectorAll('[data-pick]')) a.addEventListener('click', () => {
    const r = form.querySelector(`input[name=route][value="${a.dataset.pick}"]`);
    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (form.dataset.busy) return;
    const err = $('#form-error');
    const name = form.elements.name.value.trim();
    const phone = form.elements.phone.value.replace(/\D/g, '');
    const problem = !state.date ? 'Выберите день прогулки.' : !state.time ? 'Выберите время выезда.'
      : !name ? 'Напишите, как к вам обращаться.' : phone.length < 10 ? 'Проверьте номер телефона: в нём должно быть не меньше 10 цифр.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true;
    const msg = link => {
      const fields = { routeName: route().dataset.name, when: when(), people: state.people, exp: form.elements.exp.value, name, phone: form.elements.phone.value.trim(), link };
      const text = window.KTSlots ? KTSlots.waRequestText(fields) : [
        'Здравствуйте! Хочу записаться на конную прогулку.', `Маршрут: ${fields.routeName}`, `Когда: ${fields.when}`,
        `Сколько нас: ${fields.people}`, `Опыт: ${fields.exp}`, `Имя: ${fields.name}`, `Телефон: ${fields.phone}`,
      ].join('\n');
      return `https://wa.me/${CONFIG.phone}?text=${encodeURIComponent(text)}`;
    };
    if (!live.on) { window.open(msg(), '_blank', 'noopener'); return; }

    // Окно открываем сразу, по нажатию: после ожидания ответа браузер на телефоне его заблокирует.
    const win = window.open('', '_blank');
    const go = url => { if (win) { win.opener = null; win.location.href = url; } else location.href = url; };
    const btn = form.querySelector('[type=submit]');
    form.dataset.busy = '1'; btn.disabled = true;
    try {
      const id = await KTApi.rpc('create_request', {
        p_route: route().value, p_day: iso(state.date), p_start: state.time, p_people: state.people,
        p_name: name, p_phone: form.elements.phone.value.trim(), p_experience: form.elements.exp.value,
        p_hp: form.elements.website ? form.elements.website.value : '',
      }, { timeout: 6000 });
      go(msg(new URL('team.html', location.href).href + '#r=' + id));
      live.cache.clear(); state.time = null; loadAvail();
    } catch (x) {
      if (x.code === 'P0001') {          // понятная причина: время заняли, закрыто, проверьте телефон
        if (win) win.close();
        err.textContent = x.message.endsWith('.') ? x.message : x.message + '.';
        err.hidden = false;
        live.cache.clear(); loadAvail();
      } else {
        go(msg());                       // база не ответила — заявка всё равно уйдёт в WhatsApp
      }
    } finally {
      delete form.dataset.busy; btn.disabled = false;
    }
  });

  renderCal(); renderSlots(); people(1);
  loadRoutes().then(() => { summary(); loadAvail(); });
}
