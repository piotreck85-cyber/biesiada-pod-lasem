// Design Tokens v2 — proposal for Biesiada Pod Lasem UI redesign
// NIE nadpisuje istniejącego theme.ts — czeka na akceptację użytkownika.
export const v2 = {
  color: {
    // Green palette (dark → light)
    forestDeep: "#1B3122",     // hero backgrounds, dark surface
    forest:     "#285338",     // brand primary
    moss:       "#437A56",     // brand secondary / natural green
    sage:       "#8BAA92",     // muted accents
    mint:       "#E2EFE7",     // brand tertiary bg
    // Neutral
    bg:         "#F9FBF9",     // main surface (off-white with green tint)
    card:       "#FFFFFF",     // card surface
    cardMuted:  "#EBF2EC",     // secondary card (mint-tinted)
    border:     "#E5EBE5",
    borderStrong:"#C2D1C5",
    divider:    "#EEF2EE",
    // Text
    text:       "#1A2E20",
    textMuted:  "#5A6B5F",
    textSubtle: "#8B9E90",
    onDark:     "#F5F8F5",
    // Status
    success:    "#16A34A",
    warning:    "#D97706",
    error:      "#DC2626",
    info:       "#0284C7",
    // Status backgrounds (soft)
    successBg:  "#DCFCE7",
    warningBg:  "#FEF3C7",
    errorBg:    "#FEE2E2",
    infoBg:     "#DBEAFE",
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 },
  font: {
    display: "System",  // will be Plus Jakarta Sans in prod
    text:    "System",
  },
  shadow: {
    sm: { shadowColor: "#0F1F14", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    md: { shadowColor: "#0F1F14", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  },
};
