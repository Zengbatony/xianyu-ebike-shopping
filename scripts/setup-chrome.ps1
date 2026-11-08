# Start dedicated Chrome instance for Xianyu monitoring (port 18803, non-headless)
# Usage: powershell -ExecutionPolicy Bypass -File setup-chrome.ps1 [start|stop|status]
param([string]$Action = 'status')

$ErrorActionPreference = 'SilentlyContinue'
$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$port = 18803
$profileDir = Join-Path $root 'data\chrome-profile'
$pidFile = Join-Path $root 'data\chrome_xianyu.pid'
$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# Locate chrome.exe
$chrome = $env:CHROME_PATH
if (-not $chrome) {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($c in $candidates) { if (Test-Path $c) { $chrome = $c; break } }
}
if (-not $chrome) { Write-Host 'ERROR: chrome.exe not found. Set CHROME_PATH.'; exit 1 }

function Test-Running {
  try { return (Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/version" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
  catch { return $false }
}

switch ($Action) {
  'start' {
    if (Test-Running) { Write-Host "Chrome already running on port $port"; exit 0 }
    $p = Start-Process -FilePath $chrome -ArgumentList "--remote-debugging-port=$port","--user-data-dir=$profileDir","--no-first-run","--no-default-browser-check","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding" -PassThru
    Start-Sleep -Seconds 3
    if (Test-Running) {
      $p.Id | Out-File -FilePath $pidFile -Encoding ascii
      Write-Host "Chrome started (port $port, PID $($p.Id))."
      Write-Host "ACTION REQUIRED: open goofish.com in that window and log in with a secondary account (QR or SMS)."
    } else { Write-Host 'ERROR: Chrome failed to start'; exit 1 }
  }
  'stop' {
    if (Test-Path $pidFile) {
      $procId = [int](Get-Content $pidFile)
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Remove-Item $pidFile -Force
    }
    Write-Host 'Chrome stop attempted'
  }
  'status' {
    if (Test-Running) {
      Write-Host "Chrome running on port $port"
      (Invoke-WebRequest -Uri "http://127.0.0.1:$port/json/version" -UseBasicParsing).Content
    } else { Write-Host "Chrome not running on port $port" }
  }
  default { Write-Host 'Usage: setup-chrome.ps1 [start|stop|status]' }
}
