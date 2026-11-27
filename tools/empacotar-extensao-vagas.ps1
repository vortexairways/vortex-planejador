# Gera docs/extensao-vagas.zip (pasta vortex-vagas) a partir de coletor/extensao-astro.
# Sem compressão, para o teste tools/vagas.test.mjs conferir que o pacote está em dia.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("vortex-vagas-" + [guid]::NewGuid())
$folder = Join-Path $stage "vortex-vagas"
New-Item -ItemType Directory -Force $folder | Out-Null
try {
  Copy-Item (Join-Path $root "coletor\extensao-astro\*") $folder
  $zip = Join-Path $root "docs\extensao-vagas.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path $folder -DestinationPath $zip -CompressionLevel NoCompression
  Write-Output "Pacote gerado: $zip"
} finally {
  Remove-Item -Recurse -Force $stage
}
