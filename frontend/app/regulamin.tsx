import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

type RuleSection = {
  title: string;
  rules: { number: number; text: string }[];
};

const sections: RuleSection[] = [
  {
    title: "Postanowienia ogólne",
    rules: [
      { number: 1, text: "Organizatorem konkursu jest firma PUH JANSTA z siedzibą w Kielcach, NIP: 8631659037." },
      { number: 2, text: "Fundatorem nagrody jest Organizator." },
      { number: 3, text: "Konkurs nie jest stworzony, administrowany ani sponsorowany przez Facebook. Serwis facebook.com nie ponosi żadnej odpowiedzialności za jakiekolwiek działania związane z organizacją konkursu na łamach serwisu." },
    ],
  },
  {
    title: "Warunki uczestnictwa",
    rules: [
      { number: 4, text: "W konkursie mogą wziąć udział wyłącznie osoby pełnoletnie." },
      { number: 5, text: "Warunkiem udziału w konkursie jest posiadanie zweryfikowanego konta w serwisie Facebook." },
      { number: 6, text: "Konkurs trwa od 03.09.2026 do 06.09.2026 do godz. 20:59." },
      { number: 7, text: "Wyniki Konkursu zostaną ogłoszone za pośrednictwem fanpage’a." },
      { number: 8, text: "Konkurs odbywa się za pośrednictwem fanpage’a na portalu społecznościowym Facebook znajdującego się pod adresem: https://www.facebook.com/profile.php?id=100027999565352." },
    ],
  },
  {
    title: "Zadanie konkursowe",
    rules: [
      { number: 9, text: "Zadanie konkursowe polega na:\n\n• zaobserwowaniu profilu Biesiada pod lasem Kielce na Facebooku;\n• polubieniu postu konkursowego oraz udostępnieniu go na swoim profilu na Facebooku;\n• napisaniu w komentarzu pod postem nazwy szkoły/przedszkola oraz dlaczego właśnie do nas chcecie przyjechać na jesienne warsztaty.\n\nWymagane jest wykonanie wszystkich 3 zadań konkursowych." },
      { number: 11, text: "Wygrywa KOMENTARZ z największą liczbą polubień." },
      { number: 12, text: "Zwycięzcy Konkursu zostaną powiadomieni o wygranej i warunkach odbioru nagrody za pośrednictwem wiadomości prywatnej wysłanej na portalu Facebook." },
      { number: 13, text: "Organizator zwraca uwagę na poszanowanie twórczości innych i zachowanie kultury w wypowiedziach." },
      { number: 14, text: "Zgłoszenia zawierające wulgaryzmy i niecenzuralne słowa będą usuwane i nie będą brały udziału w konkursie." },
    ],
  },
  {
    title: "Nagroda",
    rules: [
      { number: 15, text: "Nagrodą w konkursie są warsztaty jesienne organizowane w Biesiadzie pod lasem dla grupy liczącej maksymalnie 25 osób." },
      { number: 16, text: "Realizacja nagrody nastąpi w terminie od 07.09.2026 do 29.10.2026 — termin do ustalenia z Organizatorem." },
      { number: 17, text: "Organizator ma prawo podać dane Zwycięzcy na fanpage’u." },
      { number: 18, text: "Organizator nie ponosi odpowiedzialności za brak możliwości przekazania nagrody z przyczyn leżących po stronie Uczestnika. W takim wypadku nagroda przepada." },
      { number: 19, text: "Organizator nie ponosi odpowiedzialności za nieprawidłowe dane wskazane przez Uczestnika, a w szczególności za zmianę danych osobowych uniemożliwiających odszukanie Uczestnika i poinformowanie o przyznaniu Nagrody." },
      { number: 20, text: "W przypadku wykrycia działań niezgodnych z Regulaminem, próby wpływania na wyłonienie Zwycięzcy w sposób niedozwolony, szczególnie poprzez zakładanie fikcyjnych profili w serwisie Facebook, dany uczestnik może zostać wykluczony z Konkursu." },
    ],
  },
  {
    title: "Reklamacje",
    rules: [
      { number: 21, text: "Wszelkie reklamacje oraz uwagi dotyczące zasad, przeprowadzenia lub rozstrzygnięcia konkursu prosimy zgłaszać mailowo na adres: biesiadapodlasem@gmail.com." },
      { number: 22, text: "Reklamacja powinna zawierać imię i nazwisko Uczestnika oraz uzasadnienie reklamacji. W tytule wiadomości prosimy dodać opis: „Konkurs na Facebooku – Wygraj ognisko lub warsztaty dla swojej klasy”." },
      { number: 23, text: "Reklamacje rozpatrywane są w terminie 30 dni od daty ich wpłynięcia." },
    ],
  },
  {
    title: "Obowiązek informacyjny",
    rules: [
      { number: 24, text: "Informujemy, że administratorem danych osobowych uczestników Konkursu jest PUH JANSTA z siedzibą w Kielcach. W sprawach dotyczących przetwarzania danych osobowych należy kontaktować się z Inspektorem Ochrony Danych." },
      { number: 25, text: "Dane osobowe będą przetwarzane w celu i zakresie niezbędnym do przeprowadzenia Konkursu, na podstawie art. 6 ust. 1 lit. b Rozporządzenia Parlamentu Europejskiego i Rady (UE) 2016/679 (dalej: „RODO”). Dane zostały zebrane przez fanpage na Facebooku Biesiada pod lasem Kielce." },
      { number: 26, text: "Dane osobowe będą przetwarzane przez okres niezbędny do realizacji Konkursu, w tym wydania Nagrody i ogłoszenia informacji o Zwycięzcy oraz innych nagrodzonych osobach, a także przechowywane do momentu przedawnienia ewentualnych roszczeń lub wygaśnięcia obowiązku archiwizacji danych wynikającego z przepisów prawa." },
    ],
  },
  {
    title: "Postanowienia końcowe",
    rules: [
      { number: 27, text: "W kwestiach nieuregulowanych niniejszym Regulaminem stosuje się przepisy Kodeksu cywilnego i inne przepisy prawa." },
      { number: 28, text: "Spory odnoszące się do Konkursu i z niego wynikające będą rozwiązywane przez sąd powszechny właściwy miejscowo dla siedziby Organizatora." },
      { number: 29, text: "Organizator zastrzega sobie prawo do zmiany zasad Konkursu w trakcie jego trwania. Informacja o zmianach będzie zamieszczona na fanpage’u Biesiada pod lasem Kielce." },
      { number: 30, text: "Biorąc udział w konkursie, Użytkownik zgadza się z postanowieniami niniejszego Regulaminu." },
    ],
  },
];

