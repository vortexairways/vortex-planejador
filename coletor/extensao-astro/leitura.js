"use strict";
// Leitor da aba Vagas da Vortex no PilOps. A extensão injeta este arquivo na página; os testes o carregam
// num contexto isolado. Só lê o que a tabela mostra: código, cidade, tamanho, barras de carga e passageiros,
// rotas e validade. Para quem não é dono da companhia, carga, passageiros e rotas aparecem como "—".
globalThis.VortexStandsReader = (() => {
  const companyPath = "/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1";
  const months = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
    set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
  const sizeNames = { large: "large", grande: "large", medium: "medium", "médio": "medium", medio: "medium",
    small: "small", pequeno: "small" };

  // "1.234" e "1,234" são milhar; "12,5" e "1.2" são decimais; "3,5k" é 3500.
  function number(raw) {
    let text = String(raw).trim().replace(/\s+/g, "").replace(/[.,]$/, "");
    let factor = 1;
    const suffix = /[kKmM]$/.exec(text);
    if (suffix) { factor = /k/i.test(suffix[0]) ? 1e3 : 1e6; text = text.slice(0, -1); }
    if (/^\d{1,3}([.,]\d{3})+$/.test(text) && !suffix) return Number(text.replace(/[.,]/g, ""));
    if (/^\d+([.,]\d+)?$/.test(text)) return Number(text.replace(",", ".")) * factor;
    return NaN;
  }

  // Lê uma barra a partir do texto visível (e de title/aria-label). Aceita "1.234 / 5.000 lbs", "12 de 40",
  // "80%", "1.234 lbs" e "Lotada". "ratio" é o preenchimento medido na própria barra, quando não há texto.
  function amount(text, ratio) {
    const clean = String(text ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    if (!clean && !Number.isFinite(ratio)) return null;
    if (/^[—–-]+$/.test(clean) && !Number.isFinite(ratio)) return null;
    const result = { text: clean.slice(0, 80) };
    const unit = /kg\b/i.test(clean) ? "kg" : /lbs?\b/i.test(clean) ? "lb" : null;
    if (unit) result.unit = unit;
    const percent = /(\d+(?:[.,]\d+)?)\s*%/.exec(clean);
    const stripped = clean.replace(/\d+(?:[.,]\d+)?\s*%/g, " ").replace(/(lbs?|kg)\b/gi, " ");
    const values = [...stripped.matchAll(/\d[\d.,]*[kKmM]?(?![\w])/g)].map(match => number(match[0])).filter(Number.isFinite);
    const pair = /\d[\d.,]*[kKmM]?\s*(?:\/|\bde\b|\bof\b)\s*\d/i.test(stripped);
    if (pair && values.length >= 2) { result.value = values[0]; result.max = values[1]; }
    else if (values.length) result.value = values[0];
    if (percent) result.pct = number(percent[1]);
    else if (result.max > 0) result.pct = Math.round(result.value / result.max * 1000) / 10;
    else if (Number.isFinite(ratio)) result.pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 1000) / 10;
    if (/\b(lotad[ao]|chei[ao]|full)\b/i.test(clean) || result.pct >= 100) result.full = true;
    return result;
  }

  // "16 dez 2026" vira "2026-12-16".
  function expiry(text) {
    const match = /(\d{1,2})\s+([a-zç]{3})[a-zç.]*\s+(\d{4})/i.exec(String(text ?? ""));
    const month = match && months[match[2].toLowerCase()];
    return month ? match[3] + "-" + String(month).padStart(2, "0") + "-" + match[1].padStart(2, "0") : null;
  }

  // Rotas ligadas à vaga: códigos VTX e aeroportos de destino que aparecem na célula. O dono vê "0 / 10"
  // (rotas ligadas / máximo da vaga), lido em "count" e "limit".
  function routesOf(text, origin) {
    const clean = String(text ?? "").replace(/ /g, " ").trim();
    if (!clean || /^[—–-]+$/.test(clean)) return null;
    const codes = [...new Set(clean.match(/\bVTX\d{3,5}\b/g) || [])];
    const destinations = [...new Set((clean.match(/\b[A-Z][A-Z0-9]{3}\b/g) || []).filter(code => code !== origin && !/^VTX/.test(code)))];
    const slots = /^(\d+)\s*\/\s*(\d+)\b/.exec(clean);
    const count = Number(slots?.[1] ?? /(\d+)\s+rotas?/i.exec(clean)?.[1]);
    return { codes, destinations, count: Number.isInteger(count) ? count : codes.length || destinations.length,
      ...(slots ? { limit: Number(slots[2]) } : {}), text: clean.slice(0, 120) };
  }

  function cellText(cell) {
    const parts = [cell.innerText];
    for (const el of cell.querySelectorAll("[title],[aria-label],[aria-valuetext]")) {
      for (const name of ["title", "aria-label", "aria-valuetext"]) parts.push(el.getAttribute(name));
    }
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function barReading(cell) {
    if (!cell) return null;
    const bar = cell.querySelector('[role="progressbar"], progress, meter');
    let ratio, barValue, barMax;
    if (bar) {
      barValue = Number(bar.getAttribute("aria-valuenow") ?? bar.value);
      barMax = Number(bar.getAttribute("aria-valuemax") ?? bar.max ?? 100) || 100;
      if (Number.isFinite(barValue)) ratio = barValue / barMax;
    }
    if (!Number.isFinite(ratio)) {
      const widths = [...cell.querySelectorAll("[style*='width']")]
        .map(el => /width:\s*([\d.]+)%/.exec(el.getAttribute("style") || "")?.[1]).filter(Boolean);
      if (widths.length) ratio = Number(widths.at(-1)) / 100;
    }
    const result = amount(cellText(cell), ratio);
    if (result && Number.isFinite(barValue) && barMax !== 100 && result.max === undefined) {
      result.value ??= barValue;
      result.max = barMax;
    }
    return result;
  }

  const filled = reading => Boolean(reading && (reading.value !== undefined || reading.pct !== undefined || reading.full));

  function readPage(doc = document) {
    // Fora da página da Vortex (por exemplo, redirecionado ao login do PilOps).
    if (doc.location.origin !== "https://pilops.com" || doc.location.pathname !== companyPath) return { state: "page" };
    const tab = [...doc.querySelectorAll('[role="tab"]')].find(el => el.innerText.trim() === "Vagas");
    if (!tab) return { state: "loading" };
    if (tab.getAttribute("aria-selected") !== "true") { tab.click(); return { state: "loading" }; }
    const table = [...doc.querySelectorAll("table")].find(el => /\bVAGA\b/i.test(el.querySelector("thead")?.innerText || ""));
    if (!table) {
      [...doc.querySelectorAll("button")].find(el => el.innerText.trim() === "Tabela")?.click();
      return { state: "loading" };
    }
    const head = [...table.querySelectorAll("thead th")].map(th => th.innerText.trim().toUpperCase());
    const column = name => head.findIndex(title => title.startsWith(name));
    const at = { stand: column("VAGA"), size: column("TAMANHO"), cargo: column("CARGA"), pax: column("PASSAGEIRO"),
      routes: column("ROTA"), expires: column("EXPIRA") };
    if (Object.values(at).some(index => index < 0)) return { state: "columns", head };
    const total = Number(/(\d+)\s+Vagas\b/.exec(doc.body.innerText)?.[1]);
    const stands = [];
    let sample = null;
    for (const row of table.querySelectorAll("tbody tr")) {
      const cells = row.querySelectorAll("td");
      const lines = (cells[at.stand]?.innerText || "").split("\n").map(line => line.trim()).filter(Boolean);
      const code = (lines[0] || "").replace(/\s+/g, "");
      const match = /^([A-Z0-9]{3,5})-(.+)$/.exec(code);
      if (!match) return { state: "row", text: lines.join(" | ").slice(0, 120) };
      const icon = cells[at.stand].querySelector("img[alt^='Stand type']")?.getAttribute("alt").split(" ").pop() || "";
      const sizeText = (cells[at.size]?.innerText || "").trim();
      const stand = {
        code, airport: match[1], city: lines[1] || null,
        size: sizeNames[icon.toLowerCase()] || sizeNames[sizeText.toLowerCase()] || null,
        cargo: barReading(cells[at.cargo]), pax: barReading(cells[at.pax]),
        routes: routesOf(cellText(cells[at.routes]), match[1]),
        expires: expiry(cells[at.expires]?.innerText),
      };
      if (!sample && (filled(stand.cargo) || filled(stand.pax) || cellText(cells[at.cargo]).replace(/[—–-]/g, "").trim())) {
        sample = { code, cargo: cells[at.cargo].innerHTML.slice(0, 1500), pax: cells[at.pax].innerHTML.slice(0, 1500),
          routes: cells[at.routes].innerHTML.slice(0, 600) };
      }
      stands.push(stand);
    }
    if (!stands.length || !Number.isInteger(total) || stands.length !== total) return { state: "loading", seen: stands.length, total };
    return { state: "ok", total, stands, sample, withValues: stands.filter(stand => filled(stand.cargo) || filled(stand.pax)).length };
  }

  return { number, amount, expiry, routesOf, readPage };
})();
