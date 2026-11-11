package tech.nexttap.chips

import java.io.IOException

/** El chip dejó de responder (se alejó del teléfono). */
class Perdido : IOException("Tag was lost")

/** Canal crudo hacia el chip (NfcA en el teléfono; un chip simulado en las pruebas). */
interface Transporte {
    fun connect()
    fun close()
    fun transceive(datos: ByteArray): ByteArray

    /** Re-selecciona el chip después de un NAK. false = ya no está. */
    fun reconectar(): Boolean
}

/** Error "de negocio" con un código que la web traduce a un mensaje. */
class ChipError(val codigo: String, detalle: String) : Exception(detalle)

/** Resultado de una pasada completa sobre un chip. */
class Resultado(
    val chip: String,
    val urlAntes: String?,
    val escribio: Boolean,
    /** "aplicado" | "ya_estaba" | "no" */
    val bloqueo: String,
)

/** Foto del chip al apoyarlo: qué link tiene y si ya tiene candado. */
class Foto(val chip: String?, val url: String?, val protegido: Boolean?)

/**
 * Chip NTAG213 / 215 / 216 por comandos crudos. Esto es lo que Web NFC no deja
 * hacer: PWD_AUTH y escribir las páginas de configuración (PWD, PACK, AUTH0).
 *
 * Mapa de páginas (páginas de 4 bytes):
 *   213: usuario 4..39,  config 0x29 (CFG0), 0x2A (CFG1/ACCESS), 0x2B (PWD), 0x2C (PACK)
 *   215: usuario 4..129, config 0x83 …
 *   216: usuario 4..225, config 0xE3 …
 * AUTH0 (byte 3 de CFG0) = primera página protegida; ≥ 0xFF = sin protección.
 * ACCESS (byte 0 de CFG1): bit7 PROT (1 = también protege lectura), bits 2..0 AUTHLIM.
 */
class Ntag(private val canal: Transporte) : AutoCloseable {

    private class Layout(val nombre: String, val ultimaPagina: Int, val cfg: Int)

    private val layout: Layout

    init {
        try {
            canal.connect()
            layout = detectar()
        } catch (e: Perdido) {
            throw ChipError("perdido", "Se perdió el chip.")
        } catch (e: IOException) {
            // Lo más común: el chip ya no está apoyado.
            throw ChipError("perdido", "No pude hablar con el chip (${e.message}). Apoyalo de nuevo.")
        }
    }

    override fun close() {
        try { canal.close() } catch (_: IOException) { /* ya estaba cerrado */ }
    }

    // --- comandos crudos -------------------------------------------------

    private fun transceive(vararg b: Int): ByteArray =
        canal.transceive(ByteArray(b.size) { b[it].toByte() })

    private fun leer(pagina: Int): ByteArray {
        val r = transceive(0x30, pagina) // READ: devuelve 4 páginas (16 bytes)
        if (r.size < 16) throw IOException("lectura corta (${r.size} bytes)")
        return r
    }

    private fun escribir(pagina: Int, d: ByteArray) {
        require(d.size == 4)
        val r = canal.transceive(byteArrayOf(0xA2.toByte(), pagina.toByte(), d[0], d[1], d[2], d[3]))
        // ACK = 0x0A (4 bits). Cualquier otra cosa de un byte es NAK.
        if (r.size == 1 && (r[0].toInt() and 0x0F) != 0x0A) throw IOException("NAK al escribir la página $pagina")
    }

    private fun detectar(): Layout {
        try {
            val v = transceive(0x60) // GET_VERSION
            if (v.size >= 8 && v[1] == 0x04.toByte() && v[2] == 0x04.toByte()) {
                when (v[6].toInt() and 0xFF) {
                    0x0F -> return Layout("NTAG213", 39, 0x29)
                    0x11 -> return Layout("NTAG215", 129, 0x83)
                    0x13 -> return Layout("NTAG216", 225, 0xE3)
                }
            }
        } catch (e: Perdido) {
            if (!canal.reconectar()) throw e
        } catch (_: IOException) {
            if (!canal.reconectar()) throw Perdido()
        }
        // Plan B: el Capability Container (página 3, byte 2 = bytes de usuario / 8).
        val cc = leer(3)
        return when (cc[2].toInt() and 0xFF) {
            0x12 -> Layout("NTAG213", 39, 0x29)
            0x3E -> Layout("NTAG215", 129, 0x83)
            0x6D -> Layout("NTAG216", 225, 0xE3)
            else -> throw ChipError("no_ntag", "No es una NTAG213/215/216 (CC=${cc[2].toInt() and 0xFF}).")
        }
    }

    private val capacidadBytes get() = (layout.ultimaPagina - 4 + 1) * 4

    // --- protección ------------------------------------------------------

    /** true = tiene candado (escritura protegida). */
    private fun estaProtegido(): Boolean = try {
        val auth0 = leer(layout.cfg)[3].toInt() and 0xFF
        auth0 <= layout.ultimaPagina
    } catch (e: IOException) {
        // Con PROT=1 hasta leer la config exige clave: el chip responde NAK.
        if (canal.reconectar()) true else throw Perdido()
    }

    /** PWD_AUTH. true si la clave es la correcta (y devuelve el PACK esperado). */
    private fun autenticar(pwd: ByteArray, pack: ByteArray): Boolean = try {
        val r = canal.transceive(byteArrayOf(0x1B, pwd[0], pwd[1], pwd[2], pwd[3]))
        r.size >= 2 && r[0] == pack[0] && r[1] == pack[1]
    } catch (e: IOException) {
        // Clave incorrecta → NAK. Si el chip sigue ahí lo re-seleccionamos; si no, se perdió.
        if (!canal.reconectar()) throw Perdido()
        false
    }

