"use strict";

// Vagas da Vortex publicadas pelo dono da companhia (extensão "Vortex · Dono", botão "Sincronizar Vortex (dono)").
// Cada vaga traz as barras de carga e de passageiros como o PilOps mostra ao dono: número, limite e/ou percentual.
const VortexStands = (() => {
  const kgPerPound = 0.45359237;
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const list = value => Array.isArray(value) ? value.filter(item => typeof item === "string") : [];

  function reading(raw) {
    if (!raw || typeof raw !== "object") return null;
    const value = finite(raw.value) && raw.value >= 0 ? raw.value : null;
    const max = finite(raw.max) && raw.max > 0 ? raw.max : null;
    const pct = finite(raw.pct) && raw.pct >= 0 ? Math.min(raw.pct, 100) : null;
    if (value === null && pct === null && raw.full !== true) return null;
    return { value, max, pct, unit: raw.unit === "kg" ? "kg" : "lb", full: raw.full === true || pct === 100 };
  }

  function read(data) {
    if (!data || !Array.isArray(data.stands) || !Number.isFinite(Date.parse(data.capturedAt))) return null;
    const stands = data.stands.filter(stand => stand && typeof stand.code === "string" && /^[A-Z0-9]{3,5}$/.test(stand.airport))
      .map(stand => ({
        code: stand.code, airport: stand.airport, size: stand.size ?? null, expires: stand.expires ?? null,
        cargo: reading(stand.cargo), pax: reading(stand.pax),
        routes: stand.routes ? { codes: list(stand.routes.codes), destinations: list(stand.routes.destinations) } : null,
      }));
    return { capturedAt: data.capturedAt, stands };
  }

  // Quanto há na vaga: o número mostrado ou, sem ele, o percentual da barra × o limite.
  const current = item => item.value ?? (item.pct !== null && item.max ? item.pct / 100 * item.max : null);
  const inPounds = (item, value) => item.unit === "kg" ? value / kgPerPound : value;

  function total(stands, key, weight) {
    let value = 0, max = 0, known = 0, full = 0, pctSum = 0, pctCount = 0;
    for (const stand of stands) {
      const item = stand[key];
      if (!item) continue;
      const amount = current(item);
      if (amount !== null) { value += weight ? inPounds(item, amount) : amount; known++; }
      if (item.max) max += weight ? inPounds(item, item.max) : item.max;
      if (item.pct !== null) { pctSum += item.pct; pctCount++; }
      if (item.full) full++;
    }
    return { value: known ? value : null, max: max || null, known, full,
      pct: pctCount ? Math.round(pctSum / pctCount) : null };
  }

  // Vagas na origem da rota. Se alguma vaga lista rotas e inclui esta (código VTX ou destino), valem só essas.
  function forRoute(data, route) {
    if (!data || !route) return null;
    const here = data.stands.filter(stand => stand.airport === route.origin);
    const linked = here.filter(stand => stand.routes &&
      (stand.routes.codes.includes(route.code) || stand.routes.destinations.includes(route.destination)));
    const chosen = linked.length ? linked : here;
    return { count: chosen.length, atAirport: here.length, basis: linked.length ? "route" : "airport",
      cargo: total(chosen, "cargo", true), pax: total(chosen, "pax", false) };
  }

  // O que um avião levaria do que há nas vagas: assentos até o limite e carga até o peso livre (limite − combustível).
  function fill(summary, { seats = null, room = null } = {}) {
    if (!summary?.count) return null;
    const pax = summary.pax.value, cargo = summary.cargo.value;
    return {
      seats: pax === null || seats === null ? null : Math.min(Math.floor(pax), seats),
      cargo: cargo === null || room === null ? null : Math.min(cargo, Math.max(room, 0)),
    };
  }

  return { read, forRoute, fill };
})();
