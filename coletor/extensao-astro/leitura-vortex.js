"use strict";
// Leitura da Vortex no PilOps, usada pelas duas extensões:
//   - o coletor do Rafael (extensao-chrome/coletor.js, por importScripts);
//   - a extensão do dono (extensao-astro/servico.js, por import). A cópia em extensao-astro é gerada por
//     tools/empacotar-extensao-vagas.ps1 e o teste tools/vagas.test.mjs confere que é idêntica.
const company = "https://pilops.com/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1";

// Executada na página. Lê apenas os campos visíveis e os elementos das abas da Vortex.
function readCompany(section, openTab) {
  // Página fora da Vortex ou aba de Rotas fora da tela: a contagem de leituras estáveis das rotas recomeça
  // (segunda revisão do Codex, 28/11).
  const notYet = () => { if (section === "Rotas") window.__vortexRotas = null; return null; };
  if (location.origin !== "https://pilops.com" ||
      location.pathname !== "/pt-BR/app/companies/cmpi0v4et3bukpl0d9hgcj5o1") return notYet();
  const heading = [...document.querySelectorAll("h1")].find(el => /Vortex Airways/i.test(el.innerText));
  if (!heading) return notYet();
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const tab = tabs.find(el => el.innerText.trim() === section);
  if (!tab) return notYet();
  if (tab.getAttribute("aria-selected") !== "true") {
    if (openTab) tab.click();
    return notYet();
  }
  const body = document.body.innerText;
  const split = el => el.innerText.split("\n").map(t => t.trim()).filter(Boolean);
  // Motivo da última recusa desta leitura (aparece no erro como "bloco recusado"): começa limpo a cada leitura,
  // para o erro nunca mostrar o motivo velho de outra aba.
  window.__vortexRecusado = null;
  const refuse = (reason, el) => {
    window.__vortexRecusado = (section.toLowerCase() + ": " + reason + (el ? " | linha: " + split(el).join(" | ") : "")).slice(0, 600);
    return null;
  };
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
    if (!fleet.length) return refuse("nenhum cartão de aeronave");
    const odd = fleet.findIndex(p => !p);
    if (odd >= 0) return refuse("cartão de aeronave sem matrícula ou aeroporto", buttons[odd].button);
    if (!Number.isInteger(reportedFleet)) return refuse("a página não mostra o total da frota");
    if (reportedFleet < fleet.length || reportedFleet - fleet.length > 1) {
      return refuse(fleet.length + " cartões, a página diz " + reportedFleet + " aeronaves");
    }
    return { fleet, reportedFleet };
  }
  if (section === "Hangares") {
    // Cada hangar diz quantas vagas estão ocupadas ("2/2 Vagas") e lista as matrículas: as duas contas precisam
    // bater, senão as matrículas ainda estão carregando (conferido na página real em 28/11/2026: 25 hangares).
    const cards = [...document.querySelectorAll('[role="button"][aria-label]')]
      .filter(el => /^[A-Z0-9]{3,5}$/.test(el.getAttribute("aria-label")));
    if (!cards.length) return refuse("nenhum hangar");
    const bases = [];
    for (const card of cards) {
      const lines = split(card);
      const prefixes = lines.filter(value => /^N[A-Z0-9]{5}$/.test(value));
      const occupied = lines.map(t => /^(\d+)\s*\/\s*\d+\s+vagas?$/i.exec(t)).find(Boolean);
      if (occupied && Number(occupied[1]) !== prefixes.length) {
        return refuse(card.getAttribute("aria-label") + " com " + occupied[1] + " vagas ocupadas e " + prefixes.length + " matrículas", card);
      }
      for (const prefix of prefixes) bases.push([prefix, card.getAttribute("aria-label")]);
    }
    // Nenhuma matrícula em hangar nenhum é a lista ainda carregando (segunda revisão do Codex, 28/11).
    if (!bases.length) return refuse("nenhuma matrícula nos hangares (a lista ainda pode estar carregando)");
    return Object.fromEntries(bases);
  }
  if (section === "Hubs") {
    const expected = Number(body.match(/(?:^|\n)HUBS\s*\n\s*(\d+)/i)?.[1]);
    const hubs = [...new Set([...document.querySelectorAll('a[href*="/hubs/"]')]
      .filter(el => el.href.includes("/cmpi0v4et3bukpl0d9hgcj5o1/hubs/"))
      .map(el => split(el)[0]?.split(/\s+/)[0])
      .filter(code => /^[A-Z0-9]{3,5}$/.test(code || "")))];
    return hubs.length && hubs.length === expected ? hubs
      : refuse(hubs.length + " hubs lidos, a página diz " + (Number.isInteger(expected) ? expected : "nenhum total"));
  }
  if (section === "Rotas") {
    // Cada rota é uma linha: "ORIG → DEST" + código VTX, descrição, carga, passageiros e o selo de status.
    // Para o dono a linha tem mais coisa (números em carga e passageiros, talvez botões depois do status):
    // em 28/11/2026 a 2.0.6 recusou a página do Astro porque exigia "Ativo" como último texto da linha.
    // Por isso o status é procurado como linha própria em qualquer ponto da linha, e o total de rotas
    // também vale no formato "48 / 60 rotas". O motivo de uma recusa fica em __vortexRecusado.
    // Revisão do Codex (28/11): qualquer recusa zera a contagem de leituras estáveis, e a linha de cada rota
    // precisa conter um código VTX só (um contêiner com várias rotas daria o status da vizinha).
    // Segunda revisão do Codex (28/11): a estabilidade compara QUAIS rotas vieram (código, aeroportos e status), não só
    // quantas; o resultado diz se a lista foi confirmada pelo total da página (routes + total). Sem o total, quem monta
    // os dados (coletor/dados.mjs, routesKept) não deixa a lista apagar mais que duas rotas publicadas.
    const refuseRoutes = (reason, row) => { window.__vortexRotas = null; return refuse(reason, row); };
    const codes = [...document.querySelectorAll("p")].filter(el =>
      el.getClientRects().length && /^VTX\d+$/.test(el.innerText.trim()));
    // O total vale só se a página mostrar um número só ("48 rotas" ou "48 / 60 rotas"); dois totais diferentes (outro
    // painel com "3 rotas", por exemplo) é o mesmo que nenhum.
    const totals = [...new Set(body.split("\n").map(t => /^(\d+)(?:\s*(?:\/|de)\s*\d+)?\s+rotas?$/i.exec(t.trim())?.[1])
      .filter(Boolean))];
    const total = totals.length === 1 ? Number(totals[0]) : null;
    if (!codes.length) return refuseRoutes("nenhum código VTX visível");
    if (total !== null && codes.length !== total) return refuseRoutes(codes.length + " códigos visíveis, a página diz " + total + " rotas");
    const codesIn = el => codes.filter(code => el.contains(code)).length;
    // Na página real (28/11) a linha é o cartão .rounded-lg com um código só. Se o cartão tiver mais de um,
    // sobe a partir do código até o último ancestral que ainda tem um código só: essa é a linha da rota.
    const rowOf = code => {
      const card = code.closest(".rounded-lg");
      if (card && codesIn(card) === 1) return card;
      let el = code;
      while (el.parentElement && el.parentElement !== document.body && codesIn(el.parentElement) === 1) el = el.parentElement;
      return el === code ? null : el;
    };
    const status = /^(Ativo|Inativo|Ativa|Inativa|Active|Inactive)$/i;
    // Visão do dono (Astro, 28/11/2026, 2.0.10): a linha não tem o selo "Ativo"; vem "LEMD | EFHK | VTX0090 | Madrid
    // para Helsinki | 108.272 | LBS | 1.773 | PAX | Vaga lotada" e o status fica numa chave liga/desliga sem texto
    // (role="switch", como as abas, que também são do Radix). Vale a chave só se o bloco da rota (até o maior
    // ancestral com este código só) tiver exatamente uma. Caixas de marcar não contam: podem ser seleção da linha.
    const widest = el => {
      while (el.parentElement && el.parentElement !== document.body && codesIn(el.parentElement) === 1) el = el.parentElement;
      return el;
    };
    const switchOf = row => {
      const found = [...widest(row).querySelectorAll('[role="switch"]')];
      if (found.length !== 1) return null;
      const on = found[0].getAttribute("aria-checked"), state = found[0].getAttribute("data-state");
      return on === "true" || state === "checked" ? "ativo" : on === "false" || state === "unchecked" ? "inativo" : null;
    };
    // Para o diagnóstico de uma recusa: os controles do bloco da rota (tipo, papel, estado e rótulo, curtos).
    const controlsOf = row => [...widest(row).querySelectorAll("button, input, select, [role]")].slice(0, 6).map(el =>
      [el.tagName?.toLowerCase(), el.getAttribute("type"), el.getAttribute("role"), el.getAttribute("aria-checked"),
        el.getAttribute("data-state"), (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 20)]
        .filter(Boolean).join(":")).join(", ") || "nenhum";
    const routes = [], seen = [];
    for (const code of codes) {
      const airports = (code.parentElement.firstElementChild?.innerText || "").trim().split(/\s+/)
        .filter(value => /^[A-Z0-9]{3,5}$/.test(value));
      const row = rowOf(code);
      if (!row) return refuseRoutes("linha da rota " + airports.join("-") + " não encontrada");
      // Um seletor de status traz no texto todas as opções; nesse caso vale só a opção escolhida (seletores de
      // outra coisa, sem opção de status escolhida, não contam).
      const chosen = [...row.querySelectorAll("select")].map(select => select.selectedOptions?.[0]?.text.trim() || "")
        .filter(text => status.test(text));
      const lines = chosen.length ? chosen : row.innerText.split("\n").map(t => t.trim());
      const statuses = [...new Set(lines.filter(t => status.test(t)).map(t => t.toLowerCase()))];
      if (!statuses.length && switchOf(row)) statuses.push(switchOf(row));
      // Visão do dono (Astro, 2.0.11, 28/11/2026): a coluna de status pode trazer a situação da vaga no lugar de
      // "Ativo" ("Vaga lotada"), sem controle nenhum na linha; o VTX0090 LEMD-EFHK, que o dono vê assim, está
      // "Ativo" na visão do admin. Sem como saber o status, a rota vem marcada como incerta e quem monta os dados
      // (coletor/dados.mjs) só a mantém se ela já estava publicada como ativa.
      const uncertain = !statuses.length && lines.some(t => /^Vaga\s+\S+/i.test(t));
      if (airports.length !== 2) return refuseRoutes("aeroportos não lidos", row);
      if (statuses.length !== 1 && !uncertain) {
        return refuseRoutes(statuses.length ? "status ambíguo" : "status não encontrado (controles: " + controlsOf(row) + ")", row);
      }
      const active = !uncertain && /^(ativ|activ)/i.test(statuses[0]);
      seen.push(code.innerText.trim() + ":" + airports.join("-") + ":" + (uncertain ? "?" : active ? "A" : "I"));
      if (active || uncertain) {
        routes.push({ origin: airports[0], destination: airports[1], code: code.innerText.trim(), ...(uncertain ? { uncertain: true } : {}) });
      }
    }
    if (total === null) {
      // Sem o total na página, só aceita a lista depois de seis leituras seguidas (3 s) com as MESMAS rotas.
      const key = seen.join(","), last = window.__vortexRotas;
      window.__vortexRotas = { key, reads: last?.key === key ? last.reads + 1 : 1 };
      if (window.__vortexRotas.reads < 6) return refuse("a página não mostra o total (" + codes.length + " códigos visíveis)");
    }
    window.__vortexRotas = null;
    return { routes, total };
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
        name: lines[i].slice(1), role: own.some(value => /^admin$/i.test(value)) ? "ADMIN" : null,
        level: Number(own.find(t => /^Nv\.\s*\d+$/.test(t))?.match(/\d+/)?.[0]) || null,
        totalMinutes: labelled("HORAS TOTAIS") ?? clocks[0] ?? null,
        companyMinutes: labelled("HORAS NA EMPRESA") ?? clocks[1] ?? null,
        joined: date(own.find(t => date(t))),
      };
      if (pilot.totalMinutes === null || pilot.companyMinutes === null) return refuse("@" + pilot.name + " sem as horas de voo");
      pilots.push(pilot);
    }
    if (pilots.length && pilots.length < expected) {
      // O PilOps carrega dez pilotos por vez. A sentinela no fim do painel solicita a próxima página
      // quando entra na área visível. A leitura só é aceita quando alcança o total informado.
      const panelHeading = [...document.querySelectorAll("h2")].find(el => el.innerText.trim() === "Painel de pilotos");
      panelHeading?.parentElement?.parentElement?.lastElementChild?.scrollIntoView({ block: "end", behavior: "instant" });
      return null;
    }
    return pilots.length && pilots.length === expected ? pilots
      : refuse(pilots.length + " pilotos lidos, a página diz " + (Number.isInteger(expected) ? expected : "nenhum total"));
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
    if (start < 0) return refuse("a página não mostra o Histórico de voos");
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
        window.__vortexRecusado = ("voos: " + [model, prefix, lines[i], ...rest].join(" | ")).slice(0, 400);
        return null;
      }
      flights.push({
        pilot: lines[i].slice(1), prefix, model, origin: rest[1], destination: rest[2], date: isoDay(day[1], day[2], day[3]),
        minutes: Number(time[1]) * 60 + Number(time[2]), nm: Math.round(Number(nm[1].replace(/,/g, "")) * 100) / 100,
        // As "lbs" da lista são o COMBUSTÍVEL UTILIZADO no voo (conferido na página do voo em 27/11/2026),
        // no formato brasileiro (39.063,77); a receita vem no americano (4,616,708.05).
        fuel: lbs ? Math.round(Number(lbs[1].replace(/\./g, "").replace(",", "."))) : null,
        revenue: Math.round(Number(money[1].replace(/,/g, "")) * 100) / 100,
      });
    }
    // Lista vazia é o histórico ainda carregando, não "nenhum voo": a Vortex sempre tem os 10 últimos (Codex, 28/11).
    return flights.length ? flights : refuse("nenhum voo concluído no histórico (a lista ainda pode estar carregando)");
  }
  return null;
}

