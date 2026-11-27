"use strict";

// Ficha de combustível dos modelos da frota da Vortex, em libras (lb).
// Consumo médio de cruzeiro (lb por hora) e capacidade do tanque são valores de catálogo dos fabricantes,
// arredondados. Servem para prever o combustível e comparar aeronaves; o abastecimento real é decidido
// no planejamento do voo (PilOps/MSFS), com vento, altitude e alternado.
const VortexFuel = (() => {
  const reserveMinutes = 45;
  const sheet = `Airbus A220-300|4600|37600
Airbus A320neo|5300|41200
Airbus A321|6200|41600
Boeing 737 MAX|5300|44900
Embraer E195|4800|28600
Boeing 727 Freighter|10500|54200
Boeing 707-320C|15000|159800
Airbus A330|12800|168800
Boeing 787-10 Dreamliner|12500|218700
Douglas MD-11|17500|253000
Airbus A380|25000|553800`.split("\n").map(line => {
    const [model, burn, tank] = line.split("|");
    return { model, burn: Number(burn), tank: Number(tank) };
  });
  const key = text => String(text || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  const byModel = new Map(sheet.map(item => [key(item.model), item]));

  const info = model => byModel.get(key(model)) || null;

  // Viagem pelo tempo de bloco + 45 minutos de reserva, arredondado para cima de 100 em 100 lb.
  function estimate(model, minutes) {
    const item = info(model);
    if (!item || !Number.isFinite(minutes) || minutes <= 0) return null;
    const fuel = Math.ceil(item.burn * (minutes + reserveMinutes) / 60 / 100) * 100;
    return { fuel, burn: item.burn, tank: item.tank, overTank: fuel > item.tank, reserveMinutes };
  }

  return { info, estimate, reserveMinutes };
})();
