"use strict";

const VortexLoad = (() => {
  const maxLots = 200;
  // Todos os pesos do cenário usam a unidade escolhida. Inteiros evitam erro de arredondamento nos limites.
  const mass = value => Math.round(value * 1000);
  const cents = value => Math.round(value * 100);
  // Aceita o que o PilOps mostra: "P$ 1,234.56", "1.200 LBS", "59,000". Grupos de três dígitos são milhar,
  // nunca decimais: "1,200" é mil e duzentos, e não 1,2.
  function decimal(raw, digits) {
    const text = raw.replace(/^P\$\s*/i, "").replace(/\s*(lbs?|kg)\.?$/i, "").replace(/\s+/g, "");
    if (/^\d+$/.test(text)) return Number(text);
    const dot = text.lastIndexOf("."), comma = text.lastIndexOf(",");
    if (dot >= 0 && comma >= 0) {
      const point = Math.max(dot, comma), thousands = point === dot ? "," : ".";
      const whole = text.slice(0, point), fraction = text.slice(point + 1);
      const grouped = thousands === "," ? /^(0|[1-9]\d{0,2}(,\d{3})*)$/ : /^(0|[1-9]\d{0,2}(\.\d{3})*)$/;
      return grouped.test(whole) && /^\d+$/.test(fraction) && fraction.length <= digits
        ? Number(whole.split(thousands).join("") + "." + fraction) : NaN;
    }
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text) || /^[1-9]\d{0,2}(,\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ""));
    return /^\d+[.,]\d+$/.test(text) && text.split(/[.,]/)[1].length <= digits ? Number(text.replace(",", ".")) : NaN;
  }

  // Peso na unidade do cenário: "1.200 LBS" vira kg quando o cenário está em kg (e vice-versa).
  const kgPerPound = 0.45359237;
  function weightIn(raw, unit) {
    const value = decimal(raw, 3), suffix = /(lbs?|kg)\.?\s*$/i.exec(raw)?.[1].toLowerCase();
    if (!suffix || (suffix === "kg") === (unit === "kg")) return value;
    return unit === "kg" ? value * kgPerPound : value / kgPerPound;
  }
  const validLot = ({ weight, seats, payout }) => weight > 0 && weight <= 2e6 && Number.isInteger(seats) && seats <= 2000 &&
    payout >= 0 && payout <= 1e9;

  // Lista copiada da tela "Selecione carga & rota" do PilOps. Cada oferta vem em linhas:
  //   "22 Passageiro(s)" ou "Cargo", [etiqueta], [VTX0090], destino, "P$ 80,056.57", "1.590 NM", "4.224 LBS",
  //   "Adicionar" ou "Aceita apenas Jatos" + "Bloqueado".
  // Ofertas bloqueadas e as de outro destino ficam de fora. "line" é a posição da oferta na lista colada.
  const offerStart = /^(?:(\d+)\s+(?:passageiros?|passengers?|pasajeros?)(?:\(s\))?|cargo|carga)$/i;
  const isPilops = lines => !lines.some(line => /[|;\t]/.test(line)) && lines.some(line => offerStart.test(line.trim())) &&
    lines.some(line => /^P\$/i.test(line.trim()));
  function parsePilops(lines, unit, destination) {
    const offers = [];
    let offer = null, previous = "";
    for (const [index, raw] of lines.entries()) {
      const line = raw.trim();
      if (!line) continue;
      const start = offerStart.exec(line);
      if (start) {
        offer = { line: offers.length + 1, textLine: index + 1, seats: start[1] ? Number(start[1]) : 0, blocked: false };
        offers.push(offer);
      } else if (offer) {
        if (/^P\$/i.test(line)) {
          offer.payout = decimal(line, 2);
          if (/^[A-Z0-9]{3,5}$/.test(previous)) offer.destination = previous;
        } else if (/^[\d.,]+\s*(lbs?|kg)\.?$/i.test(line)) offer.weight = weightIn(line, unit);
        else if (/^(bloqueado|blocked|bloqueada)$/i.test(line)) offer.blocked = true;
      }
      previous = line;
    }
    const lots = [];
    let ignored = 0, blocked = 0;
    for (const item of offers) {
      if (!validLot(item)) return { error: "lot-format", line: item.textLine };
      if (item.blocked) { blocked++; continue; }
      if (destination && item.destination && item.destination !== destination) { ignored++; continue; }
      if (lots.length === maxLots) return { error: "lot-limit" };
      lots.push({ line: item.line, weight: mass(item.weight), seats: item.seats, payout: cents(item.payout) });
    }
    return { lots, format: "pilops", ignored, blocked };
  }

  function parseLots(text, unit = "lb", destination = null) {
    const lines = text.split(/\r?\n/);
    if (isPilops(lines)) return parsePilops(lines, unit, destination);
    const lots = [];
    for (const [index, raw] of lines.entries()) {
      if (!raw.trim()) continue;
      if (lots.length === maxLots) return { error: "lot-limit" };
      const fields = raw.trim().split(/[|;\t]/).map(value => value.trim());
      const lot = { weight: weightIn(fields[0], unit), seats: decimal(fields[1] ?? "", 0), payout: decimal(fields[2] ?? "", 2) };
      if (fields.length !== 3 || !validLot(lot)) return { error: "lot-format", line: index + 1 };
      lots.push({ line: index + 1, weight: mass(lot.weight), seats: lot.seats, payout: cents(lot.payout) });
    }
    return { lots, format: "table", ignored: 0, blocked: 0 };
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
    loadedPayout, costs, minutes, text, unit = "lb", destination = null }) {
    const parsed = parseLots(text, unit, destination);
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
      grossPerHour: minutes ? gross * 0.6 / minutes : null,
      remainingWeight: (weightBudget - selected.weight) / 1000,
      remainingSeats: seatLimit - loadedSeats - selected.seats,
      offered: parsed.lots.length, format: parsed.format, ignored: parsed.ignored, blocked: parsed.blocked,
    };
  }

  return { simulate };
})();
