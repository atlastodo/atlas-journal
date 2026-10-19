import { useColorScheme } from "react-native";
import type { Mood } from "@atlastodo/journal-core";

export interface Palette {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  danger: string;
  dangerSoft: string;
}

const light: Palette = {
  background: "#faf7f2",
  surface: "#ffffff",
  surfaceMuted: "#f3eee6",
  text: "#1c1917",
  muted: "#6b625b",
  border: "#e4ddd3",
  accent: "#b45309",
  onAccent: "#ffffff",
  accentSoft: "#fdf0dc",
  danger: "#b91c1c",
  dangerSoft: "#fde8e8",
};

const dark: Palette = {
  background: "#14110f",
  surface: "#1f1b18",
  surfaceMuted: "#2a2521",
  text: "#f5f2ee",
  muted: "#b0a69c",
  border: "#3a332e",
  accent: "#f59e0b",
  onAccent: "#1c1308",
  accentSoft: "#3b2a12",
  danger: "#f87171",
  dangerSoft: "#3b1717",
};

/** The palette for the system's light or dark appearance. */
export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const MOOD_LABELS: Record<Mood, string> = {
  1: "Awful",
  2: "Bad",
  3: "Okay",
  4: "Good",
  5: "Great",
};

export const MOOD_COLORS: Record<Mood, string> = {
  1: "#dc2626",
  2: "#ea580c",
  3: "#ca8a04",
  4: "#65a30d",
  5: "#16a34a",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };
/** Text column width on wide screens (web, tablets). */
export const MAX_WIDTH = 720;
