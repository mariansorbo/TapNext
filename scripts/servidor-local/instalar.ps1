# Registra la tarea programada "NextTap Servidor": al iniciar sesión levanta
# correr.ps1 (backend + túnel, con reinicio automático). Queda DESHABILITADA
# hasta el corte: mientras Render siga siendo producción, dos backends con las
# mismas claves mandarían mails y avisos duplicados.
#   .\instalar.ps1            → registra deshabilitada
#   .\instalar.ps1 -Activar   → la habilita y la arranca (día del corte)
param([switch]$Activar)
$nombre = 'NextTap Servidor'
$vbs    = Join-Path $PSScriptRoot 'lanzar-oculto.vbs'

$accion  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$logon   = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
           -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden

Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $logon -Settings $ajustes `
    -Description 'Backend de NextTap + túnel Cloudflare (api.next-tap.tech) contra la Postgres local.' -Force | Out-Null

if ($Activar) {
    Enable-ScheduledTask -TaskName $nombre | Out-Null
    Start-ScheduledTask -TaskName $nombre
    Write-Host "Tarea '$nombre' activa y corriendo."
} else {
    Disable-ScheduledTask -TaskName $nombre | Out-Null
    Write-Host "Tarea '$nombre' registrada (deshabilitada hasta el corte)."
}
