// ─────────────────────────────────────────────────────────────
// EL SORTEO DE TLOQUE — núcleo matemático
//
// Tres invariantes que NUNCA se rompen (verificados en las pruebas):
//   1. direct + pool + house = ticketPrice   (el boleto se reparte entero)
//   2. pozo >= bono(rareza) ANTES de otorgarla (nunca se promete lo que no se puede pagar)
//   3. E[bono] < pool  (el pozo siempre acumula colchón, jamás se vacía)
//
// Este archivo es PURO: sin base de datos, sin efectos. Así se puede
// probar a fondo — es dinero real.
// ─────────────────────────────────────────────────────────────

export type RarityKey =
  | "common" | "rare" | "very_rare" | "unusual"
  | "golden" | "legendary" | "mythic" | "absolute"

export interface Rarity {
  key:        RarityKey
  name:       string          // en español; el resto de idiomas vive en i18n
  prob:       number          // probabilidad base (suman exactamente 1)
  bonus:      number          // Tinta que el pozo paga al autor cuando sale
  priceMin:   number | null   // compra directa (null = SOLO por sorteo)
  priceMax:   number | null
  paperDup:   number          // Papel al usuario si le sale repetida
  sellable:   boolean         // ¿el autor puede venderla suelta?
}

// De menor a mayor. El orden IMPORTA: el sorteo cae hacia abajo si el pozo no alcanza.
export const RARITIES: Rarity[] = [
  { key: "common",    name: "Común",      prob: 0.5500, bonus:    1, priceMin:  30, priceMax:  45, paperDup:    5, sellable: true  },
  { key: "rare",      name: "Rara",       prob: 0.2500, bonus:    3, priceMin:  60, priceMax:  95, paperDup:    8, sellable: true  },
  { key: "very_rare", name: "Muy rara",   prob: 0.1200, bonus:    8, priceMin: 110, priceMax: 180, paperDup:   15, sellable: true  },
  { key: "unusual",   name: "Insólita",   prob: 0.0500, bonus:   26, priceMin: 200, priceMax: 330, paperDup:   30, sellable: true  },
  { key: "golden",    name: "Dorada",     prob: 0.0220, bonus:   74, priceMin: 400, priceMax: 650, paperDup:   60, sellable: true  },
  { key: "legendary", name: "Legendaria", prob: 0.0060, bonus:  264, priceMin: null, priceMax: null, paperDup:  150, sellable: false },
  { key: "mythic",    name: "Mítica",     prob: 0.0015, bonus: 1269, priceMin: null, priceMax: null, paperDup:  400, sellable: false },
  { key: "absolute",  name: "Absoluta",   prob: 0.0005, bonus: 6344, priceMin: null, priceMax: null, paperDup: 1000, sellable: false },
]

export const RARITY_BY_KEY: Record<RarityKey, Rarity> =
  RARITIES.reduce((acc, r) => { acc[r.key] = r; return acc }, {} as any)

export const rarityIndex = (k: RarityKey) => RARITIES.findIndex(r => r.key === k)

// ── EL BOLETO ──────────────────────────────────────────────
// Cuesta lo mismo que un libro: el lector cambia "elegir" por "sorpresa + carta".
export const TICKET = {
  price:  40,   // Tinta (= 20 MXN mientras 1 Tinta = 0.5 MXN)
  direct: 16,   // 40% → al autor de la obra que salió
  pool:   12,   // 30% → al pozo (bonos por rareza)
  house:  12,   // 30% → a Tloque
} as const

// ── LA PIEDAD ──────────────────────────────────────────────
// Seguro contra la mala racha. Calibrada a ~2.4× la esperanza natural.
// Mítica y Absoluta NUNCA se garantizan: son sagradas.
export const PITY = {
  golden:    { floor: "golden"    as RarityKey, every: 80  },
  legendary: { floor: "legendary" as RarityKey, every: 300 },
} as const

// ── VERIFICACIÓN DE LOS INVARIANTES (se corre en las pruebas) ──
export function checkInvariants(): { ok: true } | { ok: false; error: string } {
  const sum = RARITIES.reduce((a, r) => a + r.prob, 0)
  if (Math.abs(sum - 1) > 1e-9) {
    return { ok: false, error: `Las probabilidades suman ${sum}, no 1` }
  }
  const split = TICKET.direct + TICKET.pool + TICKET.house
  if (split !== TICKET.price) {
    return { ok: false, error: `El reparto suma ${split}, el boleto cuesta ${TICKET.price}` }
  }
  const expectedBonus = RARITIES.reduce((a, r) => a + r.prob * r.bonus, 0)
  if (expectedBonus >= TICKET.pool) {
    return { ok: false, error: `E[bono]=${expectedBonus.toFixed(4)} >= pozo/boleto=${TICKET.pool}: el pozo se vaciaría` }
  }
  for (let i = 1; i < RARITIES.length; i++) {
    if (RARITIES[i].prob >= RARITIES[i - 1].prob) {
      return { ok: false, error: `${RARITIES[i].key} no es más rara que ${RARITIES[i - 1].key}` }
    }
    if (RARITIES[i].bonus <= RARITIES[i - 1].bonus) {
      return { ok: false, error: `${RARITIES[i].key} no paga más que ${RARITIES[i - 1].key}` }
    }
  }
  return { ok: true }
}

