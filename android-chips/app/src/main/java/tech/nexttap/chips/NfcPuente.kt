package tech.nexttap.chips

import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Lo que ve la web como `window.NfcNativo`. Todo el trabajo con el chip corre en un
 * hilo propio; los resultados vuelven a la página con evaluateJavascript:
 *   window.__nfcNativo.evento({...})        ← lecturas (chip apoyado)
 *   window.__nfcNativo.resolver(id, {...})  ← respuesta de procesar()
 */
class NfcPuente(
    private val activity: MainActivity,
    private val webView: WebView,
) {
    private val hilo = Executors.newSingleThreadExecutor()
    private val vibrador: Vibrator? = activity.getSystemService(Vibrator::class.java)

    @Volatile private var ultimoTag: Tag? = null
    @Volatile private var escaneando = false

    // --- lado Android ----------------------------------------------------

    /** Lo llama MainActivity cuando el lector detecta un chip. */
    fun alDetectar(tag: Tag) {
        ultimoTag = tag
        if (!escaneando) return
        hilo.execute {
            val uid = tag.id.toHexConPuntos()
            val ev = JSONObject().put("tipo", "lectura").put("uid", uid)
            try {
                abrirNtag(tag).use { n ->
                    val f = n.fotografiar()
                    ev.put("chip", f.chip ?: JSONObject.NULL)
                    ev.put("url", f.url ?: JSONObject.NULL)
                    ev.put("protegido", f.protegido ?: JSONObject.NULL)
                }
            } catch (e: Exception) {
                // No es una NTAG o no se pudo leer: igual avisamos el UID.
                ev.put("error", (e as? ChipError)?.codigo ?: "io")
            }
            js("window.__nfcNativo&&window.__nfcNativo.evento(${ev})")
        }
    }

    private fun js(codigo: String) {
        activity.runOnUiThread { webView.evaluateJavascript(codigo, null) }
    }

    private fun ByteArray.toHexConPuntos() = joinToString(":") { "%02x".format(it) }

    private fun hexABytes(h: String?): ByteArray? {
        if (h.isNullOrEmpty() || h.length % 2 != 0) return null
        return ByteArray(h.length / 2) { h.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    // --- lado web ----------------------------------------------------------

    @JavascriptInterface
    fun disponible(): String {
        val a = NfcAdapter.getDefaultAdapter(activity) ?: return "sin_nfc"
        return if (a.isEnabled) "ok" else "apagado"
    }

    @JavascriptInterface
    fun abrirAjustesNfc() {
        activity.startActivity(Intent(Settings.ACTION_NFC_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    @JavascriptInterface
    fun configurarServidor() { activity.configurarServidor() }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun iniciarEscaneo() { escaneando = true }

    @JavascriptInterface
    fun detenerEscaneo() { escaneando = false }

    /** "ok" = pulso corto; cualquier otra cosa = doble pulso de error. */
    @JavascriptInterface
    fun avisar(tipo: String) {
        val v = vibrador ?: return
        val efecto = if (tipo == "ok") {
            VibrationEffect.createOneShot(90, VibrationEffect.DEFAULT_AMPLITUDE)
        } else {
            VibrationEffect.createWaveform(longArrayOf(0, 160, 90, 160), -1)
        }
        v.vibrate(efecto)
    }

    /**
     * Trabaja sobre el último chip apoyado.
     * job: { uid?, url?, mimeTipo?, mimeB64?, pwd?, pack?, bloquear? }  (pwd/pack en hex)
     */
    @JavascriptInterface
    fun procesar(jobJson: String, id: String) {
        hilo.execute {
            val respuesta = JSONObject()
            try {
                val job = JSONObject(jobJson)
                val tag = ultimoTag ?: throw ChipError("sin_chip", "No hay ningún chip apoyado.")
                val esperado = job.optString("uid", "").replace(":", "").lowercase()
                val actual = tag.id.joinToString("") { "%02x".format(it) }
                if (esperado.isNotEmpty() && esperado != actual) {
                    throw ChipError("sin_chip", "El chip apoyado no es el que se estaba procesando.")
                }

                val mensaje: ByteArray? = when {
                    job.optString("url").isNotEmpty() -> NdefUtil.registroUri(job.getString("url"))
                    job.optString("mimeB64").isNotEmpty() ->
                        NdefUtil.registroMime(
                            job.optString("mimeTipo", "application/octet-stream"),
                            Base64.decode(job.getString("mimeB64"), Base64.DEFAULT),
                        )
                    else -> null
                }
                val pwd = hexABytes(job.optString("pwd"))?.takeIf { it.size == 4 }
                val pack = hexABytes(job.optString("pack"))?.takeIf { it.size == 2 }

                val r = abrirNtag(tag).use { it.aplicar(mensaje, pwd, pack, job.optBoolean("bloquear", false)) }
                respuesta.put("ok", true)
                    .put("chip", r.chip)
                    .put("urlAntes", r.urlAntes ?: JSONObject.NULL)
                    .put("escribio", r.escribio)
                    .put("bloqueo", r.bloqueo)
            } catch (e: ChipError) {
                respuesta.put("ok", false).put("error", e.codigo).put("detalle", e.message)
            } catch (e: Exception) {
                respuesta.put("ok", false).put("error", "io").put("detalle", e.message ?: e.javaClass.simpleName)
            }
            js("window.__nfcNativo&&window.__nfcNativo.resolver(${JSONObject.quote(id)},${respuesta})")
        }
    }
}
