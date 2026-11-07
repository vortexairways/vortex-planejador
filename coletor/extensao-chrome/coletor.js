const company = "https://pilops.com/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1";
const alarm = "vortex-coletor";
let busy = false;

async function local(path, data) {
  const response = await fetch("http://127.0.0.1:8768/" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error("O serviço local da Vortex não está disponível.");
  return response.json();
}

// Executada na página. Lê apenas os campos visíveis e os elementos das abas da Vortex.
function readCompany(section, openTab) {
  if (location.origin !== "https://pilops.com" ||
      location.pathname !== "/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1") return null;
  const heading = [...document.querySelectorAll("h1")].find(el => /Vortex Airways/i.test(el.innerText));
  if (!heading) return null;
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const tab = tabs.find(el => el.innerText.trim() === section);
  if (!tab) return null;
  if (tab.getAttribute("aria-selected") !== "true") {
    if (openTab) tab.click();
    return null;
  }
  const body = document.body.innerText;
  const split = el => el.innerText.split("\n").map(t => t.trim()).filter(Boolean);
  if (section === "Frota") {
    const reportedFleet = Number(body.match(/(?:^|\n)FROTA\s*\n\s*(\d+)/i)?.[1]);
    const buttons = [...document.querySelectorAll('img[alt^="Aircraft "]')]
      .map(img => ({ img, button: img.closest("button") })).filter(x => x.button);
    const fleet = buttons.map(({ img, button }) => {
      const lines = split(button);
      const model = img.alt.slice("Aircraft ".length);
      const prefix = lines.find(t => /^N[A-Z0-9]{5}$/.test(t));
      const fuel = lines.findIndex(t => /^\d+%$/.test(t));
      const airport = lines[fuel - 1];
      const flags = ["MANUTENÇÃO", "EM USO", "FORA DA ÁREA"].filter(status => lines.includes(status));
      for (const part of ["Motor", "Freios", "Pneus"]) {
        if (lines[lines.indexOf(part) + 1] === "ATENÇÃO") flags.push("Atenção em " + part.toLowerCase());
      }
      return prefix && /^[A-Z0-9]{3,5}$/.test(airport || "")
        ? { prefix, model, airport, status: flags.join(" · ") || "Sem alerta no cartão" } : null;
    });
    if (!fleet.length || fleet.some(p => !p) || !Number.isInteger(reportedFleet) ||
        reportedFleet < fleet.length || reportedFleet - fleet.length > 1) return null;
    return { fleet, reportedFleet };
  }
  if (section === "Hangares") {
    const cards = [...document.querySelectorAll('[role="button"][aria-label]')]
      .filter(el => /^[A-Z0-9]{3,5}$/.test(el.getAttribute("aria-label")));
    if (!cards.length) return null;
    return Object.fromEntries(cards.flatMap(card => split(card)
      .filter(value => /^N[A-Z0-9]{5}$/.test(value))
      .map(prefix => [prefix, card.getAttribute("aria-label")])));
  }
  if (section === "Hubs") {
    const expected = Number(body.match(/(?:^|\n)HUBS\s*\n\s*(\d+)/i)?.[1]);
    const hubs = [...new Set([...document.querySelectorAll('a[href*="/hubs/"]')]
      .filter(el => el.href.includes("/cmpi0v4et3bukpl0d9hgcj5o1/hubs/"))
      .map(el => split(el)[0]?.split(/\s+/)[0])
      .filter(code => /^[A-Z0-9]{3,5}$/.test(code || "")))];
    return hubs.length && hubs.length === expected ? hubs : null;
  }
  if (section === "Rotas") {
    const codes = [...document.querySelectorAll("p")].filter(el =>
      el.getClientRects().length && /^VTX\d+$/.test(el.innerText.trim()));
    const expected = Number(body.match(/(?:^|\n)\s*(\d+)\s+rotas?\s*(?:\n|$)/i)?.[1]);
    if (!codes.length || codes.length !== expected) return null;
    const routes = [];
    for (const code of codes) {
      const airports = code.parentElement.firstElementChild.innerText.trim().split(/\s+/);
      const row = code.closest(".rounded-lg");
      const status = row?.innerText.match(/(?:Status\s*|\n)(Ativo|Inativo|Ativa|Inativa)\s*$/i)?.[1];
      if (airports.length !== 2 || airports.some(value => !/^[A-Z0-9]{3,5}$/.test(value)) || !status) return null;
      if (/^ativ/i.test(status)) routes.push({ origin: airports[0], destination: airports[1], code: code.innerText.trim() });
    }
    return routes;
  }
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const isoDay = (mon, dayNumber, year) => months[mon.toLowerCase()]
    ? year + "-" + String(months[mon.toLowerCase()]).padStart(2, "0") + "-" + String(dayNumber).padStart(2, "0") : null;
  const pilotLine = /^@[\w.-]{1,40}$/;
  if (section === "Pilotos") {
    // Painel de pilotos. Desde 04/11/2026 é uma tabela: os títulos (HORAS TOTAIS DE VOO, HORAS NA EMPRESA,
    // DATA DE ENTRADA) aparecem uma vez só e cada piloto vem como @nome, ADMIN (opcional), país, horas totais,
    // horas na empresa e data de entrada. O formato antigo (título repetido em cada cartão) continua aceito.
    const start = body.indexOf("Painel de pilotos");
    if (start < 0) return null;
    const lines = body.slice(start).split("\n").map(t => t.trim()).filter(Boolean);
    const expected = Number(body.slice(start).match(/(\d+)\s+pilotos?\s+cadastrados?/i)?.[1]);
    const clock = value => { const m = /^(\d+):(\d{2})$/.exec(value || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
    const date = value => { const m = /^([A-Za-z]{3})\w*\s+(\d{1,2}),\s+(\d{4})$/.exec(value || ""); return m ? isoDay(m[1], m[2], m[3]) : null; };
    const pilots = [];
    for (let i = 0; i < lines.length; i++) {
      if (!pilotLine.test(lines[i])) continue;
      const block = lines.slice(i + 1, i + 12);
      const next = block.findIndex(t => pilotLine.test(t));
      const own = next < 0 ? block : block.slice(0, next);
      const labelled = name => { const at = own.findIndex(t => t.toUpperCase().startsWith(name)); return at < 0 ? null : clock(own[at + 1]); };
      const clocks = own.map(clock).filter(value => value !== null);
      const pilot = {
        name: lines[i].slice(1), role: own.includes("ADMIN") ? "ADMIN" : null,
        level: Number(own.find(t => /^Nv\.\s*\d+$/.test(t))?.match(/\d+/)?.[0]) || null,
        totalMinutes: labelled("HORAS TOTAIS") ?? clocks[0] ?? null,
        companyMinutes: labelled("HORAS NA EMPRESA") ?? clocks[1] ?? null,
        joined: date(own.find(t => date(t))),
      };
      if (pilot.totalMinutes === null || pilot.companyMinutes === null) return null;
      pilots.push(pilot);
    }
    return pilots.length && pilots.length === expected ? pilots : null;
  }
  if (section === "Voos") {
    // Histórico de voos (o PilOps mostra os 10 últimos): modelo, prefixo, @piloto, Rota, origem, destino,
    // data, duração, distância, carga e receita. O PilOps muda o layout conforme a largura da janela:
    //   estreita: "Data: Nov 07, 2026", 08:27, …
    //   larga:    "Data", "Nov 07, 2026", "Prefixo", "NTXJ5N", 08:27, …
    // Por isso cada campo é procurado pelo formato dentro do bloco do voo, e não por posição.
    // A aba também tem "Voos ativos" (em andamento, com data "--"): essa seção é cortada fora e
    // qualquer bloco de voo em andamento é ignorado.
    const start = body.indexOf("Histórico de voos");
    if (start < 0) return null;
    const active = body.indexOf("Voos ativos", start);
    const lines = body.slice(start, active < 0 ? undefined : active).split("\n").map(t => t.trim()).filter(Boolean);
    const flights = [];
    for (let i = 0; i < lines.length; i++) {
      if (!pilotLine.test(lines[i])) continue;
      const [prefix, model] = [lines[i - 1], lines[i - 2]];
      // Bloco deste voo: até o @piloto seguinte, sem as duas linhas (modelo e prefixo) do próximo voo.
      const next = lines.findIndex((t, at) => at > i && pilotLine.test(t));
      const rest = lines.slice(i + 1, next < 0 ? i + 16 : next - 2);
      if (rest.some(t => /^(Data:?\s*)?-{2,}$/.test(t))) continue;
      const find = pattern => rest.map(t => pattern.exec(t)).find(Boolean);
      const day = find(/^(?:Data:\s*)?([A-Za-z]{3})\w*\s+(\d{1,2}),\s+(\d{4})$/);
      const time = find(/^(\d+):(\d{2})$/);
      const nm = find(/^([\d.,]+)\s*nm$/i);
      const lbs = find(/^([\d.,]+)\s*lbs$/i);
      const money = find(/^P\$\s*(-?[\d,]+(?:\.\d+)?)$/);
      if (rest[0] !== "Rota" || !/^[A-Z0-9]{3,5}$/.test(rest[1] || "") || !/^[A-Z0-9]{3,5}$/.test(rest[2] || "") ||
          !day || !isoDay(day[1], day[2], day[3]) || !time || !nm || !money || !/^[A-Z0-9-]{2,12}$/.test(prefix || "")) {
        // Guardado no mundo isolado da extensão para o diagnóstico de section() mostrar o bloco recusado.
        window.__vortexRecusado = [model, prefix, lines[i], ...rest].join(" | ").slice(0, 400);
        return null;
      }
      flights.push({
        pilot: lines[i].slice(1), prefix, model, origin: rest[1], destination: rest[2], date: isoDay(day[1], day[2], day[3]),
        minutes: Number(time[1]) * 60 + Number(time[2]), nm: Math.round(Number(nm[1].replace(/,/g, "")) * 100) / 100,
        // Carga no formato brasileiro (39.063,77); receita no americano (4,616,708.05).
        payload: lbs ? Math.round(Number(lbs[1].replace(/\./g, "").replace(",", "."))) : null,
        revenue: Math.round(Number(money[1].replace(/,/g, "")) * 100) / 100,
      });
    }
    return flights;
  }
  return null;
}

async function section(tabId, name) {
  const deadline = Date.now() + 25_000;
  let opened = false;
  while (Date.now() < deadline) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId }, func: readCompany, args: [name, !opened],
      });
      if (result !== null && result !== undefined) return result;
      const tab = await chrome.tabs.get(tabId);
      opened = tab.url?.startsWith(company + "?tab=") &&
        new URL(tab.url).searchParams.get("tab") === { Frota:"fleet", Hangares:"hangars", Hubs:"hubs", Rotas:"routes", Pilotos:"pilots", Voos:"flights" }[name];
    } catch { /* Wait for the company's page to finish loading. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  // Diagnóstico curto do que a página mostrava, para o serviço local exibir no terminal.
  let seen = "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const body = document.body.innerText;
      const selected = document.querySelector('[role="tab"][aria-selected="true"]')?.innerText.trim() || "nenhuma";
      const start = body.indexOf("Histórico de voos");
      return "aba aberta: " + selected + "; " + location.search + "; " +
        body.split("\n").filter(t => /^@[\w.-]{1,40}$/.test(t.trim())).length + " linhas com @piloto" +
        (window.__vortexRecusado ? "; bloco recusado: " + window.__vortexRecusado
          : start >= 0 ? "; início do histórico: " + body.slice(start, start + 300).replace(/\n+/g, " | ") : "");
    } });
    seen = " (v" + chrome.runtime.getManifest().version + "; " + result + ")";
  } catch { /* sem diagnóstico */ }
  throw new Error("A aba " + name + " não carregou por completo" + seen + ".");
}

