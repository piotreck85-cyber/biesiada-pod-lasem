import { CATEGORIES } from "./categories";

const capitalize = (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;

export function calendarEventLabel(event: any): string {
  const category = String(event?.category || "").trim();

  if (category === "dorosli/okolicznosciowe") return "Okolicznościowa";
  if (category === "dorosli/firmowe") return "Firmowa";

  if (category.startsWith("dzieci/urodzinki")) {
    const stored = CATEGORIES.find(item => item.id === category)?.path.at(-1);
    return stored && stored !== "Urodzinki" ? stored : "Urodzinki";
  }

  if (category.startsWith("warsztaty")) {
    const stored = CATEGORIES.find(item => item.id === category)?.path.at(-1);
    return stored && stored !== "Inne" ? `Warsztaty ${stored.toLowerCase()}` : "Warsztaty";
  }

  if (category === "dzieci/wycieczki") return "Wycieczka szkolna";
  if (category === "dzieci/wycieczki_rodzice") return "Wycieczka z rodzicami";

  if (category) {
    const stored = CATEGORIES.find(item => item.id === category)?.path.at(-1);
    return stored || capitalize(category.split("/").at(-1) || category);
  }
  return "Bez kategorii";
}

export const EVENT_STATUS_COLORS: Record<string, { background: string; text: string; label: string }> = {
  wstepne: { background: "#F59E0B", text: "#422006", label: "Wstępne" },
  rezerwacja: { background: "#F97316", text: "#FFFFFF", label: "Rezerwacja" },
  potwierdzona: { background: "#3B82F6", text: "#FFFFFF", label: "Potwierdzona" },
  zakonczona: { background: "#10B981", text: "#FFFFFF", label: "Zakończona" },
  anulowana: { background: "#EF4444", text: "#FFFFFF", label: "Anulowana" },
};

export function eventStatusTone(status?: string) {
  return EVENT_STATUS_COLORS[String(status || "").toLowerCase()] || { background: "#64748B", text: "#FFFFFF", label: "Brak statusu" };
}