/* GENERATED from packages/design/tokens.css — do not edit. Run: npm run sync */

export const light = {
  fontPrimary: "\"Inter Display\", ui-sans-serif, system-ui, sans-serif",
  fontMono: "\"DM Mono\", ui-monospace, SFMono-Regular, Menlo, monospace",
  charcoal900: "#1a1a1a",
  charcoal800: "#262626",
  charcoal700: "#333333",
  gray100: "#f9f9f9",
  gray200: "#f4f4f4",
  gray300: "#e9ebee",
  gray400: "#d5d5d5",
  gray500: "#bdbdbd",
  gray600: "#878787",
  brand: "#0f8a7e",
  brandSoft: "#d9f1ee",
  warn: "#b45309",
  warnSoft: "#fffbeb",
  divide: "#e9ebee",
  fg: "#1a1a1a",
  fgMuted: "#878787",
  bg: "#ffffff",
  bgSoft: "#f9f9f9",
  line: "#e5e5e5",
  shadow: "0px 2px 3px -1px rgba(0, 0, 0, 0.1), 0px 1px 0px 0px rgba(25, 28, 33, 0.02), 0px 0px 0px 1px rgba(25, 28, 33, 0.08)",
} as const;

/** The video renders on the dark palette: these override `light`. */
export const darkOverrides = {
  divide: "#262626",
  fg: "#f5f5f5",
  fgMuted: "#a3a3a3",
  bg: "#000000",
  bgSoft: "#171717",
  line: "#404040",
  brandSoft: "#042f2e",
  warnSoft: "#451a03",
} as const;

export const theme = { ...light, ...darkOverrides } as const;
