"use strict";

const VortexLoad = (() => {
  const maxLots = 200;
  // Todos os pesos do cenário usam a unidade escolhida. Inteiros evitam erro de arredondamento nos limites.
  const mass = value => Math.round(value * 1000);
  const cents = value => Math.round(value * 100);
  const decimal = (text, digits) => /^\d+$/.test(text) ? Number(text)
    : /^\d+[.,]\d+$/.test(text) && text.split(/[.,]/)[1].length <= digits ? Number(text.replace(",", ".")) : NaN;

  function parseLots(text) {
    const lots = [];
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      if (!raw.trim()) continue;
      if (lots.length === maxLots) return { error: "lot-limit" };
      const fields = raw.trim().split(/[|;\t]/).map(value => value.trim());
      const [weight, seats, payout] = fields.map((value, index) => decimal(value, [3, 0, 2][index]));
      if (fields.length !== 3 || !(weight > 0 && weight <= 2e6) ||
          !Number.isInteger(seats) || seats > 2000 || !(payout >= 0 && payout <= 1e9)) {
        return { error: "lot-format", line: index + 1 };
      }
      lots.push({ line: index + 1, weight: mass(weight), seats, payout: cents(payout) });
    }
    return { lots };
  }

  function selectLots(lots, weightLimit, seatLimit) {
    const eligible = lots.filter(lot => lot.weight <= weightLimit && lot.seats <= seatLimit && lot.payout > 0);
    const density = lot => lot.payout / lot.weight;
    const byScore = score => [...eligible].sort((a, b) => score(b) - score(a) || a.line - b.line);
    const byWeightValue = byScore(density);
    const seatWeight = weightLimit / Math.max(1, seatLimit);
    let best = { items: [], weight: 0, seats: 0, payout: 0 };
    for (const order of [byWeightValue, byScore(lot => lot.payout),
      byScore(lot => lot.payout / (lot.weight + lot.seats * seatWeight))]) {
      const candidate = { items: [], weight: 0, seats: 0, payout: 0 };
      for (const lot of order) {
        if (candidate.weight + lot.weight > weightLimit || candidate.seats + lot.seats > seatLimit) continue;
        candidate.items.push(lot);
        candidate.weight += lot.weight;
        candidate.seats += lot.seats;
        candidate.payout += lot.payout;
      }
      if (candidate.payout > best.payout) best = candidate;
    }

    // Limite otimista: permite uma fração do último lote e ignora assentos.
    function upperBound(index, room, payout) {
      for (let i = index; i < byWeightValue.length && room > 0; i++) {
        const lot = byWeightValue[i];
        payout += lot.payout * Math.min(1, room / lot.weight);
        room -= lot.weight;
      }
      return payout;
    }

    const stack = [];
    let budget = 25000;
    function search(index, weight, seats, payout) {
      if (budget <= 0) return;
      budget--;
      if (payout > best.payout) best = { items: [...stack], weight, seats, payout };
      if (index === byWeightValue.length || upperBound(index, weightLimit - weight, payout) <= best.payout) return;
      const lot = byWeightValue[index];
      if (weight + lot.weight <= weightLimit && seats + lot.seats <= seatLimit) {
        stack.push(lot);
        search(index + 1, weight + lot.weight, seats + lot.seats, payout + lot.payout);
        stack.pop();
      }
      search(index + 1, weight, seats, payout);
    }
    search(0, 0, 0, 0);
    best.items.sort((a, b) => a.line - b.line);
    return { ...best, exhaustive: budget > 0 };
  }

  function simulate({ limit, tank, fuel, seatLimit, loadedWeight, loadedSeats,
    loadedPayout, costs, minutes, text }) {
    const parsed = parseLots(text);
    if (parsed.error) return parsed;
    if (tank !== null && fuel > tank) return { error: "tank" };
    if (loadedSeats > seatLimit) return { error: "seats" };
    const weightBudget = mass(limit) - mass(fuel) - mass(loadedWeight);
    if (weightBudget < 0) return { error: "weight" };
    const selected = selectLots(parsed.lots, weightBudget, seatLimit - loadedSeats);
    const gross = cents(loadedPayout) + selected.payout;
    const net = costs === null ? null : gross - cents(costs);
    return {
      items: selected.items.map(lot => lot.line), exhaustive: selected.exhaustive,
      gross: gross / 100, net: net === null ? null : net / 100,
      perHour: net === null || !minutes ? null : net * 0.6 / minutes,
      remainingWeight: (weightBudget - selected.weight) / 1000,
      remainingSeats: seatLimit - loadedSeats - selected.seats,
      offered: parsed.lots.length,
    };
  }

  return { simulate };
})();
