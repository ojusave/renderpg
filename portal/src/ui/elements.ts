import { html } from "./html";

const TABLE =
  "H Hydrogen,He Helium,Li Lithium,Be Beryllium,B Boron,C Carbon,N Nitrogen,O Oxygen,F Fluorine,Ne Neon,Na Sodium,Mg Magnesium,Al Aluminum,Si Silicon,P Phosphorus,S Sulfur,Cl Chlorine,Ar Argon,K Potassium,Ca Calcium,Sc Scandium,Ti Titanium,V Vanadium,Cr Chromium,Mn Manganese,Fe Iron,Co Cobalt,Ni Nickel,Cu Copper,Zn Zinc,Ga Gallium,Ge Germanium,As Arsenic,Se Selenium,Br Bromine,Kr Krypton,Rb Rubidium,Sr Strontium,Y Yttrium,Zr Zirconium,Nb Niobium,Mo Molybdenum,Tc Technetium,Ru Ruthenium,Rh Rhodium,Pd Palladium,Ag Silver,Cd Cadmium,In Indium,Sn Tin,Sb Antimony,Te Tellurium,I Iodine,Xe Xenon,Cs Cesium,Ba Barium,La Lanthanum,Ce Cerium,Pr Praseodymium,Nd Neodymium,Pm Promethium,Sm Samarium,Eu Europium,Gd Gadolinium,Tb Terbium,Dy Dysprosium,Ho Holmium,Er Erbium,Tm Thulium,Yb Ytterbium,Lu Lutetium,Hf Hafnium,Ta Tantalum,W Tungsten,Re Rhenium,Os Osmium,Ir Iridium,Pt Platinum,Au Gold,Hg Mercury,Tl Thallium,Pb Lead,Bi Bismuth,Po Polonium,At Astatine,Rn Radon,Fr Francium,Ra Radium,Ac Actinium,Th Thorium,Pa Protactinium,U Uranium,Np Neptunium,Pu Plutonium,Am Americium,Cm Curium,Bk Berkelium,Cf Californium,Es Einsteinium,Fm Fermium,Md Mendelevium,No Nobelium,Lr Lawrencium,Rf Rutherfordium,Db Dubnium,Sg Seaborgium,Bh Bohrium,Hs Hassium,Mt Meitnerium,Ds Darmstadtium,Rg Roentgenium,Cn Copernicium,Nh Nihonium,Fl Flerovium,Mc Moscovium,Lv Livermorium,Ts Tennessine,Og Oganesson";

const ELEMENTS = TABLE.split(",").map((pair, i) => {
  const [symbol, name] = pair.split(" ") as [string, string];
  return { number: i + 1, symbol, name };
});

const PAPERS = ["lab", "lecture", "offsite", "meals"] as const;

export type Tile = { number: string; symbol: string; name: string; paper: (typeof PAPERS)[number] };

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Turns a team name into a periodic-table tile, like the Maker Day lab-group keychains.
 * Teams named after an element get the real symbol and number; others get their initials.
 */
export function tileFor(teamName: string): Tile {
  const words = teamName.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const el = ELEMENTS.find((e) => words.includes(e.name.toLowerCase()));
  const paper = PAPERS[hash(teamName.toLowerCase()) % PAPERS.length]!;
  if (el) return { number: String(el.number), symbol: el.symbol, name: el.name, paper };
  const letters = teamName.replace(/[^\p{L}\p{N}]/gu, "");
  const symbol = (letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase()) || "?";
  return { number: String((hash(teamName) % 118) + 1), symbol, name: teamName, paper };
}

/** Renders the element tile; `size` controls scale. */
export function elementTile(teamName: string, size: "sm" | "lg" = "sm") {
  const t = tileFor(teamName);
  return html`<span class="tile tile-${size} paper-${t.paper}" aria-hidden="true">
    <span class="tile-num">${t.number}</span><span class="tile-sym">${t.symbol}</span><span class="tile-name">${t.name}</span>
  </span>`;
}
