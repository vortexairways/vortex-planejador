"use strict";

// Enche o voo aberto no PilOps com a melhor combinação de ofertas para o destino planejado.
// Usa as mesmas chamadas da página do PilOps (apiv2.pilops.com, com o token da própria página):
//   GET  /flight/current                     voo aberto: aeronave, combustível no tanque e o que já está a bordo;
//   GET  /goods/{ORIGEM}?flightId=…&destination=…   ofertas, 20 por página;
//   POST /goods/flight/sync {flightId, goods}  a lista completa do voo (o que já estava + o que entra).
// As contas seguem as da página: peso livre = limite combinado (aircraft.type.cargo) − combustível − o que já
// está a bordo; assentos = aircraft.type.pax − passageiros a bordo; oferta "Aceita apenas …" só para a categoria
// certa; oferta bloqueada, vencida ou já em outro voo fica de fora. Nada que já está no voo é retirado.
// Depende de VortexLoad (cargas.js, o mesmo otimizador do planejador).
const VortexFill = (() => {
  const pageSize = 20;
  const maxPages = 80;
  const expiryMargin = 5 * 60 * 1000;
  const modes = ["ambos", "passageiros", "carga"];

  class FillError extends Error {
    constructor(code, data = {}) { super(code); this.code = code; this.data = data; }
  }

  const finite = value => typeof value === "number" && Number.isFinite(value);
  const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
  const upper = value => String(value ?? "").trim().toUpperCase();

  function good(raw) {
    const type = raw?.type;
    const weight = Number(raw?.weight), price = Number(raw?.price), quantity = Number(raw?.quantity);
    if (typeof raw?.id !== "string" || (type !== "PASSENGER" && type !== "CARGO") || !(weight >= 0) || !(price >= 0)) {
      throw new FillError("api", { detail: "goods" });
    }
    const seats = type === "PASSENGER" ? quantity : 0;
    if (!Number.isInteger(seats) || seats < 0) throw new FillError("api", { detail: "quantity" });
    return { id: raw.id, type, weight, seats, price, destination: upper(raw.destination) };
  }

  // Lê o voo aberto. Sem voo, devolve null.
  function state(flight) {
    if (!flight || typeof flight !== "object" || !flight.id) return null;
    const aircraft = flight.aircraft || {}, type = aircraft.type || {};
    const capacity = Number(type.cargo), seatLimit = Number(type.pax ?? type.seats ?? 0), fuel = Number(aircraft.fuel ?? 0);
    if (!(capacity > 0) || !Number.isInteger(seatLimit) || seatLimit < 0 || !(fuel >= 0) || !Array.isArray(flight.goods)) {
      throw new FillError("api", { detail: "flight" });
    }
    const loaded = flight.goods.map(good);
    const tank = Number(type.fuelCapacity);
    return {
      id: flight.id, from: upper(flight.from), to: flight.to ? upper(flight.to) : null, started: Boolean(flight.startedAt),
      registration: upper(aircraft.registration), category: type.category || null,
      capacity, seatLimit, fuel, tank: tank > 0 ? tank : null,
      loaded, weight: sum(loaded, "weight"), seats: sum(loaded, "seats"),
    };
  }

  const signature = flight => JSON.stringify([flight.id, flight.started, flight.fuel, flight.loaded.map(item => item.id).sort()]);

  async function current(api) {
    try { return state(await api("/flight/current")); }
    catch (error) {
      if (error instanceof FillError && error.code === "api" && error.data.status === 404) return null;
      throw error;
    }
  }

  function check(request) {
    const code = /^[A-Z0-9]{3,4}$/;
    const fuel = request?.fuel;
    if (!code.test(upper(request?.origin)) || !code.test(upper(request?.destination)) || !modes.includes(request?.mode) ||
        (request.registration != null && !/^[A-Z0-9-]{2,12}$/.test(upper(request.registration))) ||
        (fuel != null && !(finite(fuel) && fuel >= 0 && fuel <= 2e6))) {
      throw new FillError("request");
    }
    return { origin: upper(request.origin), destination: upper(request.destination), mode: request.mode,
      registration: request.registration == null ? null : upper(request.registration), fuel: fuel ?? null };
  }

  // Oferta que a página deixaria adicionar a este voo, para o destino e o tipo escolhidos.
  function eligible(raw, flight, request, now) {
    if (!raw || typeof raw.id !== "string" || raw.blocked || raw.flightId || raw.user) return false;
    if (upper(raw.location) !== flight.from || upper(raw.destination) !== request.destination) return false;
    if (raw.type !== "PASSENGER" && raw.type !== "CARGO") return false;
    if ((request.mode === "passageiros" && raw.type !== "PASSENGER") || (request.mode === "carga" && raw.type !== "CARGO")) return false;
    const allowed = raw.allowedAircraftCategories;
    if (Array.isArray(allowed) && allowed.length && !(flight.category && allowed.includes(flight.category))) return false;
    const expiry = Date.parse(raw.expirationDate);
    if (!Number.isFinite(expiry) || expiry <= now + expiryMargin) return false;
    const weight = Number(raw.weight), price = Number(raw.price), quantity = Number(raw.quantity);
    if (!(weight > 0) || !(price >= 0)) return false;
    return raw.type === "CARGO" || (Number.isInteger(quantity) && quantity > 0);
  }

  async function collect({ api, wait, progress, now }, flight, request, weightLeft) {
    const found = new Map();
    let pages = 1, read = 0, truncated = false;
    for (let page = 1; page <= pages; page++) {
      if (page > maxPages) { truncated = true; break; }
      progress?.({ step: "ofertas", page, pages });
      const query = new URLSearchParams({ flightId: flight.id, page: String(page), limit: String(pageSize),
        sortBy: "distance", sortOrder: "asc", destination: request.destination });
      if (request.mode === "passageiros") query.set("type", "PASSENGER");
      if (request.mode === "carga") query.set("type", "CARGO");
      query.set("weightMax", String(Math.max(0, Math.floor(weightLeft))));
      const answer = await api("/goods/" + flight.from + "?" + query);
      const total = Number(answer?.pagination?.totalPages);
      if (!Array.isArray(answer?.data) || !Number.isInteger(total) || total < 0 || total > 500 ||
          Number(answer.pagination.page) !== page) {
        throw new FillError("api", { detail: "pagination" });
      }
      pages = Math.max(1, total);
      for (const raw of answer.data) {
        read++;
        if (eligible(raw, flight, request, now())) found.set(raw.id, good(raw));
      }
      if (page < pages) await wait(150);
    }
    return { offers: [...found.values()], read, truncated };
  }

  // Uma rodada: lê o voo e as ofertas, escolhe a melhor combinação e grava uma vez.
  async function round(tools, request, fuelPlan) {
    const { api, progress } = tools;
    progress?.({ step: "voo" });
    const flight = await current(api);
    if (!flight) throw new FillError("no-flight");
    if (flight.started) throw new FillError("started", { registration: flight.registration });
    if (flight.from !== request.origin) throw new FillError("origin", { from: flight.from, origin: request.origin });
    if (flight.to && flight.to !== request.destination) throw new FillError("destination", { to: flight.to, destination: request.destination });
    if (request.registration && flight.registration && flight.registration !== request.registration) {
      throw new FillError("aircraft", { registration: flight.registration, planned: request.registration });
    }
    const planned = fuelPlan === null ? 0 : flight.tank ? Math.min(fuelPlan, flight.tank) : fuelPlan;
    const fuel = Math.max(flight.fuel, planned);
    const weightLeft = flight.capacity - fuel - flight.weight;
    const seatsLeft = request.mode === "carga" ? 0 : Math.max(0, flight.seatLimit - flight.seats);
    const base = { flight, fuel, fuelSource: planned > flight.fuel ? "plano" : "tanque", weightLeft, seatsLeft };
    if (weightLeft < 1 || (request.mode === "passageiros" && seatsLeft < 1)) return { ...base, offers: [], read: 0, chosen: [], best: null };

    const { offers, read, truncated } = await collect(tools, flight, request, weightLeft);
    const best = VortexLoad.best(offers.map(offer => ({ weight: offer.weight, seats: offer.seats, payout: offer.price })),
      weightLeft, seatsLeft);
    const chosen = best.indexes.map(index => offers[index]);
    if (sum(chosen, "weight") > weightLeft + 1e-6 || sum(chosen, "seats") > seatsLeft) throw new FillError("internal");
    if (!chosen.length) return { ...base, offers, read, truncated, chosen, best };

    // Confere de novo logo antes de gravar: se o voo mudou (outra aba, combustível), não grava.
    progress?.({ step: "gravar", count: chosen.length });
    const before = await current(api);
    if (!before || signature(before) !== signature(flight)) throw new FillError("changed");
    const payload = { flightId: flight.id, goods: [...flight.loaded.map(item => item.id), ...chosen.map(item => item.id)] };
    let answer = null, writeError = null;
    try { answer = await api("/goods/flight/sync", payload); } catch (error) { writeError = error; }

    progress?.({ step: "conferir" });
    const after = await current(api);
    if (!after || after.id !== flight.id) throw new FillError("verify", { wrote: true });
    const aboard = new Set(after.loaded.map(item => item.id));
    const lost = flight.loaded.filter(item => !aboard.has(item.id)).length;
    const added = chosen.filter(item => aboard.has(item.id));
    const refused = chosen.filter(item => !aboard.has(item.id));
    if (writeError && !added.length) {
      const message = writeError.data?.message;
      throw new FillError(message === "flight_already_started" ? "started" : "write",
        { wrote: true, status: writeError.data?.status ?? null, message: message ?? null });
    }
    const reasons = Array.isArray(answer?.errors) ? [...new Set(answer.errors.map(error => String(error?.reason ?? "goods_in_another_flight")))] : [];
    return { ...base, offers, read, truncated, chosen, best, wrote: true, added, refused, reasons, lost, after };
  }

  // Até duas rodadas: se alguma oferta escolhida foi pega por outro piloto no meio do caminho, a segunda
  // rodada preenche o espaço que sobrou.
  async function run(tools, rawRequest) {
    const request = check(rawRequest);
    const now = tools.now || Date.now;
    const all = { ...tools, now, wait: tools.wait || (ms => new Promise(resolve => setTimeout(resolve, ms))) };
    const first = await round(all, request, request.fuel);
    let rounds = [first];
    if (first.wrote && first.refused.length) {
      try { rounds.push(await round(all, request, request.fuel)); } catch { /* fica o resultado da primeira rodada */ }
    }
    const last = rounds[rounds.length - 1];
    const flight = last.after || last.flight;
    const added = rounds.flatMap(item => item.added || []);
    return {
      ok: true, wrote: rounds.some(item => item.wrote),
      registration: first.flight.registration, origin: request.origin, destination: request.destination, mode: request.mode,
      fuel: first.fuel, fuelSource: first.fuelSource, capacity: first.flight.capacity,
      freeWeight: first.weightLeft, freeSeats: first.seatsLeft, seatLimit: first.flight.seatLimit,
      kept: first.flight.loaded.length, keptWeight: first.flight.weight, keptSeats: first.flight.seats,
      otherDestinations: first.flight.loaded.filter(item => item.destination && item.destination !== request.destination).length,
      read: first.read, offered: first.offers.length, truncated: Boolean(first.truncated),
      added: added.map(({ type, weight, seats, price }) => ({ type, weight, seats, price })),
      addedWeight: sum(added, "weight"), addedSeats: sum(added, "seats"), payout: sum(added, "price"),
      ratioFirstPayout: first.best ? first.best.ratioFirstPayout : 0, exhaustive: first.best ? first.best.exhaustive : true,
      refused: (last.refused || []).length, reasons: [...new Set(rounds.flatMap(item => item.reasons || []))],
      lost: rounds.reduce((total, item) => total + (item.lost || 0), 0),
      finalWeight: flight.fuel + flight.weight, finalSeats: flight.seats,
    };
  }

  function failure(error) {
    if (error instanceof FillError) return { ok: false, code: error.code, ...error.data };
    return { ok: false, code: "internal", detail: String(error?.message || error).slice(0, 200) };
  }

  return { run, failure, FillError, state, eligible, modes };
})();
