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
        new URL(tab.url).searchParams.get("tab") === { Frota:"fleet", Hangares:"hangars", Hubs:"hubs", Rotas:"routes" }[name];
    } catch { /* Wait for the company's page to finish loading. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("A aba " + name + " não carregou por completo. Confira a sessão do PilOps.");
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
    await local("snapshot", {
      lease: job.lease,
      fleet: fleet.map(p => ({ ...p, base: hangars[p.prefix] ?? null })),
      reportedFleet, hubs, routes,
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
