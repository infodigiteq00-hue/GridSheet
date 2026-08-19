import { PaletteKey } from "./types";

export const PALETTES: Record<PaletteKey, { label: string; colors: string[] }> = {
  cobalt: { label: "Cobalt", colors: ["#2b4bff", "#00a6a6", "#ffb020", "#ff5c46", "#7b5cff", "#0f6bff"] },
  ember: { label: "Ember", colors: ["#e4572e", "#f4a259", "#6a4c93", "#2b8a7a", "#c05780", "#8d5524"] },
  ink: { label: "Ink", colors: ["#17161a", "#4a4a52", "#8a8a94", "#b9b8c0", "#2b4bff", "#61606a"] },
  bloom: { label: "Bloom", colors: ["#00798c", "#d1495b", "#edae49", "#30638e", "#8f2d56", "#3ca370"] },
};

export function colorsFor(key: PaletteKey): string[] {
  return (PALETTES[key] || PALETTES.cobalt).colors;
}
