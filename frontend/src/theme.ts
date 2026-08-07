export const theme = {
  color: {
    surface: "#0F2A20",
    surfaceSecondary: "#153328",
    surfaceTertiary: "#1D4232",
    onSurface: "#F3F5F0",
    onSurfaceSecondary: "#9BB0A4",
    onSurfaceTertiary: "#CDD6D0",
    brand: "#D4AF37",
    brandSecondary: "#C5A028",
    brandTertiary: "#3A3818",
    onBrand: "#0F2A20",
    onBrandTertiary: "#EEDD99",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    border: "#1D4232",
    borderStrong: "#2A5B47",
    divider: "#173628",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
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
