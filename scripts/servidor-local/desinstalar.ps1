# Frena y borra la tarea "NextTap Servidor" (y los procesos que lanzó).
$nombre = 'NextTap Servidor'
Stop-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match 'servidor-local\\correr\.ps1|server-local\.mjs|tunel\.yml'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "Tarea '$nombre' eliminada."
