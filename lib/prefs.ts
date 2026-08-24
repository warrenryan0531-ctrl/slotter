import { db } from "@/lib/db";

/**
 * Per-user dashboard appearance. Accent drives the brand color scale (menu pills, buttons,
 * links); background sets the app canvas. Both are applied at runtime via `data-accent` /
 * `data-bg` attributes on the dashboard shell — see the palette blocks in globals.css.
 * Stored per (scope, email) so the same person can theme their admin and owner views apart.
 */

export type ThemeScope = "owner" | "admin";

// Accent options — the `swatch` is the 600 shade shown on the picker button.
export const ACCENTS: { key: string; label: string; swatch: string }[] = [
  { key: "teal", label: "Teal (904)", swatch: "#006778" },
  { key: "emerald", label: "Emerald", swatch: "#059669" },
  { key: "green", label: "Green", swatch: "#16a34a" },
  { key: "cyan", label: "Cyan", swatch: "#0891b2" },
  { key: "sky", label: "Sky", swatch: "#0284c7" },
  { key: "blue", label: "Blue", swatch: "#2563eb" },
  { key: "indigo", label: "Indigo", swatch: "#4f46e5" },
  { key: "violet", label: "Violet", swatch: "#7c3aed" },
  { key: "purple", label: "Purple", swatch: "#9333ea" },
  { key: "fuchsia", label: "Fuchsia", swatch: "#c026d3" },
  { key: "pink", label: "Pink", swatch: "#db2777" },
  { key: "rose", label: "Rose", swatch: "#e11d48" },
  { key: "orange", label: "Orange", swatch: "#ea580c" },
  { key: "amber", label: "Amber", swatch: "#d97706" },
  { key: "slate", label: "Slate", swatch: "#475569" },
];

// Background options — `swatch` is the actual canvas color.
export const BACKGROUNDS: { key: string; label: string; swatch: string }[] = [
  { key: "mint", label: "Mint", swatch: "#f1f7f7" },
  { key: "white", label: "White", swatch: "#ffffff" },
  { key: "warm", label: "Warm", swatch: "#f8f5f0" },
  { key: "slate", label: "Slate", swatch: "#f2f5f8" },
  { key: "sand", label: "Sand", swatch: "#f5f2ec" },
  { key: "sky", label: "Sky", swatch: "#eef4fb" },
  { key: "lavender", label: "Lavender", swatch: "#f3f1fb" },
  { key: "rose", label: "Rose", swatch: "#fbf2f5" },
];

export const ACCENT_KEYS = ACCENTS.map((a) => a.key);
export const BG_KEYS = BACKGROUNDS.map((b) => b.key);

export const DEFAULT_ACCENT = "teal";
export const DEFAULT_BG = "mint";

export type Prefs = { accent: string; background: string };

export async function getPrefs(scope: ThemeScope, email: string): Promise<Prefs> {
  try {
    const { data } = await db()
      .from("bh_user_prefs")
      .select("accent, background")
      .eq("scope", scope)
      .eq("email", email.toLowerCase())
      .limit(1);
    const r = data?.[0] as { accent?: string; background?: string } | undefined;
    return {
      accent: r?.accent && ACCENT_KEYS.includes(r.accent) ? r.accent : DEFAULT_ACCENT,
      background: r?.background && BG_KEYS.includes(r.background) ? r.background : DEFAULT_BG,
    };
  } catch {
    return { accent: DEFAULT_ACCENT, background: DEFAULT_BG };
  }
}

export async function setPrefs(scope: ThemeScope, email: string, patch: Partial<Prefs>): Promise<Prefs> {
  const cur = await getPrefs(scope, email);
  const accent = patch.accent && ACCENT_KEYS.includes(patch.accent) ? patch.accent : cur.accent;
  const background = patch.background && BG_KEYS.includes(patch.background) ? patch.background : cur.background;
  await db()
    .from("bh_user_prefs")
    .upsert(
      { scope, email: email.toLowerCase(), accent, background, updated_at: new Date().toISOString() },
      { onConflict: "scope,email" },
    );
  return { accent, background };
}
