# Prepara a extensão do dono (coletor/extensao-astro) e gera docs/extensao-vagas.zip (pasta vortex-dono).
# 1. Copia para a extensão os arquivos compartilhados com o coletor do Rafael:
#    leitura-vortex.js (leitura da página), dados.mjs -> dados.js e publicacao.mjs -> publicacao.js (regras da publicação).
# 2. Compacta SEM compressão, para o teste tools/vagas.test.mjs conferir que o pacote está em dia.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$extension = Join-Path $root "coletor\extensao-astro"
Copy-Item (Join-Path $root "coletor\extensao-chrome\leitura-vortex.js") (Join-Path $extension "leitura-vortex.js") -Force
Copy-Item (Join-Path $root "coletor\dados.mjs") (Join-Path $extension "dados.js") -Force
Copy-Item (Join-Path $root "coletor\publicacao.mjs") (Join-Path $extension "publicacao.js") -Force
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("vortex-dono-" + [guid]::NewGuid())
$folder = Join-Path $stage "vortex-dono"
New-Item -ItemType Directory -Force $folder | Out-Null
try {
  Copy-Item (Join-Path $extension "*") $folder
  $zip = Join-Path $root "docs\extensao-vagas.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path $folder -DestinationPath $zip -CompressionLevel NoCompression
  Write-Output "Pacote gerado: $zip"
} finally {
  Remove-Item -Recurse -Force $stage
}
