# Posts one heartbeat from Windows. Set the three environment variables before running.
$ErrorActionPreference = "Stop"
if (-not $env:OPSBOARD_HEARTBEAT_URL -or -not $env:OPSBOARD_HEARTBEAT_TOKEN -or -not $env:OPSBOARD_HEARTBEAT_ID) {
  Write-Error "Set OPSBOARD_HEARTBEAT_URL, OPSBOARD_HEARTBEAT_TOKEN, and OPSBOARD_HEARTBEAT_ID."
}
$body = @{ id = $env:OPSBOARD_HEARTBEAT_ID; observedAt = (Get-Date).ToUniversalTime().ToString("o"); ok = $true; metrics = @{} } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $env:OPSBOARD_HEARTBEAT_URL -Headers @{ Authorization = "Bearer $($env:OPSBOARD_HEARTBEAT_TOKEN)" } -ContentType "application/json" -Body $body | Out-Null
