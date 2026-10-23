$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.env')) {
  $profilePath = [Environment]::GetFolderPath('UserProfile').Replace('\', '/')
  @("CODEX_DATA_HOME=$profilePath/.codex", "CLAUDE_DATA_HOME=$profilePath/.claude", 'APP_TIMEZONE=Europe/Helsinki') | Set-Content -LiteralPath '.env' -Encoding utf8
}
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Tokenapp could not start. Check Docker Desktop.' }
Write-Host 'Tokenapp is running at http://localhost:8787'
