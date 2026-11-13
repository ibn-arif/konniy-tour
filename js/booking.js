// Онлайн-запись: маршрут, день в календаре, время, число людей. Заявка уходит в WhatsApp готовым сообщением.
// Расписание задаётся здесь — поменяйте под настоящее.
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
    const cells = WD.map(w => Object.assign(document.createElement('span'), { className: 'dow', textContent: w, ariaHidden: 'true' }));
    const lead = (m.getDay() + 6) % 7;
    for (let i = 0; i < lead; i++) cells.push(document.createElement('span'));
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    for (let n = 1; n <= days; n++) {
      const d = new Date(m.getFullYear(), m.getMonth(), n);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'day'; b.textContent = n;
      b.setAttribute('aria-label', `${n} ${MONTHS_GEN[d.getMonth()]}, ${WD_FULL[d.getDay()]}`);
      b.disabled = !isOpen(d) || !CONFIG.slots[route().value].some(s => slotOpen(d, s));
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
    const list = CONFIG.slots[route().value];
    box.replaceChildren(...list.map(s => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'slot'; b.textContent = s;
      b.disabled = !slotOpen(state.date, s);
      b.setAttribute('aria-pressed', String(state.time === s));
      b.addEventListener('click', () => { state.time = s; renderSlots(); summary(); });
      return b;
    }));
    hint.textContent = `Прогулка длится ${route().dataset.dur}. Точное время подтвердим в ответе.`;
  }

  function people(n) {
    state.people = Math.min(CONFIG.maxPeople, Math.max(1, n));
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
    if (state.date && !CONFIG.slots[route().value].some(s => slotOpen(state.date, s))) state.date = null;
    state.time = null; renderCal(); renderSlots(); summary();
  });
  $('#cal-prev').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCal(); });
  $('#cal-next').addEventListener('click', () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCal(); });
  $('#ppl-minus').addEventListener('click', () => people(state.people - 1));
  $('#ppl-plus').addEventListener('click', () => people(state.people + 1));

  // Кнопки «Записаться на этот маршрут» сразу выбирают маршрут в форме
  for (const a of document.querySelectorAll('[data-pick]')) a.addEventListener('click', () => {
    const r = form.querySelector(`input[name=route][value="${a.dataset.pick}"]`);
    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const err = $('#form-error');
    const name = form.elements.name.value.trim();
    const phone = form.elements.phone.value.replace(/\D/g, '');
    const problem = !state.date ? 'Выберите день прогулки.' : !state.time ? 'Выберите время выезда.'
      : !name ? 'Напишите, как к вам обращаться.' : phone.length < 10 ? 'Проверьте номер телефона: в нём должно быть не меньше 10 цифр.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true;
    const text = [
      'Здравствуйте! Хочу записаться на конную прогулку.',
      `Маршрут: ${route().dataset.name}`,
      `Когда: ${when()}`,
      `Сколько нас: ${state.people}`,
      `Опыт: ${form.elements.exp.value}`,
      `Имя: ${name}`,
      `Телефон: ${form.elements.phone.value.trim()}`,
    ].join('\n');
    window.open(`https://wa.me/${CONFIG.phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  renderCal(); renderSlots(); people(1);
}