async function run() {
  if (busy) return;
  busy = true;
  let tab;
  let job;
  try {
    try {
      job = await local("job", {});
    } catch {
      // O coletor local só fica ligado durante a sincronização; fora dela a extensão fica em silêncio.
      job = {};
    }
    if (!job.lease) return;
    await chrome.action.setBadgeText({ text: "…" });
    tab = await chrome.tabs.create({ url: company, active: false });
    const { fleet, reportedFleet } = await section(tab.id, "Frota");
    const hangars = await section(tab.id, "Hangares");
    const hubs = await section(tab.id, "Hubs");
    const routes = await section(tab.id, "Rotas");
    // Pilotos e voos são opcionais: se a aba não carregar, a frota e as rotas são publicadas assim mesmo.
    const notes = [];
    const optional = name => section(tab.id, name).catch(error => { notes.push(error.message); return null; });
    const pilots = await optional("Pilotos");
    const flights = await optional("Voos");
    await local("snapshot", {
      lease: job.lease,
      fleet: fleet.map(p => ({ ...p, base: hangars[p.prefix] ?? null })),
      reportedFleet, hubs, routes, pilots, flights, notes,
    });
    await chrome.action.setBadgeText({ text: "OK" });
    await chrome.action.setTitle({ title: "Vortex · coleta concluída" });
  } catch (error) {
    if (job?.lease) await local("failed", { lease: job.lease }).catch(() => {});
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setTitle({ title: "Vortex · " + error.message });
  } finally {
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
    busy = false;
  }
}

async function setup() {
  if (!await chrome.alarms.get(alarm)) await chrome.alarms.create(alarm, { periodInMinutes: 1 });
  await run();
}
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener(event => { if (event.name === alarm) void run(); });
