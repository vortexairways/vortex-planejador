import { appendFileSync, copyFileSync, existsSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const logDir = path.join(process.env.LOCALAPPDATA, "Vortex");
const logFile = path.join(logDir, "sincronizacao.log");
mkdirSync(logDir, { recursive: true });
if (existsSync(logFile) && statSync(logFile).size > 2 * 1024 * 1024) {
  copyFileSync(logFile, path.join(logDir, "sincronizacao-anterior.log"));
  truncateSync(logFile);
}
const stamp = () => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(new Date());
const log = text => appendFileSync(logFile, "[" + stamp() + "] " + text + "\n", "utf8");
try {
  const browserOpen = ["chrome.exe", "samsunginternet.exe"].some(name => {
    const tasks = execFileSync(path.join(process.env.WINDIR, "System32/tasklist.exe"),
      ["/FI", "IMAGENAME eq " + name, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    return tasks.toLowerCase().includes('"' + name + '"');
  });
  if (!browserOpen) {
    log("Navegador fechado. A coleta sera tentada no proximo horario.");
    process.exit(0);
  }
  log("Iniciando sincronizacao automatica.");
  const script = fileURLToPath(new URL("./coletor-local.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--automatic"], {
    cwd: path.dirname(path.dirname(script)), encoding: "utf8", windowsHide: true, timeout: 7 * 60000, maxBuffer: 1024 * 1024,
  });
  if (result.stdout) appendFileSync(logFile, result.stdout, "utf8");
  if (result.stderr) appendFileSync(logFile, result.stderr, "utf8");
  if (result.error) throw result.error;
  if (result.status === 75) { log("Outra coleta ja esta em andamento; ciclo ignorado."); process.exit(0); }
  if (result.status !== 0) log("Falha na coleta. Nova tentativa no proximo ciclo de 10 minutos.");
  process.exit(result.status ?? 1);
} catch (error) {
  log("Falha ao iniciar a coleta: " + error.message);
  process.exit(1);
}
