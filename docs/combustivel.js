"use strict";

// Ficha dos modelos da frota da Vortex, em libras (lb).
// Limite combinado (combustível + carga + passageiros) e capacidade do tanque: Mercado de Aeronaves do
// PilOps, lido em 27/11/2026. O consumo vem primeiro do histórico da Vortex (combustível utilizado nos voos,
// publicado em fuelStats); o lb/h de catálogo abaixo só vale para modelo que ainda não voou. O abastecimento
// real é decidido no planejamento do voo (PilOps/MSFS), com vento, altitude e alternado.
const VortexFuel = (() => {
  const reserveMinutes = 45;
  // Modelo | consumo de catálogo lb/h | tanque no PilOps | limite combinado no PilOps
  const sheet = `Airbus A220-300|4600|38565|67250
Airbus A320neo|5300|42145|76414
Airbus A321|6200|47100|97691
Boeing 737 MAX|5300|45694|85640
Embraer E195|4800|29100|50563
Boeing 727 Freighter|10500|70920|107744
Boeing 707-320C|15000|160000|178500
Airbus A330|12800|172013|233021
Boeing 787-10 Dreamliner|12500|223646|258773
Douglas MD-11|17500|256900|361323
Airbus A380|25000|559937|639340`.split("\n").map(line => {
    const [model, burn, tank, limit] = line.split("|");
    return { model, burn: Number(burn), tank: Number(tank), limit: Number(limit) };
  });
  const key = text => String(text || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  const byModel = new Map(sheet.map(item => [key(item.model), item]));

  const info = model => byModel.get(key(model)) || null;

  // history.route: { fuel, count } gasto na mesma rota e modelo; history.model: { perHour, count } medido.
  // Viagem = gasto da rota, ou consumo × tempo de bloco; + 45 min de reserva; arredondado para cima de 100 lb.
  function estimate(model, minutes, history = {}) {
    const item = info(model);
    const route = history.route?.fuel > 0 ? history.route : null;
    const measured = history.model?.perHour > 0 ? history.model : null;
    if (!item && !measured) return null;
    if (!route && (!Number.isFinite(minutes) || minutes <= 0)) return null;
    const burn = measured ? measured.perHour : item.burn;
    const trip = route ? route.fuel : burn * minutes / 60;
    const fuel = Math.ceil((trip + burn * reserveMinutes / 60) / 100) * 100;
    const tank = item?.tank ?? null;
    return { fuel, trip: Math.round(trip), burn, tank, limit: item?.limit ?? null, overTank: tank !== null && fuel > tank,
      reserveMinutes, source: route ? "route" : measured ? "model" : "catalogue",
      count: route ? route.count : measured ? measured.count : 0 };
  }

  return { info, estimate, reserveMinutes };
})();
