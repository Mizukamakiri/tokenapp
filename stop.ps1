$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
docker compose stop
if ($LASTEXITCODE -ne 0) { throw 'Tokenapp could not be stopped. Check Docker Desktop.' }
