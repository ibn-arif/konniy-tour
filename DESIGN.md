# Design — Konniy Tour

## World
«Прогулка прокруткой». The page is the ride from the stable to the viewpoint above Makhachkala. A cel-shaded 3D landscape is fixed behind the page (`.world`, js/terrain.js with `data-drive="scroll"`). Scrolling moves the horse along the real trail. Content arrives as paper trail signs with ink outlines, each staked to a real point on the trail.

## Tokens (css/ride.css :root)
| Role | Token | Value |
|---|---|---|
| Sky / haze, page ground | `--haze` | #DCE3D8 |
| Sign paper | `--paper` / `--paper-2` | #F2F4EC / #E3E9DA |
| Ink text | `--ink` / `--ink-2` | #1F2A1C / #4A5843 |
| Outline (signs, controls, 3D contour) | `--ink-line` | #3E4A2E |
| Trail and primary action | `--accent` / `--accent-hi` | #E59A2F / #F2AC45 |
| Placeholder for unknown facts | `.todo` | amber wash + dashed underline |
| Terrain | `--toon-*`, `--sea`, `--sky-top` | read by terrain.js |

The 3D scene reads the same variables, so the page and the world share one palette.

## Type
- **Unbounded** 500/700: headings, the stake markers, numerals in facts.
  - h1: `clamp(36px, min(5.6vw, 9.6vh), 88px)`, tracking −0.025em.
  - h2: 26–44px, tracking −0.02em.
- **Golos Text** 400–600: body text at 17px/1.55, controls, form.
- Tabular numerals for km, metres and dates.

## Components
- **Sign** (`.sign`):
  - paper background, 2px ink-line border, radius 16, soft offset shadow `--lift`;
  - `.right` floats it right, `.sign-wide` is up to 1080px, `.sign-book` is the booking form.
  - No nested cards: routes inside a sign are columns split by 1.5px rules.
- **Stake** (`.stake`): an ink pill hanging under the sign, e.g. «Лес · 0,9 км · 206 м». ride.js computes it from route.json and the section's `data-at`. It is never placed above a heading.
- **Buttons**:
  - pill, 2px ink-line border, minimum height 52px (44px in the small variant);
  - `.btn-main` is amber, `.btn-line` is outlined;
  - pressing scales to .97.
- **Route pick** (`.pick`): three bordered options; the checked one gets an amber wash. It is shared by the hero and the form.
- **Altitude profile** (`.alt`): fixed at the bottom right (a full-width bar on phones). It draws the real elevation of the trail with an amber «done» line and a dot that follows the horse. It hides on the booking finale.
- **Photo slot** (`.photo`): dashed frame with a caption until real Instagram files are placed. Real `<img>`/`<video>` inside switches it to a solid frame.

## Motion
- **Signature motion.** Scroll position maps to the trail position `u`:
  - each `.stop[data-at]` is reached when its middle crosses the middle of the viewport;
  - the horse eases toward `u` with `1 − e^(−3.2·dt)`;
  - gait follows scroll speed: walk when scrolling slowly, gallop when fast, frozen when the page stops;
  - at the start and end the camera blends into wide shots: over the city to the hills, then from the viewpoint down to the sea;
  - on wide screens a lens shift moves the subject away from the side the current sign occupies.
- **Framing.** ride.js finds the largest area of the screen that is free of text: a side strip on wide screens, or a vertical gap on phones. It passes this as `rideFocus`, and terrain.js shifts the lens window (`setViewOffset`) so the horse lands there. Perspective is unchanged; at the opening the whole trail is framed this way.
- **Light along the ride.** Lighting changes with position on the trail:
  - morning at the stable: cool haze, sun from the sea;
  - midday in the forest;
  - sunset at the viewpoint: low orange sun from the west, peach haze, violet sky.
  Sun direction, colour and intensity, the hemisphere light, haze, fog and the top of the sky all follow `u` (`LIGHT` in terrain.js).
- **Sharpness.** While moving, resolution adapts to the frame rate (at least 1×). Once the page stops, one frame is rendered at full resolution (up to 2×).
- **Load moment.** h1, lead and the hero sign rise 16px over .8s with `cubic-bezier(.23,1,.32,1)`, staggered by 70ms.
- **Reduced motion.** The camera and horse jump with no easing, and the load moment is opacity only.
- **Idle.** When nothing moves, the frame is not redrawn.
- **Fallback.** With no WebGL, Save-Data or a slow GPU, `media/marshrut.mp4` loops behind the page.

## Rules
- Keep the world full-bleed. Content always sits on signs, never on bare 3D.
- Unknown business facts stay as `.todo` placeholders and are never invented.
