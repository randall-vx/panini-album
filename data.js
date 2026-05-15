// ============================================
// DATOS DEL ALBUM
// Estructura EXACTA segun la planilla oficial de
// ideasparaimprimir.com (planilla-tracker-album-
// panini-mundial-2026-azul.pdf)
// ============================================
//
// Orden de la planilla, fila por fila:
//   1.  FWC  (intro):  casillero "00" + FWC1..FWC8  -> 9 figuritas
//   2.  48 selecciones, cada una con 20 figuritas
//   3.  FWC  (cierre): FWC9..FWC19                  -> 11 figuritas
//   4.  CC   (Coca-Cola): CC1..CC14                 -> 14 figuritas
//
// Total: 9 + 48*20 + 11 + 14 = 994 casilleros
// ============================================

// Las 48 selecciones EN EL ORDEN EXACTO de la planilla
const TEAMS = [
  { code: "MEX", name: "Grupo A - 8 | MEX" },
  { code: "RSA", name: "Grupo A - 10 | RSA" },
  { code: "KOR", name: "Grupo A - 12 | KOR" },
  { code: "CZE", name: "Grupo A - 14 | CZE" },
  { code: "CAN", name: "Grupo B - 16 | CAN" },
  { code: "BIH", name: "Grupo B - 18 | BIH" },
  { code: "QAT", name: "Grupo B - 20 | QAT" },
  { code: "SUI", name: "Grupo B - 22 | SUI" },
  { code: "BRA", name: "Grupo C - 24 | BRA" },
  { code: "MAR", name: "Grupo C - 26 | MAR" },
  { code: "HAI", name: "Grupo C - 28 | HAI" },
  { code: "SCO", name: "Grupo C - 30 | SCO" },
  { code: "USA", name: "Grupo D - 32 | USA" },
  { code: "PAR", name: "Grupo D - 34 | PAR" },
  { code: "AUS", name: "Grupo D - 36 | AUS" },
  { code: "TUR", name: "Grupo D - 38 | TUR" },
  { code: "GER", name: "Grupo E - 40 | GER" },
  { code: "CUW", name: "Grupo E - 42 | CUW" },
  { code: "CIV", name: "Grupo E - 44 | CIV" },
  { code: "ECU", name: "Grupo E - 46 | ECU" },
  { code: "NED", name: "Grupo F - 48 | NED" },
  { code: "JPN", name: "Grupo F - 50 | JPN" },
  { code: "SWE", name: "Grupo F - 52 | SWE" },
  { code: "TUN", name: "Grupo F - 54 | TUN" },
  { code: "BEL", name: "Grupo G - 58 | BEL" },
  { code: "EGY", name: "Grupo G - 60 | EGY" },
  { code: "IRN", name: "Grupo G - 62 | IRN" },
  { code: "NZL", name: "Grupo G - 64 | NZL" },
  { code: "ESP", name: "Grupo H - 66 | ESP" },
  { code: "CPV", name: "Grupo H - 68 | CPV" },
  { code: "KSA", name: "Grupo H - 70 | KSA" },
  { code: "URU", name: "Grupo H - 72 | URU" },
  { code: "FRA", name: "Grupo I - 74 | FRA" },
  { code: "SEN", name: "Grupo I - 76 | SEN" },
  { code: "IRQ", name: "Grupo I - 78 | IRQ" },
  { code: "NOR", name: "Grupo I - 80 | NOR" },
  { code: "ARG", name: "Grupo J - 82 | ARG" },
  { code: "ALG", name: "Grupo J - 84 | ALG" },
  { code: "AUT", name: "Grupo J - 86 | AUT" },
  { code: "JOR", name: "Grupo J - 88 | JOR" },
  { code: "POR", name: "Grupo K - 90 | POR" },
  { code: "COD", name: "Grupo K - 92 | COD" },
  { code: "UZB", name: "Grupo K - 94 | UZB" },
  { code: "COL", name: "Grupo K - 96 | COL" },
  { code: "ENG", name: "Grupo L - 98 | ENG" },
  { code: "CRO", name: "Grupo L - 100 | CRO" },
  { code: "GHA", name: "Grupo L - 102 | GHA" },
  { code: "PAN", name: "Grupo L - 104 | PAN" }
];

const STICKERS_PER_TEAM = 20;

// Croacia es la unica seleccion cuyos codigos llevan un cero extra:
// CRO01, CRO02 ... CRO09, CRO010, CRO011 ... CRO020 (asi figura en la planilla)
const ZERO_PADDED_TEAMS = ["CRO"];

