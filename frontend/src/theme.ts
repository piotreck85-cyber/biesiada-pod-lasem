export const theme = {
  color: {
    // Deep forest surfaces (Linear-style layered elevation, no shadows)
    surface: "#0A120E",
    surfaceSecondary: "#111D16",
    surfaceTertiary: "#18281F",
    surfaceQuaternary: "#1F3428",
    onSurface: "#F3F4F6",
    onSurfaceSecondary: "#9CA3AF",
    onSurfaceTertiary: "#D1D5DB",
    // Brand: warm gold accent
    brand: "#D4AF37",
    brandSecondary: "#FBBF24",
    brandTertiary: "#30260D",
    onBrand: "#1C1400",
    onBrandTertiary: "#FDE68A",
    // Semantic
    success: "#10B981",
    onSuccess: "#022C22",
    warning: "#F59E0B",
    onWarning: "#451A03",
    error: "#EF4444",
    onError: "#450A0A",
    info: "#3B82F6",
    // Structural
    border: "#1A2B21",
    borderStrong: "#263D2F",
    divider: "#152219",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, xl: 24, pill: 999 },
  font: {
    display: "Barlow Condensed",
    body: "Geist",
  },
};

export function formatPLN(v: number): string {
  const n = Math.round((v ?? 0) * 100) / 100;
  const parts = n.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${parts.join(",")} zł`;
}

export const MONTHS_PL = [
  "Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec",
  "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień",
];

export const DAYS_PL = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"];

export function initials(name?: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
