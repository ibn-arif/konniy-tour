import test from 'node:test';
import assert from 'node:assert/strict';
import S from '../js/slots.js';

test('byDay groups by day, sorts times and drops seconds', () => {
  const m = S.byDay([
    { day: '2026-12-02', start_time: '10:30:00', spots: 3 },
    { day: '2026-12-01', start_time: '10:30:00', spots: 10 },
    { day: '2026-12-01', start_time: '09:00:00', spots: 10 },
  ]);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get('2026-12-01').map(s => s.time), ['09:00', '10:30']);
  assert.deepEqual(m.get('2026-12-02'), [{ time: '10:30', spots: 3 }]);
});

const req = { routeName: 'На смотровую', when: '1 декабря, вторник, в 10:30', people: 2, exp: 'Ни разу не ездил(а)', name: 'Аня', phone: '+7 999 000-00-00' };

test('waRequestText keeps the old lines and adds the request link', () => {
  const t = S.waRequestText({ ...req, link: 'https://ibn-arif.github.io/konniy-tour/team.html#r=abc' });
  assert.match(t, /^Здравствуйте! Хочу записаться на конную прогулку\./);
  assert.match(t, /Маршрут: На смотровую/);
  assert.match(t, /Сколько нас: 2/);
  assert.match(t, /Заявка: https:\/\//);
});

test('waRequestText without a link has no request line', () => {
  assert.doesNotMatch(S.waRequestText(req), /Заявка:/);
});

test('waConfirmText names the guest, instructors and date', () => {
  const t = S.waConfirmText({ name: 'Аня', routeName: 'На смотровую', when: '1 декабря, в 10:30', instructors: ['Магомед', 'Али'], people: 2 });
  assert.match(t, /Аня/);
  assert.match(t, /Магомед, Али/);
  assert.match(t, /1 декабря, в 10:30/);
  assert.match(t, /вас будет 2/);
});

test('waRejectText and waMoveText mention the date', () => {
  assert.match(S.waRejectText({ name: 'Аня', when: '1 декабря' }), /1 декабря/);
  assert.match(S.waMoveText({ name: 'Аня', when: '2 декабря, в 12:00' }), /2 декабря, в 12:00/);
});

test('waLink builds a wa.me link with encoded text', () => {
  assert.equal(S.waLink('79990000000', 'а б'), 'https://wa.me/79990000000?text=%D0%B0%20%D0%B1');
});
