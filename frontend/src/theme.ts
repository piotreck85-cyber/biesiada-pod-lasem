export const theme = {
  color: {
    // Light iOS-inspired surfaces (Apple HIG layered elevation)
    surface: "#F2F2F7",           // system background
    surfaceSecondary: "#FFFFFF",  // elevated cards
    surfaceTertiary: "#E5E5EA",   // subtle chips / inactive
    surfaceQuaternary: "#F9F9FB", // inner container
    onSurface: "#1C1C1E",         // primary text
    onSurfaceSecondary: "#6B6B70",// secondary text (light gray)
    onSurfaceTertiary: "#3A3A3C", // tertiary text
    // Brand: vibrant spring emerald (fresh, modern)
    brand: "#10B981",
    brandSecondary: "#059669",
    brandTertiary: "#D1FAE5",     // tint surface
    onBrand: "#FFFFFF",
    onBrandTertiary: "#065F46",
    // Semantic
    success: "#34C759",
    onSuccess: "#022C22",
    warning: "#FFCC00",
    onWarning: "#4D3D00",
    error: "#FF3B30",
    onError: "#FFFFFF",
    info: "#32ADE6",
    // Structural
    border: "#D1D1D6",
    borderStrong: "#8E8E93",
    divider: "#E5E5EA",
    // Category (semantic - preserved)
    categoryFirmowe: "#007AFF",
    categoryOkolicznosciowe: "#FFB800",
    categoryUrodzinki: "#FF2D55",
    categoryWarsztaty: "#34C759",
    // Status (semantic - preserved)
    statusConfirmed: "#34C759",
    statusTentative: "#FFCC00",
    statusCancelled: "#FF3B30",
    // Overlays
    overlayDim: "rgba(0,0,0,0.4)",
    glassTint: "rgba(255,255,255,0.7)",
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 },
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
