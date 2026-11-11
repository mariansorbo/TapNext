package tech.nexttap.chips

/** Armado y lectura de mensajes NDEF mínimos (un registro URI o MIME). */
object NdefUtil {
    // Códigos de prefijo de URI (NFC Forum): se prueba el más largo primero.
    private val PREFIJOS = listOf(
        2 to "https://www.",
        1 to "http://www.",
        4 to "https://",
        3 to "http://",
    )
    private val TABLA = arrayOf(
        "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
        "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://", "nfs://",
        "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:", "pop:", "sip:",
        "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://", "tcpobex://", "irdaobex://",
        "file://", "urn:epc:id:", "urn:epc:tag:", "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:",
    )

    fun registroUri(url: String): ByteArray {
        var codigo = 0
        var resto = url
        for ((c, p) in PREFIJOS) {
            if (url.startsWith(p)) { codigo = c; resto = url.substring(p.length); break }
        }
        val payload = byteArrayOf(codigo.toByte()) + resto.toByteArray(Charsets.UTF_8)
        if (payload.size > 255) throw ChipError("sin_espacio", "El link es demasiado largo.")
        // MB | ME | SR | TNF=1 (well-known), tipo "U"
        return byteArrayOf(0xD1.toByte(), 1, payload.size.toByte(), 'U'.code.toByte()) + payload
    }

    fun registroMime(tipo: String, datos: ByteArray): ByteArray {
        val t = tipo.toByteArray(Charsets.US_ASCII)
        return if (datos.size <= 255) {
            byteArrayOf(0xD2.toByte(), t.size.toByte(), datos.size.toByte()) + t + datos
        } else {
            val n = datos.size
            byteArrayOf(
                0xC2.toByte(), t.size.toByte(),
                (n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte(),
            ) + t + datos
        }
    }

    /** URL del primer registro URI del mensaje, o null si es otra cosa. */
    fun urlDe(mensaje: ByteArray): String? {
        if (mensaje.size < 3) return null
        val h = mensaje[0].toInt() and 0xFF
        val tnf = h and 0x07
        val corto = (h and 0x10) != 0
        val conId = (h and 0x08) != 0
        var i = 1
        val tipoLen = mensaje[i++].toInt() and 0xFF
        val payLen: Int
        if (corto) {
            payLen = mensaje[i++].toInt() and 0xFF
        } else {
            if (mensaje.size < i + 4) return null
            payLen = ((mensaje[i].toInt() and 0xFF) shl 24) or ((mensaje[i + 1].toInt() and 0xFF) shl 16) or
                ((mensaje[i + 2].toInt() and 0xFF) shl 8) or (mensaje[i + 3].toInt() and 0xFF)
            i += 4
        }
        val idLen = if (conId) mensaje[i++].toInt() and 0xFF else 0
        if (mensaje.size < i + tipoLen + idLen + payLen) return null
        val tipo = String(mensaje, i, tipoLen, Charsets.US_ASCII)
        i += tipoLen + idLen
        if (tnf != 1 || tipo != "U" || payLen < 1) return null
        val prefijo = TABLA.getOrElse(mensaje[i].toInt() and 0xFF) { "" }
        return prefijo + String(mensaje, i + 1, payLen - 1, Charsets.UTF_8)
    }
}
