# Supplied artwork

The originals, as delivered: 2000×2000 PNG, opaque background, no alpha.

- `lockup-light-bg.png` — black artwork on white
- `lockup-dark-bg.png` — white artwork on black

`../mark.svg` and `../lockup.svg` were traced from the light one with potrace,
at a measured 0.05% and 0.07% pixel disagreement against the source. Everything
shipped is generated from those vectors, not from these files — they are kept
for provenance and so the trace can be redone if the artwork changes.

Two notes for whoever comes next:

- The mark and the wordmark are separable. There is a 133px empty band between
  them in the source, so the mark crops cleanly at y 372–1170, x 629–1370.
- The vectors paint in `currentColor`, so the light/dark pair collapses into one
  file per shape. There is no separate dark asset to keep in step.
