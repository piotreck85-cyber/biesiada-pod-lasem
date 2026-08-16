// Shared hook for menu prices (grill sets + dinner items) with per-workspace overrides.
// Loads from backend and exposes merged values ready to use in Oferta + Event form.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/src/api";
import { DINNER_MENU as DEFAULT_DINNER_MENU, DinnerItem } from "@/src/dinnerMenu";
import { ADULT_SETS as DEFAULT_ADULT_SETS } from "@/src/offers";

export type MenuSettings = {
  dinner_price_overrides: Record<string, number>;
  dinner_cost_overrides: Record<string, number>;
  dinner_custom_items: DinnerItem[];
  grill_price_overrides: Record<string, number>;
};

const EMPTY: MenuSettings = {
  dinner_price_overrides: {},
  dinner_cost_overrides: {},
  dinner_custom_items: [],
  grill_price_overrides: {},
};

export function useMenuSettings() {
  const [settings, setSettings] = useState<MenuSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s: any = await api.getMenuSettings();
      setSettings({
        dinner_price_overrides: s.dinner_price_overrides || {},
        dinner_cost_overrides:  s.dinner_cost_overrides || {},
        dinner_custom_items:    s.dinner_custom_items || [],
        grill_price_overrides:  s.grill_price_overrides || {},
      });
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (patch: Partial<MenuSettings>) => {
    setSaving(true);
    try {
      const next: MenuSettings = { ...settings, ...patch };
      await api.saveMenuSettings(next);
      setSettings(next);
    } catch {} finally { setSaving(false); }
  }, [settings]);

  // Merged dinner menu: default items with overrides applied + custom items appended.
  const dinnerMenu: DinnerItem[] = useMemo(() => {
    const merged = DEFAULT_DINNER_MENU.map(item => ({
      ...item,
      base_price: settings.dinner_price_overrides[item.id] ?? item.base_price,
      cost_price: settings.dinner_cost_overrides[item.id] ?? item.cost_price,
    }));
    // Custom items — apply overrides too (in case user edited a custom item)
    const custom = (settings.dinner_custom_items || []).map(it => ({
      ...it,
      base_price: settings.dinner_price_overrides[it.id] ?? it.base_price,
      cost_price: settings.dinner_cost_overrides[it.id] ?? it.cost_price,
    }));
    return [...merged, ...custom];
  }, [settings]);

  // Merged grill sets — apply price_per_person override where present.
  const adultSets = useMemo(() => {
    return DEFAULT_ADULT_SETS.map(zs => ({
      ...zs,
      price_per_person: settings.grill_price_overrides[zs.id] ?? zs.price_per_person,
    }));
  }, [settings]);

  return { settings, dinnerMenu, adultSets, loading, saving, save, reload: load };
}
