// Expense categories used across the app (Kalendarz > Koszty view + Koszty tab + Statystyki)
// Each has a stable id used in DB and a display label + color for chips.

export type ExpenseCategory = {
  id: string;
  label: string;
  color: string; // solid accent for chip
  icon?: string; // Feather icon name
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: "zakupy_spozywcze",   label: "Zakupy spożywcze",   color: "#10B981", icon: "shopping-cart" },
  { id: "rachunki",           label: "Rachunki",           color: "#3B82F6", icon: "file-text" },
  { id: "podatki",            label: "Podatki",            color: "#8B5CF6", icon: "briefcase" },
  { id: "pensje",             label: "Pensje pracowników", color: "#F59E0B", icon: "users" },
  { id: "wyplaty_szefow",     label: "Wypłaty szefów",     color: "#EF4444", icon: "user" },
  { id: "inwestycje",         label: "Inwestycje",         color: "#EC4899", icon: "trending-up" },
  { id: "ogolne_zaopatrzenie",label: "Ogólne zaopatrzenie",color: "#14B8A6", icon: "package" },
];

export function expenseCategoryLabel(id?: string): string {
  if (!id) return "Bez kategorii";
  const c = EXPENSE_CATEGORIES.find(x => x.id === id);
  return c ? c.label : id;
}

export function expenseCategoryColor(id?: string): string {
  if (!id) return "#8E8E93";
  const c = EXPENSE_CATEGORIES.find(x => x.id === id);
  return c ? c.color : "#8E8E93";
}
