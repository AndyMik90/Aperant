# Add Claude Code to User PATH
$claudePath = "C:\Users\jamie.ballard\.local\bin"
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

if ($currentPath -notlike "*$claudePath*") {
    $newPath = "$currentPath;$claudePath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "[OK] Added $claudePath to User PATH" -ForegroundColor Green
    Write-Host ""
    Write-Host "Please restart your terminal for changes to take effect." -ForegroundColor Yellow
} else {
    Write-Host "[OK] $claudePath is already in PATH" -ForegroundColor Green
}

# Verify
Write-Host ""
Write-Host "Current User PATH:"
[Environment]::GetEnvironmentVariable("Path", "User") -split ";" | ForEach-Object { Write-Host "  $_" }
