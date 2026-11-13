# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Two audiences in equal measure:
- **Tourists in Makhachkala** — in the city for a few days, mostly first time in the saddle, want views of the mountains/sea and photos, decide fast from a phone.
- **Local residents** — weekends, gifts, repeat rides, the season pass (абонемент).
Both mostly arrive from Instagram on a phone.

## Product Purpose
Site for a horse-riding stable above Makhachkala (Dagestan). The job: turn "хочу покататься на лошади" into a booked ride — pick a route, day and time, send a ready request to WhatsApp. Success = WhatsApp requests and calls.

## Positioning
Real rides from the stable up into the hills above the city, 1 to 7 hours, with an instructor beside you the whole way; beginner-friendly short climbs to a viewpoint over Makhachkala and long day rides for confident riders. The 3D model of the actual trail (marshrut.html) shows the real route on real terrain.

## Operating Context
Booking is via WhatsApp (+7 964 001-44-58, wa.me/79640014458) with a prefilled message; no server. Instagram @konniy.tour.dagestan (~20k followers) is the main channel; live photos of people and horses outperform scenery.

## Capabilities and Constraints
- Static HTML/CSS/JS, no build step. Booking widget in js/booking.js (route → day → time → people/experience/name/phone → WhatsApp).
- 3D route page marshrut.html (three.js r128) with a video fallback; must stay linked.
- Routes: «На смотровую» 3,5 км 45–60 мин (first time); «По живописным тропам» 7 км 1,5–2 ч (beginners); «Дальний маршрут в горы» до 7 ч (confident riders).
- Season pass: pay 10 000 ₽, ride for 15 000 ₽.
- Undecided / unknown: prices per route, address, opening hours, age/weight limits, helmets, group size. Keep visible placeholders; never invent.

## Brand Commitments
Name on site: «Konniy Tour», descriptor «Конные прогулки, Махачкала». Instagram identity: dark green with gold, horse logo (evidence, not binding for the web look). Russian copy, plain and warm, no English labels.

## Evidence on Hand
- Instagram photos and reels may be used (owners' permission per user); not yet downloaded — photo slots until files are placed in the project.
- No real testimonials collected yet — placeholders, never fabricated.
- media/marshrut.mp4 + poster: rendered loop of the real trail.

## Product Principles
1. Every screen leads to booking in WhatsApp in one tap.
2. Remove first-timer fear: instructor, no experience needed, what to wear, rain policy.
3. Real horses, real people, real trail — never AI-looking imagery.
4. Phone first: most visitors come from Instagram on mobile.
