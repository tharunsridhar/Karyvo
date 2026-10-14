# Starts (and creates on first run) a private local PostgreSQL on port 5433 using an
# existing PostgreSQL install. Data lives in .pgdata at the repo root (gitignored).
# Usage: powershell -File scripts/dev-db.ps1 [start|stop]
param([string]$Action = "start")

$root = Split-Path $PSScriptRoot -Parent
$data = Join-Path $root ".pgdata"
$bin = (Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_ctl.exe" | Sort-Object FullName -Descending | Select-Object -First 1).Directory.FullName

if ($Action -eq "stop") { & "$bin\pg_ctl.exe" -D $data stop; exit }

if (-not (Test-Path $data)) {
  & "$bin\initdb.exe" -D $data -U mrfixmyhome --auth=trust -E UTF8 | Out-Null
}
Start-Process -FilePath "$bin\pg_ctl.exe" -ArgumentList "-D `"$data`" -o `"-p 5433`" -l `"$data\server.log`" start" -WindowStyle Hidden -Wait
Start-Sleep 2
foreach ($db in "mrfixmyhome", "mrfixmyhome_test") {
  $exists = & "$bin\psql.exe" -h localhost -p 5433 -U mrfixmyhome -d postgres -tAc "select 1 from pg_database where datname='$db'"
  if (-not $exists) { & "$bin\psql.exe" -h localhost -p 5433 -U mrfixmyhome -d postgres -c "create database $db" }
}
Write-Host "Postgres ready on localhost:5433 (databases: mrfixmyhome, mrfixmyhome_test)"
