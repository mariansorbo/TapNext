package tech.nexttap.chips

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.nfc.NfcAdapter
import android.os.Bundle
import android.text.InputType
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.EditText
import android.widget.Toast
import android.webkit.CookieManager
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * NextTap Chips: el panel de admin dentro de un WebView + un puente NFC nativo.
 * La web sigue siendo la misma de siempre (login, inventario, botones); lo único
 * que cambia es que acá sí se puede escribir y bloquear chips (NfcA crudo).
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var puente: NfcPuente
    private val prefs by lazy { getSharedPreferences("chips", Context.MODE_PRIVATE) }

    /** Dirección del panel: la que se guardó en la app, o la de fábrica. */
    private fun urlPanel(): String = prefs.getString("panel_url", null) ?: BuildConfig.PANEL_URL
    private fun panel(): Uri = Uri.parse(urlPanel())

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Pantalla prendida: con la tanda en marcha no se tiene que dormir.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)

        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString NextTapChips/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // "Abrir en WhatsApp" de los Acuerdos: el panel manda un intent:// dirigido a
                // WhatsApp Business. Solo aceptamos ese destino exacto (nada de intents arbitrarios).
                if (request.url.scheme == "intent") {
                    abrirWhatsappBusiness(request.url.toString())
                    return true
                }
                if (request.url.scheme == "javascript" || request.url.host == panel().host) return false
                // Cualquier otro sitio se abre afuera: el puente NFC es solo del panel.
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: Exception) { /* sin app para abrirlo */ }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                view.loadDataWithBaseURL(
                    null,
                    """<html><body style="background:#0b0b10;color:#edeee9;font-family:sans-serif;padding:32px;text-align:center">
                       <h2>Sin conexión</h2><p>No pude abrir el panel (${error.description}).</p>
                       <p><a style="color:#9d86ff" href="${urlPanel()}">Reintentar</a></p>
                       <p><a style="color:#9d86ff" href="javascript:NfcNativo.configurarServidor()">Cambiar la dirección del panel</a></p>
                       <p style="opacity:.5;font-size:12px">${urlPanel()}</p></body></html>""",
                    "text/html", "utf-8", null,
                )
            }
        }

        // Sin esto el WebView ignora alert() / confirm() / prompt(): los "¿Eliminar…?" del
        // panel devolverían "no" en silencio y los botones no harían nada.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("OK") { _, _ -> result.confirm() }
                    .setOnCancelListener { result.confirm() }
                    .show()
                return true
            }

            override fun onJsConfirm(view: WebView, url: String?, message: String?, result: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setPositiveButton("Aceptar") { _, _ -> result.confirm() }
                    .setNegativeButton("Cancelar") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            override fun onJsPrompt(
                view: WebView, url: String?, message: String?, defaultValue: String?, result: JsPromptResult,
            ): Boolean {
                val campo = EditText(this@MainActivity).apply { setText(defaultValue ?: "") }
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(message)
                    .setView(campo)
                    .setPositiveButton("Aceptar") { _, _ -> result.confirm(campo.text.toString()) }
                    .setNegativeButton("Cancelar") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }
        }

        puente = NfcPuente(this, webView)
        webView.addJavascriptInterface(puente, "NfcNativo")

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(urlPanel())
    }

    /** Abre el chat en WhatsApp Business; si no está instalada, usa la dirección de respaldo (wa.me). */
    private fun abrirWhatsappBusiness(uri: String) {
        try {
            val destino = Intent.parseUri(uri, Intent.URI_INTENT_SCHEME)
            val permitido = destino.`package` == "com.whatsapp.w4b" && destino.scheme == "whatsapp"
            if (!permitido) return
            destino.addCategory(Intent.CATEGORY_BROWSABLE)
            destino.component = null
            destino.selector = null
            try {
                startActivity(destino)
            } catch (_: ActivityNotFoundException) {
                destino.getStringExtra("browser_fallback_url")
                    ?.takeIf { Uri.parse(it).scheme == "https" }
                    ?.let { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it))) }
            }
        } catch (_: Exception) { /* link mal armado: no hace nada */ }
    }

    /** Diálogo para cambiar la dirección del panel sin recompilar la app. */
    fun configurarServidor() {
        runOnUiThread {
            val campo = EditText(this).apply {
                setText(urlPanel())
                inputType = InputType.TYPE_TEXT_VARIATION_URI
                setSelectAllOnFocus(true)
            }
            AlertDialog.Builder(this)
                .setTitle("Dirección del panel")
                .setMessage("Ej.: https://next-tap.tech/admin.html")
                .setView(campo)
                .setPositiveButton("Guardar") { _, _ ->
                    val nueva = campo.text.toString().trim()
                    if (Uri.parse(nueva).scheme != "https" || Uri.parse(nueva).host.isNullOrEmpty()) {
                        Toast.makeText(this, "Tiene que empezar con https://", Toast.LENGTH_LONG).show()
                    } else {
                        prefs.edit().putString("panel_url", nueva).apply()
                        webView.loadUrl(nueva)
                    }
                }
                .setNeutralButton("De fábrica") { _, _ ->
                    prefs.edit().remove("panel_url").apply()
                    webView.loadUrl(urlPanel())
                }
                .setNegativeButton("Cancelar", null)
                .show()
        }
    }

    // Plan B si la web no carga: mantener apretado "subir volumen" abre el cambio de dirección.
    override fun onKeyLongPress(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) { configurarServidor(); return true }
        return super.onKeyLongPress(keyCode, event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) { event?.startTracking(); return true }
        return super.onKeyDown(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        val adapter = NfcAdapter.getDefaultAdapter(this)
        if (adapter != null && adapter.isEnabled) {
            // Modo lector: la app es la dueña del NFC mientras está al frente y Android
            // no abre otras apps ni suena al apoyar un chip.
            adapter.enableReaderMode(
                this,
                { tag -> puente.alDetectar(tag) },
                NfcAdapter.FLAG_READER_NFC_A or
                    NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or
                    NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
                null,
            )
        }
    }

    override fun onPause() {
        NfcAdapter.getDefaultAdapter(this)?.disableReaderMode(this)
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
