# Booking and schedule system for Konniy Tour — design

Date: 2026-11-13. Status: agreed in chat; awaiting approval of the document.

## Why

Today every booking goes through the head of the stable, who keeps everything in phone notes. Because of that:
- when the head is unavailable, nobody can see who is busy and when;
- the website cannot honestly show free time;
- instructors learn about their rides by word of mouth.

The goal: one shared schedule that the whole team can see on their phones, and the website takes free time from it automatically.

## Who and how

- **Head of the stable** (one person) is the only one who confirms bookings.
  - Assigns the instructor and the horses to a booking.
  - Manages instructors' days off and horses' rest days.
- **Instructors** (4) see their own rides and the shared schedule.
  - They can record a guest who called them directly, but that booking also goes to the head for confirmation.
- **Guests on the website** send a request.
  - The request is saved to the schedule and, as today, opens WhatsApp with a ready-made message to the head.
- **Tools:** the team uses only a phone and WhatsApp. Nothing gets installed. The schedule page opens from a link and is saved as an icon on the home screen.

## How a request becomes a booking

1. A request is created, by a guest on the site or by an instructor in the app. Its status is **«ждёт»** (waiting). This time slot immediately stops being offered on the site.
2. The head receives a WhatsApp message from the guest (the site already does this). The message adds an «Открыть заявку» (open request) link. Requests created by an instructor are visible to the head in the «Новые заявки» (new requests) block, and a count is shown on the app icon.
3. The head opens the request and assigns an instructor and the number of horses (optionally specific horses), then clicks **«Подтвердить»** (confirm).
4. The **«Сообщить гостю»** (notify guest) button opens WhatsApp with a ready-made confirmation text: date, time, route, instructor name, how to get there.
5. The head can also **reject** a request or **move** it to another time. The «Сообщить гостю» button with the matching text works for both.

## Capacity: when a time slot is free

A route slot (day + start time from the route's schedule) is free for N people when all of the following hold:
- at least one instructor works that day (not on a day off) and has no other booking overlapping the route's duration;
- the number of horses not resting that day and not busy at that time is ≥ N;
- **one instructor leads up to 5 riders**. A larger group is split across several instructors, so the free instructors × 5 must be ≥ N.

A booking can have several instructors assigned; the head chooses them when confirming.

How it works:
- **Overlap** is counted by duration: the short route takes 1 h, the trails route 2 h, the long route the whole day (up to 7 h). The value sits in the route settings.
- **Both «ждёт» and «подтверждено» take capacity.** «Отклонено» does not.

The site shows only free slots. If a group cannot fit, it says «Свободно мест: K» (spots left: K) or hides the slot.

## Screens

The mockups were agreed in the visual companion: `.superpowers/brainstorm/.../flow-and-schedule.html`.

- **Head — «Расписание»:**
  - the day split by hours, with instructors as columns and days off marked;
  - the «Новые заявки» block at the top;
  - below, a horse counter (free / busy / resting);
  - switching between days.
- **Head — «Заявка»:** the guest's details, choosing an instructor and horses, the «Подтвердить» / «Отклонить» / «Перенести» / «Сообщить гостю» buttons.
- **Head — «Команда и лошади»:**
  - a list of instructors (name, phone) and horses (name);
  - days off and rest days;
  - issuing and revoking personal links.
- **Instructor — «Мои выезды»:**
  - their own rides by day and the shared schedule (read-only);
  - a **«Записать гостя»** (record a guest) button: the form matches the site's form, and the result is a «ждёт» request.
- **Website** (all variants: 3D, «Масти», «Клуб», «Афиша»):
  - the existing booking form;
  - the calendar and times take free slots from the database;
  - on submit, the request is saved first (status «ждёт»), then WhatsApp opens with the text plus the request link.
  - If the database is unreachable, the form works the old way: WhatsApp only, with the slots from `js/booking.js`.

## How it gets built (implementer's call, agreed in chat)

- **Data and auth:** a **new** Supabase project (free tier). The user creates it on supabase.com and grants access. The old connected Supabase project belongs to a different site and is about to be shut down, so it must not be used.
  - Postgres plus Row Level Security.
  - The site and the team pages stay on GitHub Pages: a static page, data straight from Supabase.
  - When the domain appears, the site moves to it and the database stays.
- **Access without passwords.** Each team member has a personal link with a long random key.
  - The key is checked by database functions (RPC, `security definer`). They return and change only what that role is allowed to.
  - Direct table access for the anonymous key is closed.
  - Revoking a link replaces the key, and the old one stops working.
- **The site, without login,** calls only two functions:
  - `free_slots(route, from, to, people)` returns free slots and does not leak guests' details;
  - `create_request(...)` creates a «ждёт» request.

  Protection against spam:
  - limits on field lengths;
  - a limit on requests per phone number per day;
  - a hidden honeypot field.
- **Notifications** are only WhatsApp links (wa.me with the text).
  - The guest's message to the head is the notification about a new request.
  - No automated WhatsApp sending (no Business API).
- **The team app** is a separate page, `team.html`, with the key in the URL hash (`team.html#k=…`). The hash is not sent to the server or written to logs.
  - There is a manifest for the home-screen icon.
  - The style follows the 3D-ride site, the main design (DESIGN.md).

## Not doing (non-goals)

- Online payment.
- Automated WhatsApp/SMS sending.
- A native app.
- Online booking without the head's confirmation.
- Detailed horse records (health, workload).
- Reports and analytics.

## What would count as failure

- The website takes two groups for one time when there are not enough instructors or horses.
- A guest's details (name, phone) are visible to anyone without a link.
- An instructor can confirm a booking themselves.
- The head has to do more than today: confirming should take two or three taps.

## Implementer's calls (marked for checking)

- A «ждёт» request holds its slot until the head acts on it; there is no automatic expiry.
- In the shared schedule, instructors see guests' names and group sizes. They see phone numbers only for their own rides.
- If the database is unavailable, the website falls back to the old WhatsApp-only behaviour.

## Left to the implementer

- The data schema (tables for instructors, horses, routes, requests and bookings, days off), the function names, the page markup and the text of WhatsApp messages. Keep it in Russian, in the voice of the site.
- How to store keys (store a hash in the database, not the key itself).
- The time zone: Europe/Moscow (Makhachkala, UTC+3). Store dates as `date`, times as `time`.
