package tech.nexttap.chips

import java.io.IOException

/**
 * NTAG213 simulada, con las reglas que importan para el candado: AUTH0, PROT, PWD /
 * PACK, PWD_AUTH, y el NAK que deja al chip "en idle" hasta que se lo re-selecciona
 * (en el teléfono eso aparece como una excepción en transceive).
 */
class NtagSimulada : Transporte {
    val paginas = Array(45) { ByteArray(4) }
    var autenticado = false
    private var idle = false
    var removido = false
    /** Si > 0, el chip "se va" cuando se hayan mandado esa cantidad de comandos. */
    var perderEn = 0
    var comandos = 0
    var conexiones = 0

    private val CFG0 = 41
    private val CFG1 = 42
    private val PWD = 43
    private val PACK = 44

    init {
        paginas[3] = byteArrayOf(0xE1.toByte(), 0x10, 0x12, 0x00)
        paginas[4] = byteArrayOf(0x03, 0x00, 0xFE.toByte(), 0x00)
        paginas[CFG0] = byteArrayOf(0, 0, 0, 0xFF.toByte())
        paginas[CFG1] = byteArrayOf(0, 5, 0, 0)
        paginas[PWD] = byteArrayOf(-1, -1, -1, -1)
        paginas[PACK] = byteArrayOf(0, 0, 0, 0)
    }

    val auth0 get() = paginas[CFG0][3].toInt() and 0xFF
    val prot get() = (paginas[CFG1][0].toInt() and 0x80) != 0
    val authlim get() = paginas[CFG1][0].toInt() and 0x07

    /** Deja el chip bloqueado como lo dejaría NFC Tools (AUTH0=4, PROT=0). */
    fun bloquearConClave(pwd: ByteArray, pack: ByteArray) {
        paginas[PWD] = pwd.copyOf()
        paginas[PACK] = byteArrayOf(pack[0], pack[1], 0, 0)
        paginas[CFG1][0] = 0
        paginas[CFG0][3] = 4
    }

    private fun nak(): Nothing {
        idle = true
        throw IOException("Transceive failed")
    }

    private fun protegidaEscritura(p: Int) = auth0 <= 255 && p >= auth0 && !autenticado
    private fun protegidaLectura(p: Int) = prot && p >= auth0 && !autenticado

    override fun connect() {
        if (removido) throw Perdido()
        conexiones++
    }

    override fun close() {}

    override fun reconectar(): Boolean {
        if (removido) return false
        idle = false
        autenticado = false // criterio conservador: re-seleccionar pierde la sesión
        return true
    }

    override fun transceive(datos: ByteArray): ByteArray {
        comandos++
        if (perderEn > 0 && comandos >= perderEn) removido = true
        if (removido || idle) throw Perdido()
        val cmd = datos[0].toInt() and 0xFF
        when (cmd) {
            0x60 -> return byteArrayOf(0, 4, 4, 2, 1, 0, 0x0F, 3)
            0x30 -> {
                val p0 = datos[1].toInt() and 0xFF
                if (p0 > 44) nak()
                val out = ByteArray(16)
                for (i in 0 until 4) {
                    val p = (p0 + i) % 45
                    if (protegidaLectura(p)) nak()
                    val src = if (p == PWD || p == PACK) ByteArray(4) else paginas[p]
                    src.copyInto(out, i * 4)
                }
                return out
            }
            0xA2 -> {
                val p = datos[1].toInt() and 0xFF
                if (p < 2 || p > 44 || protegidaEscritura(p)) nak()
                val cfgLock = (paginas[CFG1][0].toInt() and 0x40) != 0
                if (cfgLock && p in CFG0..PACK) nak()
                datos.copyOfRange(2, 6).copyInto(paginas[p])
                return byteArrayOf(0x0A)
            }
            0x1B -> {
                if (datos.copyOfRange(1, 5).contentEquals(paginas[PWD])) {
                    autenticado = true
                    return paginas[PACK].copyOfRange(0, 2)
                }
                nak()
            }
            else -> nak()
        }
    }
}
