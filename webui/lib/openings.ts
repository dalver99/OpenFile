const FAMILY_MARKERS = new Set([
  "defense",
  "opening",
  "game",
  "gambit",
  "attack",
  "system",
]);

const GAMBIT_QUALIFIERS = new Set(["accepted", "declined"]);

const PARENT_FAMILIES = [
  { matches: ["caro-kann-defense"], slug: "caro-kann-defense", name: "Caro-Kann Defense" },
  { matches: ["sicilian-defense"], slug: "sicilian-defense", name: "Sicilian Defense" },
  { matches: ["kings-indian-defense"], slug: "kings-indian-defense", name: "King's Indian Defense" },
  { matches: ["nimzo-indian-defense"], slug: "nimzo-indian-defense", name: "Nimzo-Indian Defense" },
  { matches: ["queens-gambit"], slug: "queens-gambit", name: "Queen's Gambit" },
  { matches: ["french-defense"], slug: "french-defense", name: "French Defense" },
  { matches: ["english-opening"], slug: "english-opening", name: "English Opening" },
  { matches: ["italian-game", "giuoco-piano-game"], slug: "italian-game", name: "Italian Game" },
  { matches: ["scotch-game"], slug: "scotch-game", name: "Scotch Game" },
  { matches: ["ruy-lopez"], slug: "ruy-lopez", name: "Ruy Lopez" },
] as const;

function openingSlug(ecoUrl: string): string {
  const marker = "/openings/";
  const index = ecoUrl.toLowerCase().indexOf(marker);
  const raw = index >= 0 ? ecoUrl.slice(index + marker.length) : ecoUrl;
  return raw
    .split(/[?#]/, 1)[0]
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function titleWord(word: string): string {
  const lower = word.toLowerCase();
  if (lower === "queens") return "Queen's";
  if (lower === "kings") return "King's";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function openingNameFromEcoUrl(ecoUrl: string | null): string | null {
  if (!ecoUrl) return null;
  const slug = openingSlug(ecoUrl);
  if (!slug) return null;
  return slug.split("-").filter(Boolean).map(titleWord).join(" ")
    .replace(/^Caro Kann\b/, "Caro-Kann");
}

export function openingFamilyFromEcoUrl(ecoUrl: string | null): {
  slug: string;
  name: string;
} | null {
  if (!ecoUrl) return null;
  const fullSlug = openingSlug(ecoUrl).toLowerCase();
  const known = PARENT_FAMILIES.find((family) =>
    family.matches.some((candidate) => fullSlug.includes(candidate)));
  if (known) return { slug: known.slug, name: known.name };
  const words = fullSlug.split("-").filter(Boolean);
  if (!words.length) return null;

  let boundary = words.findIndex((word) => FAMILY_MARKERS.has(word));
  if (boundary < 0) boundary = Math.min(words.length - 1, 2);
  if (words[boundary] === "gambit" && GAMBIT_QUALIFIERS.has(words[boundary + 1])) {
    boundary += 1;
  }

  const familySlug = words.slice(0, boundary + 1).join("-");
  const name = words.slice(0, boundary + 1).map(titleWord).join(" ")
    .replace(/^Caro Kann\b/, "Caro-Kann");
  return { slug: familySlug, name };
}
