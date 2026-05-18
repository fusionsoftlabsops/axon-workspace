#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Register the admin_data_project MCP server with Claude Code, backed by a
  Docker container.

.DESCRIPTION
  Builds the admin-data-mcp:latest image if missing, then registers (or
  re-registers) it as a stdio MCP server in Claude Code. The Docker
  container is spawned fresh on every Claude Code session.

.PARAMETER ApiToken
  Bearer token issued from /settings/tokens in the running web app.
  Format: ad_pk_<base64url>. Required.

.PARAMETER BaseUrl
  Base URL of the admin_data_project API as seen from inside the container.
  Defaults to http://host.docker.internal:3000/api/v1, which routes to the
  host's port 3000 when Docker Desktop is on Mac/Windows.

.PARAMETER Name
  Name to register the MCP under in Claude Code. Default: admin-data.

.PARAMETER Scope
  Claude Code config scope. Default: user (applies globally for the user).

.EXAMPLE
  ./scripts/setup-mcp.ps1 -ApiToken ad_pk_xxxxx
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true, Position=0)]
  [string]$ApiToken,

  [string]$BaseUrl = 'http://host.docker.internal:3000/api/v1',
  [string]$Name = 'admin-data',
  [ValidateSet('user', 'project', 'local')]
  [string]$Scope = 'user'
)

$ErrorActionPreference = 'Stop'

# ---- Sanity checks ----
if (-not ($ApiToken -match '^ad_pk_')) {
  Write-Error "ApiToken must start with 'ad_pk_'. Generate one at <web-app>/settings/tokens."
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Error "Claude Code CLI 'claude' not on PATH. Install/upgrade Claude Code first."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker not on PATH. Install Docker Desktop first."
}

# ---- Build image if missing ----
$existing = docker images admin-data-mcp:latest --format '{{.ID}}' 2>$null
if (-not $existing) {
  Write-Host 'Building admin-data-mcp:latest (first-time setup, ~2 min)...' -ForegroundColor Cyan
  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
  Push-Location $repoRoot
  try {
    docker compose --profile mcp-build build mcp
    if ($LASTEXITCODE -ne 0) { Write-Error 'Docker build failed.' }
  } finally {
    Pop-Location
  }
} else {
  Write-Host 'admin-data-mcp:latest already exists; skipping rebuild.' -ForegroundColor DarkGray
}

# ---- Remove any prior registration so the rerun is idempotent ----
$listed = claude mcp list 2>$null
if ($LASTEXITCODE -eq 0 -and $listed -match [regex]::Escape($Name)) {
  Write-Host "Removing previous '$Name' MCP entry..." -ForegroundColor DarkGray
  claude mcp remove $Name --scope $Scope 2>$null | Out-Null
}

# ---- Register ----
# Note: `claude mcp add -e KEY=value -- docker run -i --rm <flags> image`
# The `-e KEY=value` after `claude mcp add` sets envs in the docker subprocess
# launched by Claude Code; we then forward them into the container by listing
# the variable names with bare `-e KEY` inside `docker run`.
Write-Host "Registering '$Name' MCP server (scope=$Scope)..." -ForegroundColor Cyan

claude mcp add $Name `
  --scope $Scope `
  -e "ADMIN_API_BASE_URL=$BaseUrl" `
  -e "ADMIN_API_TOKEN=$ApiToken" `
  -- docker run -i --rm `
  -e ADMIN_API_BASE_URL `
  -e ADMIN_API_TOKEN `
  admin-data-mcp:latest

if ($LASTEXITCODE -ne 0) {
  Write-Error "claude mcp add failed."
}

Write-Host ""
Write-Host "MCP server '$Name' configured successfully." -ForegroundColor Green
Write-Host ""
Write-Host "To verify, run:" -ForegroundColor Cyan
Write-Host "  claude mcp list"
Write-Host "  claude mcp get $Name"
Write-Host ""
Write-Host "Then in Claude Code, ask: 'List my tasks in admin_data_project.'" -ForegroundColor Cyan