    // --- NDEF ------------------------------------------------------------

    private fun leerNdef(): ByteArray? {
        var datos = ByteArray(0)
        var pagina = 4
        fun asegurar(n: Int): Boolean {
            while (datos.size < n) {
                if (pagina > layout.ultimaPagina) return false
                datos += leer(pagina)
                pagina += 4
            }
            return true
        }
        if (!asegurar(4)) return null
        var i = 0
        while (i < 3 && datos[i] == 0x00.toByte()) i++
        if (datos[i] != 0x03.toByte()) return null
        val largo: Int
        val cab: Int
        if ((datos[i + 1].toInt() and 0xFF) == 0xFF) {
            if (!asegurar(i + 4)) return null
            largo = ((datos[i + 2].toInt() and 0xFF) shl 8) or (datos[i + 3].toInt() and 0xFF)
            cab = 4
        } else {
            largo = datos[i + 1].toInt() and 0xFF
            cab = 2
        }
        if (largo > capacidadBytes || !asegurar(i + cab + largo)) return null
        return datos.copyOfRange(i + cab, i + cab + largo)
    }

    private fun escribirNdef(mensaje: ByteArray) {
        val tlv = (if (mensaje.size < 0xFF) {
            byteArrayOf(0x03, mensaje.size.toByte()) + mensaje
        } else {
            byteArrayOf(0x03, 0xFF.toByte(), (mensaje.size shr 8).toByte(), mensaje.size.toByte()) + mensaje
        }) + byteArrayOf(0xFE.toByte())
        if (tlv.size > capacidadBytes) {
            throw ChipError("sin_espacio", "El mensaje (${tlv.size} bytes) no entra en una ${layout.nombre} ($capacidadBytes bytes).")
        }
        val relleno = tlv.copyOf((tlv.size + 3) / 4 * 4)
        var pagina = 4
        for (off in relleno.indices step 4) {
            escribir(pagina++, relleno.copyOfRange(off, off + 4))
        }
    }

    // --- API pública -----------------------------------------------------

    /** Lo que se ve al apoyar el chip, sin tocar nada. */
    fun fotografiar(): Foto {
        val protegido = estaProtegido()
        val url = try {
            leerNdef()?.let { NdefUtil.urlDe(it) }
        } catch (_: IOException) {
            null
        }
        return Foto(layout.nombre, url, protegido)
    }

    /**
     * Pasada completa: autentica si hace falta, escribe el mensaje, lo verifica y
     * (opcional) arma el candado con la clave derivada del UID.
     */
    fun aplicar(mensaje: ByteArray?, pwd: ByteArray?, pack: ByteArray?, bloquear: Boolean): Resultado {
        try {
            val protegido = estaProtegido()
            var autenticado = false
            if (protegido) {
                if (pwd == null || pack == null) {
                    throw ChipError("clave_distinta", "El chip tiene candado y no tengo su clave.")
                }
                if (!autenticar(pwd, pack)) {
                    throw ChipError("clave_distinta", "El chip está bloqueado con otra clave.")
                }
                autenticado = true
            }

            val urlAntes = try { leerNdef()?.let { NdefUtil.urlDe(it) } } catch (_: IOException) { null }

            if (mensaje != null) {
                // Validamos el tamaño antes de tocar nada del chip.
                escribirNdef(mensaje)
                val leido = leerNdef()
                if (leido == null || !leido.contentEquals(mensaje)) {
                    throw ChipError("verificacion", "Lo escrito no coincide con lo leído de vuelta.")
                }
            }

            var bloqueo = "no"
            if (bloquear) {
                if (pwd == null || pack == null) throw ChipError("io", "Falta la clave para bloquear.")
                if (protegido && autenticado) {
                    bloqueo = "ya_estaba"
                } else {
                    armarCandado(pwd, pack)
                    bloqueo = "aplicado"
                }
            }
            return Resultado(layout.nombre, urlAntes, mensaje != null, bloqueo)
        } catch (e: Perdido) {
            throw ChipError("perdido", "Se perdió el chip — mantenelo pegado.")
        } catch (e: IOException) {
            throw ChipError("io", "Falló la comunicación con el chip: ${e.message}")
        }
    }

    /**
     * Candado: PWD, PACK, ACCESS y recién al final AUTH0 (es el que "arma"). Después
     * se verifica: AUTH0 leído de vuelta y PWD_AUTH con la clave nueva.
     */
    private fun armarCandado(pwd: ByteArray, pack: ByteArray) {
        val cfg = layout.cfg
        val actual = leer(cfg)
        val cfg0 = actual.copyOfRange(0, 4)
        val cfg1 = actual.copyOfRange(4, 8)

        escribir(cfg + 2, pwd)
        escribir(cfg + 3, byteArrayOf(pack[0], pack[1], 0, 0))
        // PROT = 0 (la lectura queda libre para el celular de quien toca) y AUTHLIM = 0
        // (sin tope de intentos: un tope se puede quemar y dejar el chip sin edición).
        cfg1[0] = (cfg1[0].toInt() and 0x78).toByte()
        escribir(cfg + 1, cfg1)
        cfg0[3] = 0x04 // proteger la escritura desde la página 4 (todo el NDEF)
        escribir(cfg, cfg0)

        val leido = leer(cfg)
        if ((leido[3].toInt() and 0xFF) != 0x04) {
            throw ChipError("verificacion", "El candado no quedó armado (AUTH0 = ${leido[3].toInt() and 0xFF}).")
        }
        if (!autenticar(pwd, pack)) {
            throw ChipError("verificacion", "La clave escrita no autentica: revisá el chip.")
        }
    }
}
