export interface AppTheme {
  accent: string;      // main brand color (default amber #f59e0b)
  sidebarFrom: string; // sidebar gradient top
  sidebarTo: string;   // sidebar gradient bottom
  appBg: string;       // page canvas background
  modalOverlay: string;// modal backdrop color (hex, opacity applied separately)
  font: string;        // font name — "System Default" uses Geist
}

export const DEFAULT_THEME: AppTheme = {
  accent: "#f59e0b",
  sidebarFrom: "#0a0a0a",
  sidebarTo: "#171717",
  appBg: "#f5f5f7",
  modalOverlay: "#171717",
  font: "System Default",
};

export const GOOGLE_FONTS: string[] = [
  // Sans-Serif
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Oswald",
  "Source Sans 3", "Raleway", "Ubuntu", "Nunito", "Poppins", "Josefin Sans",
  "Quicksand", "Nunito Sans", "Rubik", "Work Sans", "DM Sans", "Fira Sans",
  "Barlow", "Mulish", "Karla", "Manrope", "IBM Plex Sans", "PT Sans",
  "Cabin", "Oxygen", "Titillium Web", "Archivo", "Space Grotesk",
  "Plus Jakarta Sans", "Lexend", "Jost", "Figtree", "Outfit",
  "Exo 2", "Rajdhani", "Hind", "Asap", "Varela Round", "Be Vietnam Pro",
  // Serif
  "Playfair Display", "Merriweather", "Libre Baskerville", "PT Serif",
  "Crimson Text", "EB Garamond", "Spectral", "Bitter", "Rokkitt", "Lora",
  "Arvo", "Vollkorn", "Zilla Slab", "Domine", "Noto Serif",
  "DM Serif Display", "Cormorant Garamond", "Fraunces", "Bodoni Moda",
  "Source Serif 4",
  // Display / Decorative
  "Lobster", "Abril Fatface", "Cinzel", "Righteous", "Teko",
  "Baloo 2", "Fredoka", "Syne", "Red Hat Display", "Urbanist",
  "Epilogue", "Albert Sans", "Readex Pro", "Chivo", "Onest",
  "Pacifico", "Dancing Script", "Caveat", "Permanent Marker", "Kalam",
  // Monospace
  "Fira Code", "JetBrains Mono", "Source Code Pro", "IBM Plex Mono",
  "Inconsolata", "Space Mono", "Roboto Mono", "DM Mono",
  "Noto Sans Mono", "Courier Prime",
  // Handwriting
  "Satisfy", "Sacramento", "Great Vibes", "Shadows Into Light",
  "Indie Flower", "Handlee", "Comic Neue", "Gochi Hand",
  "Rock Salt", "Parisienne",
];

function loadGoogleFont(name: string) {
  if (typeof document === "undefined") return;
  const id = `gf-${name.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

export function applyTheme(theme: Partial<AppTheme>) {
  if (typeof document === "undefined") return;
  const t = { ...DEFAULT_THEME, ...theme };
  const root = document.documentElement;
  root.style.setProperty("--accent", t.accent);
  root.style.setProperty("--sidebar-from", t.sidebarFrom);
  root.style.setProperty("--sidebar-to", t.sidebarTo);
  root.style.setProperty("--app-bg", t.appBg);
  root.style.setProperty("--modal-overlay", t.modalOverlay);
  if (t.font !== "System Default") {
    loadGoogleFont(t.font);
    root.style.setProperty("--font-body", `"${t.font}", sans-serif`);
  } else {
    root.style.removeProperty("--font-body");
  }
}
