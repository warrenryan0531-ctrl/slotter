// Pick WCAG-AA-legible text colors for a given brand background color.
// Multi-tenant: clients choose their own header color, so we compute rather than hard-code.
function lin(v: number): number {
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  if (c.length < 6) return 0.2;
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Returns header text colors that clear AA (4.5:1) on the given brand color. */
export function onBrand(hex: string): { strong: string; subtle: string } {
  const L = luminance(hex);
  const whiteContrast = 1.05 / (L + 0.05);
  if (whiteContrast >= 5.2) return { strong: "#ffffff", subtle: "rgba(255,255,255,0.9)" }; // margin so 0.9 still clears
  return { strong: "#0a0a0a", subtle: "rgba(0,0,0,0.72)" };
}
