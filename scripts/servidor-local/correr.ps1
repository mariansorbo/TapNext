# Mantiene vivo el backend de NextTap en esta PC (modo producción, base local)
# y el túnel de Cloudflare que lo publica en api.next-tap.tech. Si cualquiera
# de los dos se cae, lo relanza a los 3 s. Lo arranca la tarea programada
# "NextTap Servidor" (ver instalar.ps1); log en servidor.log, al lado.
$ErrorActionPreference = 'Continue'
$landing = Resolve-Path (Join-Path $PSScriptRoot '..\..\landing')
$log     = Join-Path $PSScriptRoot 'servidor.log'
$tunel   = Join-Path $PSScriptRoot 'tunel.yml'
$cfd     = (Get-ChildItem 'C:\Program Files*\cloudflared\cloudflared.exe' | Select-Object -First 1).FullName

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content $log }

$api = $null; $cf = $null
Log 'arranca supervisor'
while ($true) {
    if (-not $api -or $api.HasExited) {
        if ($api) { Log "backend murió (código $($api.ExitCode)), relanzo" }
        $api = Start-Process node -ArgumentList "`"$landing\scripts\server-local.mjs`" --prod" `
               -WorkingDirectory $landing -WindowStyle Hidden -PassThru `
               -RedirectStandardOutput "$PSScriptRoot\backend.out.log" -RedirectStandardError "$PSScriptRoot\backend.err.log"
        Log "backend pid $($api.Id)"
    }
    if ((Test-Path $tunel) -and (-not $cf -or $cf.HasExited)) {
        if ($cf) { Log "túnel murió (código $($cf.ExitCode)), relanzo" }
        $cf = Start-Process $cfd -ArgumentList "tunnel --config `"$tunel`" run" -WindowStyle Hidden -PassThru `
              -RedirectStandardError "$PSScriptRoot\tunel.log"
        Log "túnel pid $($cf.Id)"
    }
    Start-Sleep -Seconds 3
}