// Bloques especiales que NO siguen el patron "CODIGO + numero 1..20"
const SPECIAL_BLOCKS = [
  {
    code: "FWC",
    name: "Mundial (intro)",
    ids:    ["FWC00", "FWC1", "FWC2", "FWC3", "FWC4", "FWC5", "FWC6", "FWC7", "FWC8"],
    labels: ["00",    "FWC1", "FWC2", "FWC3", "FWC4", "FWC5", "FWC6", "FWC7", "FWC8"]
  },
  {
    code: "FWC2",
    name: "Mundial (cierre)",
    ids:    ["FWC9", "FWC10", "FWC11", "FWC12", "FWC13", "FWC14", "FWC15", "FWC16", "FWC17", "FWC18", "FWC19"],
    labels: ["FWC9", "FWC10", "FWC11", "FWC12", "FWC13", "FWC14", "FWC15", "FWC16", "FWC17", "FWC18", "FWC19"]
  },
  {
    code: "CC",
    name: "Coca-Cola",
    ids:    ["CC1", "CC2", "CC3", "CC4", "CC5", "CC6", "CC7", "CC8", "CC9", "CC10", "CC11", "CC12", "CC13", "CC14"],
    labels: ["CC1", "CC2", "CC3", "CC4", "CC5", "CC6", "CC7", "CC8", "CC9", "CC10", "CC11", "CC12", "CC13", "CC14"]
  }
];

// Construye el codigo de una figurita de seleccion
function teamStickerCode(teamCode, num) {
  if (ZERO_PADDED_TEAMS.includes(teamCode)) {
    return teamCode + "0" + num;
  }
  return teamCode + num;
}

// Genera la lista completa de figuritas, en el orden EXACTO de la planilla
function buildAllStickers() {
  const list = [];

  // 1. Bloque FWC intro
  const fwcIntro = SPECIAL_BLOCKS[0];
  fwcIntro.ids.forEach((id, idx) => {
    list.push({
      id: id,
      code: fwcIntro.labels[idx],
      team: "FWC",
      teamName: fwcIntro.name,
      num: idx
    });
  });

  // 2. Las 48 selecciones
  TEAMS.forEach(team => {
    for (let i = 1; i <= STICKERS_PER_TEAM; i++) {
      const code = teamStickerCode(team.code, i);
      list.push({
        id: code,
        code: code,
        team: team.code,
        teamName: team.name,
        num: i
      });
    }
  });

  // 3. Bloque FWC cierre
  const fwcEnd = SPECIAL_BLOCKS[1];
  fwcEnd.ids.forEach((id, idx) => {
    list.push({
      id: id,
      code: fwcEnd.labels[idx],
      team: "FWC",
      teamName: fwcEnd.name,
      num: 9 + idx
    });
  });

  // 4. Bloque Coca-Cola
  const cc = SPECIAL_BLOCKS[2];
  cc.ids.forEach((id, idx) => {
    list.push({
      id: id,
      code: cc.labels[idx],
      team: "CC",
      teamName: cc.name,
      num: idx + 1
    });
  });

  return list;
}

const ALL_STICKERS = buildAllStickers();

// Estructura para renderizar la grilla en bloques (igual que la planilla)
function buildGridBlocks() {
  const blocks = [];

  blocks.push({
    code: "FWC",
    name: "Mundial (intro)",
    stickers: ALL_STICKERS.filter(s => SPECIAL_BLOCKS[0].ids.includes(s.id))
  });

  TEAMS.forEach(team => {
    blocks.push({
      code: team.code,
      name: team.name,
      stickers: ALL_STICKERS.filter(s => s.team === team.code)
    });
  });

  blocks.push({
    code: "FWC2",
    name: "Mundial (cierre)",
    stickers: ALL_STICKERS.filter(s => SPECIAL_BLOCKS[1].ids.includes(s.id))
  });

  blocks.push({
    code: "CC",
    name: "Coca-Cola",
    stickers: ALL_STICKERS.filter(s => SPECIAL_BLOCKS[2].ids.includes(s.id))
  });

  return blocks;
}

const GRID_BLOCKS = buildGridBlocks();

// Grupos del torneo (A-L), cada uno con 4 selecciones
const GROUPS = [
  { letter: "A", teams: ["MEX", "RSA", "KOR", "CZE"] },
  { letter: "B", teams: ["CAN", "BIH", "QAT", "SUI"] },
  { letter: "C", teams: ["BRA", "MAR", "HAI", "SCO"] },
  { letter: "D", teams: ["USA", "PAR", "AUS", "TUR"] },
  { letter: "E", teams: ["GER", "CUW", "CIV", "ECU"] },
  { letter: "F", teams: ["NED", "JPN", "SWE", "TUN"] },
  { letter: "G", teams: ["BEL", "EGY", "IRN", "NZL"] },
  { letter: "H", teams: ["ESP", "CPV", "KSA", "URU"] },
  { letter: "I", teams: ["FRA", "SEN", "IRQ", "NOR"] },
  { letter: "J", teams: ["ARG", "ALG", "AUT", "JOR"] },
  { letter: "K", teams: ["POR", "COD", "UZB", "COL"] },
  { letter: "L", teams: ["ENG", "CRO", "GHA", "PAN"] },
];