export default function RegulaminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Wróć" hitSlop={12} onPress={() => router.back()} style={styles.backButton} testID="regulamin-back">
          <Feather name="arrow-left" size={20} color={theme.color.onBrand} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>BIESIADA POD LASEM</Text>
          <Text style={styles.headerTitle}>Regulamin konkursu</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, theme.spacing.lg) + theme.spacing.xxl }]}>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>KONKURS</Text>
          <Text style={styles.heroTitle}>„Wygraj Warsztaty Jesienne dla swojej grupy”</Text>
          <Text style={styles.organizer}>PUH JANSTA z siedzibą w Kielcach</Text>
        </View>

        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.rules.map((rule) => (
              <View key={rule.number} style={styles.rule}>
                <View style={styles.numberBadge}><Text style={styles.number}>{rule.number}</Text></View>
                <Text selectable style={styles.ruleText}>{rule.text}</Text>
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.footer}>Regulamin obowiązuje od 3 września 2026 r.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md, backgroundColor: theme.color.brandSecondary },
  backButton: { width: 40, height: 40, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  headerCopy: { flex: 1 },
  eyebrow: { color: theme.color.brandTertiary, fontFamily: theme.font.body, fontSize: 10, fontWeight: "800", letterSpacing: 2.4 },
  headerTitle: { color: theme.color.onBrand, fontFamily: theme.font.display, fontSize: 24, fontWeight: "800" },
  content: { width: "100%", maxWidth: 820, alignSelf: "center", padding: theme.spacing.lg, gap: theme.spacing.lg },
  hero: { padding: theme.spacing.xl, borderRadius: theme.radius.lg, backgroundColor: theme.color.onSurface },
  heroLabel: { color: theme.color.brand, fontFamily: theme.font.body, fontSize: 11, fontWeight: "900", letterSpacing: 3, marginBottom: theme.spacing.sm },
  heroTitle: { color: theme.color.onBrand, fontFamily: theme.font.display, fontSize: 32, lineHeight: 36, fontWeight: "800" },
  organizer: { color: "#D1D1D6", fontFamily: theme.font.body, fontSize: 14, marginTop: theme.spacing.md },
  section: { padding: theme.spacing.lg, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  sectionTitle: { color: theme.color.brandSecondary, fontFamily: theme.font.display, fontSize: 24, fontWeight: "800", marginBottom: theme.spacing.md },
  rule: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.md, paddingVertical: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.color.divider },
  numberBadge: { minWidth: 32, height: 32, paddingHorizontal: theme.spacing.xs, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.brandTertiary },
  number: { color: theme.color.onBrandTertiary, fontFamily: theme.font.body, fontSize: 12, fontWeight: "900" },
  ruleText: { flex: 1, color: theme.color.onSurface, fontFamily: theme.font.body, fontSize: 15, lineHeight: 23 },
  footer: { color: theme.color.onSurfaceSecondary, fontFamily: theme.font.body, fontSize: 12, textAlign: "center", paddingVertical: theme.spacing.md },
});
