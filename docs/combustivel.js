"use strict";

// Ficha dos modelos da frota da Vortex, em libras (lb).
// Limite combinado (combustível + carga + passageiros) e capacidade do tanque: Mercado de Aeronaves do
// PilOps, lido em 27/11/2026. Consumo médio de cruzeiro (lb por hora): valor de catálogo dos fabricantes,
// arredondado; serve para prever o combustível. O abastecimento real é decidido no planejamento do voo
// (PilOps/MSFS), com vento, altitude e alternado.
const VortexFuel = (() => {
  const reserveMinutes = 45;
  // Modelo | consumo lb/h | tanque no PilOps | limite combinado no PilOps
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

  // Viagem pelo tempo de bloco + 45 minutos de reserva, arredondado para cima de 100 em 100 lb.
  function estimate(model, minutes) {
    const item = info(model);
    if (!item || !Number.isFinite(minutes) || minutes <= 0) return null;
    const fuel = Math.ceil(item.burn * (minutes + reserveMinutes) / 60 / 100) * 100;
    return { fuel, burn: item.burn, tank: item.tank, limit: item.limit, overTank: fuel > item.tank, reserveMinutes };
  }

  return { info, estimate, reserveMinutes };
})();
