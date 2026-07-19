# Keeps the face-service running: launches uvicorn via this folder's venv,
# and if it ever exits (crash, machine woke from sleep and lost the process,
# etc.) waits a few seconds and starts it again -- forever, until the task
# that runs this script is stopped. Logs to face-service.log next to this
# script so a failure can be diagnosed after the fact instead of just
# silently not being there next time someone needs it.
#
# Intended to be run as a Windows Scheduled Task that fires "At log on" for
# your user (see the README section this script is referenced from) so the
# face service is always up before anyone tries to use KYC or face
# check-in -- no more remembering to start it by hand before a demo.
#
# ASCII-only on purpose: plain-text (no BOM) .ps1 files with non-ASCII
# characters (smart quotes, em-dashes) can fail to parse under Windows
# PowerShell 5.1 when launched non-interactively (e.g. by Task Scheduler),
# even though they run fine when pasted into an interactive console.

$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot
$logFile = Join-Path $PSScriptRoot 'face-service.log'
$pythonExe = Join-Path $PSScriptRoot 'venv\Scripts\python.exe'

if (-not (Test-Path $pythonExe)) {
    Add-Content -Path $logFile -Value "$(Get-Date -Format 'u') [start-face-service] venv not found at $pythonExe -- see README.md Setup section to create it first. Exiting."
    exit 1
}

while ($true) {
    Add-Content -Path $logFile -Value "$(Get-Date -Format 'u') [start-face-service] starting uvicorn..."
    & $pythonExe -m uvicorn main:app --host 0.0.0.0 --port 8001 *>> $logFile
    Add-Content -Path $logFile -Value "$(Get-Date -Format 'u') [start-face-service] uvicorn exited (crash or manual stop) -- restarting in 5s."
    Start-Sleep -Seconds 5
}
