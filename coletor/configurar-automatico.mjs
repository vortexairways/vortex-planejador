import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const taskName = "Vortex - Sincronizar automaticamente";
const xmlEscape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
const psLiteral = value => "'" + value.replace(/'/g, "''") + "'";

export function taskXml({ sid, nodePath, runnerPath, repo, psPath, start }) {
  const command = "& " + psLiteral(nodePath) + " " + psLiteral(runnerPath) + "; exit $LASTEXITCODE";
  const args = '-NoProfile -WindowStyle Hidden -Command "' + command + '"';
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Sincroniza a Vortex a cada 10 minutos enquanto o usuario e o Chrome estao disponiveis. Mantem a coleta manual.</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT10M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>${xmlEscape(start)}</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscape(sid)}</UserId><Delay>PT1M</Delay></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>${xmlEscape(sid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>false</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT8M</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(psPath)}</Command><Arguments>${xmlEscape(args)}</Arguments><WorkingDirectory>${xmlEscape(repo)}</WorkingDirectory></Exec></Actions>
</Task>`;
}

function configure() {
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const runnerPath = fileURLToPath(new URL("./automatico.mjs", import.meta.url));
  const schtasks = path.join(process.env.WINDIR, "System32/schtasks.exe");
  const query = spawnSync(schtasks, ["/Query", "/TN", taskName, "/XML"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (query.status === 0 && !query.stdout.includes(xmlEscape(runnerPath))) throw new Error("Ja existe uma tarefa Vortex apontando para outro projeto. Ela foi preservada.");
  if (process.argv.includes("--desativar")) {
    if (query.status === 0) execFileSync(schtasks, ["/Change", "/TN", taskName, "/Disable"], { windowsHide: true, stdio: "inherit" });
    console.log("Coleta automatica desativada. O atalho manual continua disponivel.");
    return;
  }
  const account = execFileSync(path.join(process.env.WINDIR, "System32/whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
  const sid = account.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error("Nao foi possivel identificar a sessao atual do Windows.");
  const psPath = path.join(process.env.WINDIR, "System32/WindowsPowerShell/v1.0/powershell.exe");
  const xml = taskXml({ sid, nodePath: process.execPath, runnerPath, repo, psPath, start: new Date(Date.now() + 10 * 60000).toISOString() });
  const dir = mkdtempSync(path.join(tmpdir(), "vortex-task-"));
  const file = path.join(dir, "tarefa.xml");
  try {
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
    execFileSync(schtasks, ["/Create", "/TN", taskName, "/XML", file, "/F"], { windowsHide: true, stdio: "inherit", timeout: 10000 });
    console.log("Ativada: " + taskName + ". Intervalo: 10 minutos e ao entrar no Windows.");
    console.log("Nao desperta o computador nem abre o Chrome. O atalho Sincronizar Vortex continua disponivel.");
  } finally { unlinkSync(file); rmdirSync(dir); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { configure(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
