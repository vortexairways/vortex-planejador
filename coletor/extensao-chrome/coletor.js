importScripts("leitura-vortex.js");
const alarm = "vortex-coletor";
let busy = false;

async function local(path, data) {
  const response = await fetch("http://127.0.0.1:8768/" + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error("O serviço local da Vortex não está disponível.");
  return response.json();
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
    const reading = await readVortex(tab.id);
    await local("snapshot", { lease: job.lease, ...reading });
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
