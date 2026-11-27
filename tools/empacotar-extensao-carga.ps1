# Prepara a extensão dos pilotos (coletor/extensao-carga) e gera docs/extensao-carga.zip (pasta vortex-carga).
# 1. Copia para a extensão o otimizador do planejador (docs/cargas.js), o mesmo que escolhe a melhor combinação.
# 2. Compacta SEM compressão, para o teste tools/carga.test.mjs conferir que o pacote está em dia.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $root "coletor\extensao-carga"
Copy-Item (Join-Path $root "docs\cargas.js") (Join-Path $extension "cargas.js") -Force
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("vortex-carga-" + [guid]::NewGuid())
$folder = Join-Path $stage "vortex-carga"
New-Item -ItemType Directory -Force $folder | Out-Null
try {
  Copy-Item (Join-Path $extension "*") $folder
  $zip = Join-Path $root "docs\extensao-carga.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path $folder -DestinationPath $zip -CompressionLevel NoCompression
  Write-Output "Pacote gerado: $zip"
} finally {
  Remove-Item -Recurse -Force $stage
}
