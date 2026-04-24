param([string]$Action = "start")

$backendPort  = 8000
$frontendPort = 5173
$root = $PSScriptRoot

function Stop-Port([int]$port) {
    $lines = netstat -ano | Select-String ":$port\s"
    foreach ($line in $lines) {
        if ($line -match "LISTENING") {
            $procId = ($line -split '\s+')[-1]
            if ($procId -match '^\d+$') {
                Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
                Write-Host "Killed process $procId on port $port"
            }
        }
    }
}

function Wait-ForPort([int]$port, [int]$timeoutSec = 30) {
    Write-Host "Waiting for backend..." -NoNewline
    $elapsed = 0
    while ($elapsed -lt $timeoutSec) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect("localhost", $port)
            $tcp.Close()
            Write-Host " ready."
            return $true
        } catch {
            Start-Sleep -Seconds 1
            $elapsed++
            Write-Host "." -NoNewline
        }
    }
    Write-Host " timed out! Check the backend window for errors."
    return $false
}

Write-Host "Stopping existing servers..."
Stop-Port $backendPort
Stop-Port $frontendPort

if ($Action -eq "stop") {
    Write-Host "Done."
    exit
}

Write-Host "Starting backend..."
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "`$env:DATA_DIR='$root\data'; Set-Location '$root\backend'; uvicorn main:app --reload --port 8000"
)

Wait-ForPort $backendPort

Write-Host "Starting frontend..."
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$root\frontend'; npm run dev"
)

Write-Host ""
Write-Host "  Frontend: http://localhost:$frontendPort"
