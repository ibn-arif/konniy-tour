#!/usr/bin/env python3
"""Собирает три варианта сайта с фото из Instagram: v2-masti.html, v2-club.html, v2-afisha.html.
Общие блоки (маршруты, вопросы, форма записи) описаны здесь один раз; каждый вариант раскладывает их по-своему.
Запуск: python3 scripts/build_v2.py (из корня проекта)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHONE, PHONE_H = '79640014458', '+7 964 001-44-58'
IG = 'https://www.instagram.com/konniy.tour.dagestan/'

ROUTES = [
    dict(key='short', name='На смотровую', who='Для первого раза', km='3,5 км', time='45–60 мин', photo='insta-viewpoint-valley',
         alt='Гостья на скале показывает на долину и город внизу',
         text='Короткий подъём к видовой площадке над городом. Шагом, без спешки: хватит, чтобы привыкнуть к лошади и сделать фото.'),
    dict(key='trails', name='По живописным тропам', who='Для начинающих', km='7 км', time='1,5–2 часа', photo='insta-forest-trail',
         alt='Всадница на белой лошади едет по лесной тропе, вид из седла',
         text='Неспешная прогулка по лесу и склонам с видами. Для тех, кто хочет побыть в седле подольше, но без галопа.'),
    dict(key='long', name='Дальний маршрут в горы', who='Для уверенных всадников', km=None, time='до 7 часов', photo='insta-gallop',
         alt='Всадник галопом на вороном коне вдоль леса',
         text='Целый день в седле: рысь и галоп там, где позволяет тропа, привал и панорамы, до которых не доехать на машине.'),
]

SYMBOLS = '''<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="wa" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z"/></symbol>
  <symbol id="horse" viewBox="0 0 40 40"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M12 34c1-6 3-10 7-12-3 0-6-1-7-4l9-8c4-3 9-2 11 2 1 2 0 5-2 6l-2 1c1 3 0 7-3 9M24 9l1-4M20 11l-1-4M28 13h.01"/></symbol>
</svg>'''

def img(name, alt, cls='', pos='50% 50%', eager=False, sizes='(max-width: 700px) 100vw, 50vw'):
    load = 'eager" fetchpriority="high' if eager else 'lazy'
    return (f'<figure class="ph {cls}"><img src="media/insta/{name}.webp" alt="{alt}" loading="{load}" decoding="async" '
            f'style="object-position:{pos}" sizes="{sizes}"></figure>')

def km(r):
    return r['km'] if r['km'] else '<span class="todo">… км</span>'

FAQ = '''<div class="faq">
  <details open><summary>Я ни разу не сидел на лошади. Мне можно?</summary>
    <p>Да. Для первого раза есть спокойные маршруты шагом. Перед выездом инструктор покажет, как сидеть и управлять лошадью, и будет рядом всю дорогу.</p></details>
  <details><summary>Во что одеться?</summary>
    <p>Удобные штаны, закрытая обувь на небольшом каблуке или кроссовки, ветровка: в горах прохладнее, чем в городе. Длинная юбка тоже подойдёт. <span class="todo">Шлемы выдаём?</span></p></details>
  <details><summary>Есть ли ограничения по возрасту и весу?</summary>
    <p>Дети — с <span class="todo">… лет</span>, вес всадника — до <span class="todo">… кг</span>. Если сомневаетесь, напишите нам, подскажем.</p></details>
  <details><summary>Можно приехать компанией или с детьми?</summary>
    <p>Да, собираем группы. <span class="todo">Сколько человек за раз?</span> Детей ведёт инструктор в поводу.</p></details>
  <details><summary>А если пойдёт дождь?</summary>
    <p>Предупредим заранее и перенесём прогулку на другой день.</p></details>
</div>'''

def book_form(sum_title='Ваша запись'):
    picks = '\n'.join(
        f'<label><input type="radio" name="route" value="{r["key"]}" data-name="{r["name"]}" data-dur="{r["time"]}"{" checked" if i == 0 else ""}>'
        f'<b>{["На смотровую", "По тропам", "Дальний"][i]}</b><small>{(r["km"] + ", ") if r["km"] else ""}{r["time"]}{", с опытом" if r["key"] == "long" else ""}</small></label>'
        for i, r in enumerate(ROUTES))
    return f'''<form class="book-grid" id="book-form" novalidate>
  <div class="book-steps">
    <fieldset><legend>Маршрут</legend><div class="pick">{picks}</div></fieldset>
    <fieldset><legend>День</legend>
      <div class="cal">
        <div class="cal-top"><strong id="cal-title" aria-live="polite"></strong>
          <div class="cal-nav">
            <button type="button" class="icon-btn" id="cal-prev" aria-label="Предыдущий месяц"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg></button>
            <button type="button" class="icon-btn" id="cal-next" aria-label="Следующий месяц"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></button>
          </div></div>
        <div class="cal-grid" id="cal-grid"></div>
      </div></fieldset>
    <fieldset><legend>Время выезда</legend><div class="slots" id="slots"></div><p class="hint" id="slots-hint">Сначала выберите день.</p></fieldset>
    <fieldset><legend>О вас</legend>
      <div class="fields">
        <div class="field"><span>Сколько человек</span>
          <div class="stepper">
            <button type="button" class="icon-btn" id="ppl-minus" aria-label="Меньше человек"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></button>
            <output id="ppl" aria-live="polite">1</output>
            <button type="button" class="icon-btn" id="ppl-plus" aria-label="Больше человек"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10"/></svg></button>
          </div></div>
        <label class="field"><span>Опыт верховой езды</span><select name="exp"><option>Ни разу не ездил(а)</option><option>Пару раз катался(ась)</option><option>Уверенно езжу</option></select></label>
        <label class="field"><span>Имя</span><input name="name" autocomplete="name" placeholder="Как к вам обращаться"></label>
        <label class="field"><span>Телефон</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+7 9__ ___-__-__"></label>
        <label class="hp" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">Сайт<input name="website" tabindex="-1" autocomplete="off"></label>
      </div></fieldset>
  </div>
  <aside class="summary" aria-labelledby="sum-title">
    <h3 id="sum-title">{sum_title}</h3>
    <dl>
      <div><dt>Маршрут</dt><dd id="s-route"></dd></div>
      <div><dt>Когда</dt><dd id="s-when" class="empty">Выберите день и время</dd></div>
      <div><dt>Сколько вас</dt><dd id="s-ppl"></dd></div>
    </dl>
    <p class="form-error" id="form-error" role="alert" hidden></p>
    <button class="btn btn-main" type="submit"><svg aria-hidden="true"><use href="#wa"/></svg>Отправить заявку в WhatsApp</button>
    <p class="note">Откроется WhatsApp с готовым сообщением, останется нажать «Отправить». Не пользуетесь WhatsApp? Позвоните: <a href="tel:+{PHONE}">{PHONE_H}</a>.</p>
  </aside>
</form>'''

WHERE = f'''<dl class="where-list">
  <div><dt>Адрес конюшни</dt><dd class="todo">улица, ориентир</dd></div>
  <div><dt>От центра Махачкалы</dt><dd><span class="todo">… минут</span> на машине или такси</dd></div>
  <div><dt>Часы работы</dt><dd class="todo">каждый день, с … до …</dd></div>
  <div><dt>Телефон и WhatsApp</dt><dd><a href="tel:+{PHONE}">{PHONE_H}</a></dd></div>
</dl>'''

PASS_ITEMS = '''<li>Любые маршруты на общую сумму 15&nbsp;000&nbsp;₽.</li>
  <li>Можно ездить одному или делить с друзьями (<span class="todo">уточнить условия</span>).</li>
  <li>Хороший подарок тому, кто давно хотел на лошадь.</li>'''

SCRIPTS = f'''<script>
  // WhatsApp с готовым текстом: написать первым проще
  for (const a of document.querySelectorAll('.js-wa')) {{
    const t = a.dataset.route === 'Абонемент' ? 'Здравствуйте! Хочу купить абонемент на конные прогулки.'
      : 'Здравствуйте! Хочу записаться на конную прогулку. Нас будет …, опыт верховой езды: …';
    a.href = 'https://wa.me/{PHONE}?text=' + encodeURIComponent(t);
  }}
</script>
<script src="js/config.js"></script>
<script src="js/api.js"></script>
<script src="js/slots.js"></script>
<script src="js/booking.js"></script>'''

def variants_nav(cur):
    items = [('index.html', '3D-прогулка'), ('v2-masti.html', 'Масти'), ('v2-club.html', 'Клуб'), ('v2-afisha.html', 'Афиша')]
    links = ''.join(f'<a href="{h}"{" aria-current=page" if h == cur else ""}>{t}</a>' for h, t in items)
    return f'<nav class="variants" aria-label="Варианты дизайна">{links}</nav>'

def page(file, title, fonts, css, theme, body):
    return f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="Конные прогулки в горах над Махачкалой: от часа до семи часов в седле, инструктор рядом, опыт не нужен. Запись онлайн в WhatsApp.">
<meta name="theme-color" content="{theme}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?{fonts}&display=swap" rel="stylesheet">
<link rel="stylesheet" href="css/v2-base.css">
<link rel="stylesheet" href="css/{css}">
<link rel="preload" as="image" href="media/insta/insta-white-horse-sea.webp">
</head>
<body>
{SYMBOLS}
{body}
{variants_nav(file)}
{SCRIPTS}
</body>
</html>
'''

NAV = '''<nav class="nav" aria-label="Разделы">
      <a href="#routes">Маршруты</a><a href="#first">Впервые в седле</a><a href="#pass">Абонемент</a><a href="#where">Как добраться</a>
    </nav>'''

# ---------------------------------------------------------------- Масти
def masti():
    routes = '\n'.join(f'''<article class="route{' flip' if i % 2 else ''}">
      {img(r['photo'], r['alt'], 'arch', '50% 45%' if r['key'] != 'long' else '35% 45%')}
      <div class="route-copy">
        <p class="who">{r['who']}</p>
        <h3>{r['name']}</h3>
        <p>{r['text']}</p>
        <dl class="facts"><div><dt>Путь</dt><dd>{km(r)}</dd></div><div><dt>Время</dt><dd>{r['time']}</dd></div><div><dt>Цена</dt><dd class="todo">… ₽</dd></div></dl>
        <a class="btn btn-line" data-pick="{r['key']}" href="#book">Записаться на этот маршрут</a>
      </div>
    </article>''' for i, r in enumerate(ROUTES))
    body = f'''<header class="top wrap">
  <a class="brand" href="#"><svg aria-hidden="true"><use href="#horse"/></svg><span>Konniy Tour</span></a>
  {NAV}
  <a class="btn btn-main btn-sm" href="#book">Записаться</a>
</header>
<main>
  <section class="hero coat coat-black" aria-labelledby="h1">
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <h1 id="h1">Конные прогулки над&nbsp;Махачкалой</h1>
        <p class="lead">От часа до семи часов в седле, от спокойного шага до галопа. Инструктор рядом весь маршрут, опыт не нужен.</p>
        <div class="row"><a class="btn btn-main" href="#book">Выбрать день и время</a><a class="btn btn-line js-wa" href="https://wa.me/{PHONE}"><svg aria-hidden="true"><use href="#wa"/></svg>Написать</a></div>
      </div>
      <div class="hero-photo">
        {img('insta-white-horse-sea', 'Всадник на белом коне на смотровой над Махачкалой и Каспийским морем', 'arch', '50% 62%', True)}
        <p class="swatch"><i style="background:#EDE6DA"></i>Белая масть · смотровая над Каспием</p>
      </div>
    </div>
    <p class="coat-name wrap"><i></i>Вороная</p>
  </section>

  <section class="coat coat-bay" id="routes" aria-labelledby="routes-title">
    <div class="wrap">
      <h2 id="routes-title">Три маршрута — по опыту и по времени</h2>
      <div class="routes">{routes}</div>
    </div>
    <p class="coat-name wrap"><i></i>Гнедая</p>
  </section>

  <section class="coat coat-dun" id="first" aria-labelledby="first-title">
    <div class="wrap split">
      <div class="first-photo">{img('insta-instructor', 'Инструктор рядом с рыжим конём в уздечке', 'stitched', '50% 40%')}
        <p class="cap">Инструктор подбирает лошадь под вас и едет рядом всю дорогу.</p></div>
      <div>
        <h2 id="first-title">Впервые в седле</h2>
        <ol class="steps">
          <li><b>Выбираете время</b> онлайн или пишете в WhatsApp: сколько вас и ездили ли раньше.</li>
          <li><b>Мы подтверждаем</b> или предлагаем соседнее время, если подведёт погода.</li>
          <li><b>На конюшне</b> инструктор подбирает лошадь, помогает сесть и показывает, как управлять.</li>
        </ol>
        {FAQ}
      </div>
    </div>
    <p class="coat-name wrap"><i></i>Буланая</p>
  </section>

  <section class="coat coat-chestnut" aria-labelledby="life-title">
    <div class="wrap">
      <div class="life-head"><h2 id="life-title">Жизнь конюшни</h2><a class="more" href="{IG}">Больше фото и видео в Instagram</a></div>
      <div class="life">
        {img('insta-gallop', 'Вороной конь на галопе у кромки леса', 'stitched tall', '40% 50%')}
        {img('insta-stable-door', 'Серый конь выглядывает из дверей денника, гостья гладит его по морде', 'stitched', '50% 35%')}
        {img('insta-river-splash', 'Всадник галопом пересекает реку, брызги на закате', 'stitched', '45% 55%')}
      </div>
      <div class="quotes">
        <blockquote><p class="todo">Отзыв гостя из Instagram</p><cite>Имя, когда ездили</cite></blockquote>
        <blockquote><p class="todo">Отзыв гостя из Instagram</p><cite>Имя, когда ездили</cite></blockquote>
      </div>
    </div>
    <p class="coat-name wrap"><i></i>Рыжая</p>
  </section>

  <section class="coat coat-grey" id="pass" aria-labelledby="pass-title">
    <div class="wrap pass">
      <h2 id="pass-title"><span>Платите 10&nbsp;000&nbsp;₽</span><span>катаетесь на&nbsp;15&nbsp;000&nbsp;₽</span></h2>
      <div><p class="pass-name">Абонемент на прогулки</p><ul>{PASS_ITEMS}</ul>
        <a class="btn btn-ink js-wa" data-route="Абонемент" href="https://wa.me/{PHONE}"><svg aria-hidden="true"><use href="#wa"/></svg>Купить абонемент</a></div>
    </div>
    <p class="coat-name wrap"><i></i>Серая</p>
  </section>

  <section class="coat coat-cream" id="book" aria-labelledby="book-title">
    <div class="wrap">
      <h2 id="book-title">Запись на прогулку</h2>
      <p class="sub">Заявка уйдёт нам в WhatsApp, мы подтвердим её в течение <span class="todo">… часа</span>.</p>
      {book_form()}
    </div>
    <p class="coat-name wrap"><i></i>Соловая</p>
  </section>

  <section class="coat coat-black" id="where" aria-labelledby="where-title">
    <div class="wrap split where">
      <div><h2 id="where-title">Как добраться</h2>{WHERE}</div>
      <div class="map-slot">Здесь будет карта: Яндекс Карты или 2ГИС с точкой конюшни</div>
    </div>
  </section>
</main>
<footer class="foot wrap"><span>Konniy Tour, конные прогулки, Махачкала, Дагестан</span><a href="{IG}">Instagram @konniy.tour.dagestan</a></footer>'''
    return page('v2-masti.html', 'Конные прогулки над Махачкалой — Konniy Tour', 'family=Yeseva+One&family=Manrope:wght@400;500;600;700',
                'v2-masti.css', '#1A1512', body)

# ---------------------------------------------------------------- Конный клуб
def club():
    routes = '\n'.join(f'''<article class="route">
      <div class="frame">{img(r['photo'], r['alt'], '', '50% 45%' if r['key'] != 'long' else '35% 45%', sizes='(max-width: 700px) 100vw, 33vw')}</div>
      <p class="who">{r['who']}</p>
      <h3>{r['name']}</h3>
      <p class="desc">{r['text']}</p>
      <p class="meta">{km(r)} · {r['time']} · <span class="todo">… ₽</span></p>
      <a class="btn btn-line" data-pick="{r['key']}" href="#book">Записаться</a>
    </article>''' for r in ROUTES)
    crest = '<span class="crest" aria-hidden="true"><svg><use href="#horse"/></svg></span>'
    body = f'''<header class="top">
  <div class="wrap top-in">
    {NAV.replace('class="nav"', 'class="nav nav-l"').split('<a href="#pass">')[0]}</nav>
    <a class="brand" href="#">{crest}<span>Konniy Tour<small>конные прогулки · Махачкала</small></span></a>
    <nav class="nav nav-r" aria-label="Ещё разделы"><a href="#pass">Абонемент</a><a href="#where">Как добраться</a></nav>
  </div>
</header>
<main>
  <section class="hero" aria-labelledby="h1">
    <div class="wrap hero-grid">
      <div class="hero-l">
        <h1 id="h1">Конные прогулки в&nbsp;горах над&nbsp;Махачкалой</h1>
        <p class="lead">От часа до семи часов в седле. Спокойные маршруты для тех, кто впервые садится на лошадь, и долгие для опытных всадников.</p>
      </div>
      <div class="frame frame-hero">{img('insta-white-horse-sea', 'Всадник на белом коне на смотровой над Махачкалой и Каспийским морем', '', '50% 62%', True)}</div>
      <div class="hero-r">
        <ul class="marks"><li>Опыт не нужен</li><li>Инструктор рядом весь маршрут</li><li>Прогулки каждый день, <span class="todo">часы работы</span></li></ul>
        <a class="btn btn-main" href="#book">Выбрать дату и время</a>
        <a class="btn btn-line js-wa" href="https://wa.me/{PHONE}"><svg aria-hidden="true"><use href="#wa"/></svg>Написать в WhatsApp</a>
      </div>
    </div>
  </section>

  <section class="sec" id="routes" aria-labelledby="routes-title">
    <div class="wrap">
      <div class="sec-head"><span class="rule" aria-hidden="true"></span><h2 id="routes-title">Маршруты</h2><span class="rule" aria-hidden="true"></span></div>
      <p class="sec-lead">Подберём маршрут под ваш опыт.</p>
      <div class="routes">{routes}</div>
    </div>
  </section>

  <section class="sec sec-alt" id="first" aria-labelledby="first-title">
    <div class="wrap first">
      <div>
        <div class="sec-head left"><h2 id="first-title">Впервые в седле</h2></div>
        <p class="sec-lead left">Ответы на то, что спрашивают перед первой прогулкой.</p>
        {FAQ}
      </div>
      <div class="frame">{img('insta-instructor', 'Инструктор рядом с рыжим конём в уздечке', '', '50% 40%')}</div>
    </div>
  </section>

  <section class="sec" aria-labelledby="life-title">
    <div class="wrap">
      <div class="sec-head"><span class="rule" aria-hidden="true"></span><h2 id="life-title">Жизнь конюшни</h2><span class="rule" aria-hidden="true"></span></div>
      <div class="life">
        <div class="frame">{img('insta-stable-door', 'Серый конь выглядывает из дверей денника, гостья гладит его по морде', '', '50% 35%')}</div>
        <div class="frame">{img('insta-river-splash', 'Всадник галопом пересекает реку, брызги на закате', '', '45% 55%')}</div>
        <div class="frame">{img('insta-gallop', 'Вороной конь на галопе у кромки леса', '', '40% 50%')}</div>
      </div>
      <div class="quotes">
        <blockquote><p class="todo">Отзыв гостя из Instagram</p><cite>Имя, когда ездили</cite></blockquote>
        <blockquote><p class="todo">Отзыв гостя из Instagram</p><cite>Имя, когда ездили</cite></blockquote>
      </div>
      <p class="center"><a href="{IG}">Больше фото и видео в Instagram</a></p>
    </div>
  </section>

  <section class="sec sec-alt" id="pass" aria-labelledby="pass-title">
    <div class="wrap">
      <div class="card-pass">
        {crest}
        <h2 id="pass-title">Абонемент на прогулки</h2>
        <p class="pass-price">Платите <b>10&nbsp;000&nbsp;₽</b>, катаетесь на&nbsp;<b>15&nbsp;000&nbsp;₽</b></p>
        <ul>{PASS_ITEMS}</ul>
        <a class="btn btn-main js-wa" data-route="Абонемент" href="https://wa.me/{PHONE}"><svg aria-hidden="true"><use href="#wa"/></svg>Купить абонемент</a>
      </div>
    </div>
  </section>

  <section class="sec book" id="book" aria-labelledby="book-title">
    <div class="wrap">
      <div class="sec-head"><span class="rule" aria-hidden="true"></span><h2 id="book-title">Онлайн-запись</h2><span class="rule" aria-hidden="true"></span></div>
      <p class="sec-lead">Заявка уйдёт нам в WhatsApp, мы подтвердим её в течение <span class="todo">… часа</span>.</p>
      <div class="book-panel">{book_form()}</div>
    </div>
  </section>

  <section class="sec" id="where" aria-labelledby="where-title">
    <div class="wrap first">
      <div><div class="sec-head left"><h2 id="where-title">Как добраться</h2></div>{WHERE}</div>
      <div class="map-slot">Здесь будет карта: Яндекс Карты или 2ГИС с точкой конюшни</div>
    </div>
  </section>
</main>
<footer class="foot"><div class="wrap">{crest}<span>Konniy Tour · конные прогулки · Махачкала, Дагестан</span><a href="{IG}">Instagram @konniy.tour.dagestan</a></div></footer>'''
    return page('v2-club.html', 'Конные прогулки над Махачкалой — Konniy Tour', 'family=Old+Standard+TT:ital,wght@0,400;0,700;1,400&family=Arsenal:wght@400;700',
                'v2-club.css', '#14241B', body)

# ---------------------------------------------------------------- Афиша скачек
def afisha():
    colors = ['red', 'yellow', 'blue']
    routes = '\n'.join(f'''<article class="race race-{colors[i]}">
      <p class="race-no"><span>Заезд</span><b>№{i + 1}</b></p>
      {img(r['photo'], r['alt'], 'duo', '50% 45%' if r['key'] != 'long' else '35% 45%', sizes='(max-width: 700px) 100vw, 33vw')}
      <div class="race-body">
        <h3>{r['name']}</h3>
        <p class="who">{r['who']}</p>
        <p>{r['text']}</p>
        <dl class="race-facts"><div><dt>Дистанция</dt><dd>{km(r)}</dd></div><div><dt>В седле</dt><dd>{r['time']}</dd></div><div><dt>Цена</dt><dd class="todo">… ₽</dd></div></dl>
        <a class="btn btn-ink" data-pick="{r['key']}" href="#book">Записаться на заезд</a>
      </div>
    </article>''' for i, r in enumerate(ROUTES))
    body = f'''<header class="top">
  <a class="brand" href="#"><svg aria-hidden="true"><use href="#horse"/></svg>Konniy Tour</a>
  {NAV}
  <a class="btn btn-main btn-sm" href="#book">Записаться</a>
</header>
<main>
  <section class="poster" aria-labelledby="h1">
    <div class="poster-top"><span>Махачкала · Дагестан</span><span>От 1 до 7 часов в седле</span></div>
    <h1 id="h1"><span class="l1">Конные</span><span class="l2">прогулки</span><span class="l3">над Махачкалой</span></h1>
    <div class="poster-photo">{img('insta-white-horse-sea', 'Всадник на белом коне на смотровой над Махачкалой и Каспийским морем', 'duo duo-blue', '50% 60%', True)}</div>
    <div class="poster-side">
      <p class="lead">От часа до семи часов в седле. Инструктор рядом весь маршрут, опыт не нужен.</p>
      <ul class="bill"><li><b>3</b> маршрута</li><li><b>1–7</b> часов в седле</li><li><b>0</b> опыта нужно</li></ul>
      <a class="btn btn-main" href="#book">Выбрать день и время</a>
      <a class="btn btn-ink js-wa" href="https://wa.me/{PHONE}"><svg aria-hidden="true"><use href="#wa"/></svg>Написать в WhatsApp</a>
    </div>
  </section>

  <section class="races" id="routes" aria-labelledby="routes-title">
    <h2 id="routes-title" class="band">Программа заездов</h2>
    <div class="race-grid">{routes}</div>
  </section>

  <section class="first" id="first" aria-labelledby="first-title">
    <div class="first-l">
      <h2 id="first-title">Впервые в седле?</h2>
      {img('insta-instructor', 'Инструктор рядом с рыжим конём в уздечке', 'duo duo-yellow', '50% 40%')}
    </div>
    <div class="first-r">
      <ol class="steps">
        <li><b>Выбираете время</b> онлайн или пишете в WhatsApp: сколько вас и ездили ли раньше.</li>
        <li><b>Мы подтверждаем</b> или предлагаем соседнее время, если подведёт погода.</li>
        <li><b>На конюшне</b> инструктор подбирает лошадь и едет рядом всю дорогу.</li>
      </ol>
      {FAQ}
    </div>
  </section>

  <section class="gallery" aria-labelledby="life-title">
    <h2 id="life-title" class="band band-red">С конюшни</h2>
    <div class="g-grid">
      {img('insta-gallop', 'Вороной конь на галопе у кромки леса', 'g-a duo', '40% 50%')}
      {img('insta-river-splash', 'Всадник галопом пересекает реку, брызги на закате', 'g-b duo', '45% 55%')}
      {img('insta-stable-door', 'Серый конь выглядывает из дверей денника, гостья гладит его по морде', 'g-c duo', '50% 35%')}
      <div class="g-quotes">
        <blockquote><p class="todo">Отзыв гостя из Instagram</p><cite>Имя, когда ездили</cite></blockquote>
        <blockquote><p class="todo">Отзыв гостя из Instagram</p><cite>Имя, когда ездили</cite></blockquote>
        <a class="more" href="{IG}">Ещё в Instagram</a>
      </div>
    </div>
  </section>

  <section class="ticket-sec" id="pass" aria-labelledby="pass-title">
    <div class="ticket">
      <div class="ticket-l"><h2 id="pass-title">Абонемент</h2><ul>{PASS_ITEMS}</ul></div>
      <div class="ticket-r"><p class="pay"><span>Платите</span><b>10&nbsp;000&nbsp;₽</b></p><p class="get"><span>катаетесь на</span><b>15&nbsp;000&nbsp;₽</b></p>
        <a class="btn btn-ink js-wa" data-route="Абонемент" href="https://wa.me/{PHONE}"><svg aria-hidden="true"><use href="#wa"/></svg>Купить</a></div>
    </div>
  </section>

  <section class="book" id="book" aria-labelledby="book-title">
    <h2 id="book-title" class="band band-blue">Запись на заезд</h2>
    <div class="book-in">
      <p class="sub">Заявка уйдёт нам в WhatsApp, мы подтвердим её в течение <span class="todo">… часа</span>.</p>
      {book_form('Ваш билет')}
    </div>
  </section>

  <section class="where" id="where" aria-labelledby="where-title">
    <div><h2 id="where-title">Как добраться</h2>{WHERE}</div>
    <div class="map-slot">Здесь будет карта: Яндекс Карты или 2ГИС с точкой конюшни</div>
  </section>
</main>
<footer class="foot"><span>Konniy Tour · конные прогулки · Махачкала</span><a href="{IG}">Instagram @konniy.tour.dagestan</a></footer>'''
    return page('v2-afisha.html', 'Конные прогулки над Махачкалой — Konniy Tour', 'family=Oswald:wght@500;700&family=PT+Sans:wght@400;700',
                'v2-afisha.css', '#F7F4EC', body)

for name, fn in [('v2-masti.html', masti), ('v2-club.html', club), ('v2-afisha.html', afisha)]:
    (ROOT / name).write_text(fn(), encoding='utf-8')
    print('written', name)