async function section(tabId, name) {
  const deadline = Date.now() + (name === "Pilotos" ? 90_000 : 25_000);
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

// Lê frota, hangares, hubs e rotas (obrigatórios) e pilotos e voos (opcionais) numa aba já aberta na Vortex.
async function readVortex(tabId) {
  const { fleet, reportedFleet } = await section(tabId, "Frota");
  const hangars = await section(tabId, "Hangares");
  const hubs = await section(tabId, "Hubs");
  // Rotas vêm com o total da página (null quando ela não mostra): sem ele, a lista não está confirmada.
  const { routes, total: routesTotal } = await section(tabId, "Rotas");
  // Pilotos e voos são opcionais: se a aba não carregar, a frota e as rotas são publicadas assim mesmo.
  const notes = [];
  const optional = name => section(tabId, name).catch(error => { notes.push(error.message); return null; });
  // O carregamento incremental depende da área visível. Em aba inativa, o Chrome pode suspender
  // a observação da sentinela. Ativa só a leitura dos pilotos, sem trazer a janela à frente.
  let previousTab;
  let pilots;
  try {
    const current = await chrome.tabs.get(tabId);
    [previousTab] = await chrome.tabs.query({ windowId: current.windowId, active: true });
    await chrome.tabs.update(tabId, { active: true });
    pilots = await optional("Pilotos");
  } finally {
    // Se o usuário escolheu outra aba nesse intervalo, sua escolha é preservada.
    if (previousTab?.id !== tabId && (await chrome.tabs.get(tabId).catch(() => null))?.active) {
      if (previousTab?.id) await chrome.tabs.update(previousTab.id, { active: true }).catch(() => {});
    }
  }
  const flights = await optional("Voos");
  return { fleet: fleet.map(p => ({ ...p, base: hangars[p.prefix] ?? null })), reportedFleet, hubs, routes,
    routesConfirmed: Number.isInteger(routesTotal), pilots, flights, notes };
}

globalThis.VortexReader = { company, readCompany, section, readVortex };
