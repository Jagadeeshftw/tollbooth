import localFont from "next/font/local";

// The template's loader referenced Inter-*.ttf files it does not ship; these
// are the InterDisplay faces that are actually in the directory.
export const inter = localFont({
  src: [
    { path: "./InterDisplay-Regular.ttf", weight: "400", style: "normal" },
    { path: "./InterDisplay-Medium.ttf", weight: "500", style: "normal" },
    { path: "./InterDisplay-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./InterDisplay-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});