/** Colchón que el pozo acumula por boleto. Debe ser > 0. */
export function poolCushion(): number {
  const e = RARITIES.reduce((a, r) => a + r.prob * r.bonus, 0)
  return TICKET.pool - e
}

// ── EL SORTEO ──────────────────────────────────────────────

export interface DrawInput {
  poolBalance: number                  // Tinta que hay en el pozo AHORA
  pitySinceGolden: number              // boletos desde la última Dorada+
  pitySinceLegendary: number           // boletos desde la última Legendaria+
  available: Record<RarityKey, boolean>// ¿hay cartas de esa rareza en el pool?
  rng?: () => number                   // inyectable para pruebas deterministas
}

export interface DrawResult {
  rarity:      RarityKey
  bonus:       number        // Tinta que el pozo le paga al autor
  rolled:      RarityKey     // lo que salió ANTES de los ajustes
  pityApplied: boolean       // la piedad forzó un piso
  downgraded:  RarityKey[]   // tiers que se bloquearon (pozo insuficiente o sin stock)
  reason:      "natural" | "pity" | "insolvent" | "no_stock"
}

/**
 * Sortea una rareza respetando los tres invariantes.
 * NUNCA devuelve una rareza cuyo bono el pozo no pueda pagar.
 */
export function drawRarity(input: DrawInput): DrawResult {
  const rng = input.rng ?? Math.random
  const downgraded: RarityKey[] = []

  // 1) Sorteo natural
  const x = rng()
  let acc = 0
  let idx = 0
  for (let i = 0; i < RARITIES.length; i++) {
    acc += RARITIES[i].prob
    if (x <= acc) { idx = i; break }
    idx = i
  }
  const rolled = RARITIES[idx].key

  // 2) La piedad puede subir un PISO (nunca baja)
  let pityApplied = false
  const floors: number[] = []
  if (input.pitySinceLegendary >= PITY.legendary.every - 1) {
    floors.push(rarityIndex(PITY.legendary.floor))
  }
  if (input.pitySinceGolden >= PITY.golden.every - 1) {
    floors.push(rarityIndex(PITY.golden.floor))
  }
  if (floors.length) {
    const floor = Math.max(...floors)
    if (idx < floor) { idx = floor; pityApplied = true }
  }

  // 3) SOLVENCIA + STOCK: bajar hasta una rareza que el pozo pueda pagar
  //    y de la que existan cartas. Este es el invariante #2.
  let reason: DrawResult["reason"] = pityApplied ? "pity" : "natural"
  while (idx > 0) {
    const r = RARITIES[idx]
    const solvent = input.poolBalance >= r.bonus
    const inStock = input.available[r.key] === true
    if (solvent && inStock) break
    downgraded.push(r.key)
    reason = !solvent ? "insolvent" : "no_stock"
    idx--
  }

  // La Común (idx 0) tiene bono 1: si ni eso alcanza, el pozo está en cero.
  // Se otorga igual con bono 0 — el autor cobra su directo, que no sale del pozo.
  const final = RARITIES[idx]
  const bonus = input.poolBalance >= final.bonus ? final.bonus : 0

  return { rarity: final.key, bonus, rolled, pityApplied, downgraded, reason }
}

/** El reparto de un boleto. Suma exactamente el precio: invariante #1. */
export function splitTicket(bonus: number) {
  return {
    toAuthorDirect: TICKET.direct,   // siempre
    toPool:         TICKET.pool,     // entra al pozo
    toHouse:        TICKET.house,    // Tloque
    bonusFromPool:  bonus,           // sale del pozo, va al autor
    authorTotal:    TICKET.direct + bonus,
    poolDelta:      TICKET.pool - bonus,   // lo que el pozo gana (o pierde) en esta tirada
  }
}

/** Actualiza los contadores de piedad tras una tirada. */
export function nextPity(
  rarity: RarityKey,
  sinceGolden: number,
  sinceLegendary: number,
): { sinceGolden: number; sinceLegendary: number } {
  const i = rarityIndex(rarity)
  return {
    sinceGolden:    i >= rarityIndex("golden")    ? 0 : sinceGolden + 1,
    sinceLegendary: i >= rarityIndex("legendary") ? 0 : sinceLegendary + 1,
  }
}

/** Cuántos boletos faltan para la próxima garantía (para mostrarlo al usuario). */
export function pityCountdown(sinceGolden: number, sinceLegendary: number) {
  return {
    toGolden:    Math.max(0, PITY.golden.every - sinceGolden),
    toLegendary: Math.max(0, PITY.legendary.every - sinceLegendary),
  }
}

/** ¿Qué rarezas puede honrar el pozo ahora mismo? (para el contador público) */
export function poolStatus(poolBalance: number) {
  return RARITIES.map(r => ({
    key:      r.key,
    name:     r.name,
    bonus:    r.bonus,
    unlocked: poolBalance >= r.bonus,
    progress: Math.min(1, poolBalance / r.bonus),
  }))
}
