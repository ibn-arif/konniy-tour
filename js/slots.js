// Свободное время по дням и тексты сообщений в WhatsApp.
// В браузере — window.KTSlots, в Node — module.exports (для тестов).
(function (root) {
  const hhmm = t => String(t).slice(0, 5);

  function byDay(rows) {
    const m = new Map();
    for (const r of rows || []) {
      if (!m.has(r.day)) m.set(r.day, []);
      m.get(r.day).push({ time: hhmm(r.start_time), spots: r.spots });
    }
    for (const list of m.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return m;
  }

  function waRequestText({ routeName, when, people, exp, name, phone, link }) {
    const lines = [
      'Здравствуйте! Хочу записаться на конную прогулку.',
      `Маршрут: ${routeName}`,
      `Когда: ${when}`,
      `Сколько нас: ${people}`,
      `Опыт: ${exp}`,
      `Имя: ${name}`,
      `Телефон: ${phone}`,
    ];
    if (link) lines.push(`Заявка: ${link}`);
    return lines.join('\n');
  }

  const waConfirmText = ({ name, routeName, when, instructors, people }) =>
    `Здравствуйте, ${name}! Ждём вас ${when} на прогулку «${routeName}», вас будет ${people}. ` +
    `Инструктор: ${(instructors || []).join(', ')}. Как добраться: <адрес — уточним>.`;

  const waRejectText = ({ name, when }) =>
    `Здравствуйте, ${name}! К сожалению, ${when} мы не сможем вас принять: всё занято. ` +
    'Напишите, какое время подойдёт ещё, — подберём.';

  const waMoveText = ({ name, when }) =>
    `Здравствуйте, ${name}! Предлагаем перенести прогулку на ${when}. Подходит? Ответьте, пожалуйста, на это сообщение.`;

  const waLink = (digits, text) => `https://wa.me/${String(digits).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

  // Телефон всегда начинается с +7: пользователь вводит только 10 цифр после кода.
  function phoneRest(v) {
    const s = String(v || '').trim();
    const d = s.replace(/\D/g, '');
    const rest = s.startsWith('+7') || (d.length >= 11 && /^[78]/.test(d)) ? d.slice(1) : d;
    return rest.slice(0, 10);
  }
  function formatPhone(v) {
    const r = phoneRest(v);
    return '+7 ' + r.slice(0, 3) + (r.length > 3 ? ' ' + r.slice(3, 6) : '') +
      (r.length > 6 ? '-' + r.slice(6, 8) : '') + (r.length > 8 ? '-' + r.slice(8, 10) : '');
  }
  const phoneDigits = v => '7' + phoneRest(v);

  // Поле ввода с неудаляемым «+7 »: формат на лету, курсор остаётся у той же цифры.
  function phoneMask(input) {
    const PRE = 3;
    if (input.value) input.value = formatPhone(input.value);
    input.addEventListener('focus', () => {
      if (!input.value) input.value = '+7 ';
      requestAnimationFrame(() => { if (input.selectionStart < PRE) input.setSelectionRange(input.value.length, input.value.length); });
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && input.selectionStart <= PRE && input.selectionEnd <= PRE) e.preventDefault();
    });
    input.addEventListener('input', () => {
      const v = input.value;
      const caret = input.selectionStart == null ? v.length : input.selectionStart;
      let n = v.slice(0, caret).replace(/\D/g, '').length - (v.startsWith('+7') ? 1 : 0);
      input.value = formatPhone(v);
      let pos = PRE;
      for (; pos < input.value.length && n > 0; pos++) if (/\d/.test(input.value[pos])) n--;
      if (document.activeElement === input) input.setSelectionRange(pos, pos);
    });
    input.addEventListener('blur', () => { if (phoneRest(input.value) === '') input.value = ''; });
  }

  const api = { byDay, waRequestText, waConfirmText, waRejectText, waMoveText, waLink, formatPhone, phoneDigits, phoneMask };
  root.KTSlots = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
