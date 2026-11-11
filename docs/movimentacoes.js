// Classifica o trajeto pela malha cadastrada, sem presumir intenção ou autorização do piloto.
const VortexMovements = (() => {
  function classify(flight, routes) {
    if (routes.some(route => route.origin === flight.origin && route.destination === flight.destination)) return "registered";
    const network = new Set(routes.map(route => route.origin));
    if (!network.has(flight.destination)) return "outside";
    if (!network.has(flight.origin)) return "return";
    return "reposition";
  }
  return { classify };
})();
