# @tollbooth/design

The design tokens — colour and type — shared by the landing site, the docs, the operator dashboard and the explainer video.

**Private — not published to npm.** It ships one file: `tokens.css`.

## The single source

`tokens.css` is where a colour is defined. Nothing else defines one. Everything that renders Tollbooth reads it, but each surface needs it in a different shape, so the copies are generated rather than hand-kept:

| Copy | Why it cannot just import this file |
| --- | --- |
| `site/styles/tokens.css` | The site deploys from its own directory on Vercel and cannot import from outside it. |
| `video/src/theme.generated.ts` | The video is bundled for a headless browser with no filesystem, so the CSS is parsed here into a module it can import. `var(--tb-…)` references are flattened, because a CSS variable reference means nothing in JavaScript. |
| `dashboard` | Inlined at build. |

Edit `tokens.css`, then run `npm run sync` from the repo root. `npm run check:generated` fails if any copy has drifted, and CI runs it.

## Dark mode

`:root` carries the light palette and `.dark` overrides it. The video renders on the dark palette, which is why the generated theme module exports `light`, `darkOverrides` and the merged `theme`.
