// Desempenho aproximado por modelo, para triagem de rotas no planejador.
// Alcance em milhas náuticas (nm) com carga típica e reservas; velocidade de cruzeiro em nós (kt TAS).
// Valores de catálogo dos fabricantes, arredondados para baixo. Não substituem o planejamento
// de combustível, a carga e o vento do voo no PilOps/MSFS. Modelos sem entrada ficam sem verificação.
const aircraftPerformance = [
  [/cessna 172|skyhawk/i, 640, 120],
  [/bonanza/i, 920, 175],
  [/baron/i, 950, 190],
  [/vision jet|sf50/i, 1270, 310],
  [/tbm/i, 1700, 320],
  [/grand caravan|208b?\b/i, 900, 180],
  [/skycourier|408/i, 900, 200],
  [/404|titan/i, 1100, 200],
  [/f?406|caravan ii/i, 1150, 220],
  [/king air|b200|b350/i, 1500, 280],
  [/sd3-60|shorts 360/i, 600, 200],
  [/caribou|dhc-4/i, 1100, 155],
  [/atr 72|atr72/i, 820, 275],
  [/citation cj3/i, 2000, 410],
  [/citation cj4/i, 2150, 430],
  [/longitude/i, 3500, 470],
  [/british aerospace 146|bae 146|avro rj/i, 1500, 400],
  [/dc-6/i, 3000, 270],
  [/e19[05]|e-jet/i, 2200, 450],
  [/a220-300|a220/i, 3300, 450],
  [/a320neo/i, 3400, 450],
  [/a321/i, 3200, 450],
  [/737 max/i, 3500, 450],
  [/727/i, 2300, 470],
  [/707/i, 3900, 470],
  [/md-11/i, 6700, 480],
  [/a330/i, 6300, 470],
];

function performanceOf(model) {
  const found = aircraftPerformance.find(([pattern]) => pattern.test(model || ""));
  return found ? { range: found[1], speed: found[2] } : null;
}
