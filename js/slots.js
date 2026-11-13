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

  const api = { byDay, waRequestText, waConfirmText, waRejectText, waMoveText, waLink };
  root.KTSlots = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
