package tech.nexttap.chips

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NtagTest {
    private val pwd = byteArrayOf(0x68, 0xCF.toByte(), 0xCA.toByte(), 0xB4.toByte())
    private val pack = byteArrayOf(0x8A.toByte(), 0xB6.toByte())
    private val otraPwd = byteArrayOf(1, 2, 3, 4)

    private fun uri(u: String) = NdefUtil.registroUri(u)

    private fun esperarError(codigo: String, bloque: () -> Unit) {
        try {
            bloque()
            fail("tenía que fallar con $codigo")
        } catch (e: ChipError) {
            assertEquals(codigo, e.codigo)
        }
    }

    @Test
    fun chipVirgen_escribeYBloquea() {
        val chip = NtagSimulada()
        val url = "https://next-tap.tech/v/abc123"
        val r = Ntag(chip).use { it.aplicar(uri(url), pwd, pack, true) }

        assertEquals("NTAG213", r.chip)
        assertEquals("aplicado", r.bloqueo)
        assertTrue(r.escribio)
        assertEquals(4, chip.auth0)
        assertFalse("la lectura tiene que quedar libre", chip.prot)
        assertEquals(0, chip.authlim)
        assertArrayEquals(pwd, chip.paginas[43])
        assertArrayEquals(byteArrayOf(pack[0], pack[1], 0, 0), chip.paginas[44])

        // Un teléfono cualquiera (sin clave) lee el link pero no puede escribir.
        chip.reconectar()
        val foto = Ntag(chip).use { it.fotografiar() }
        assertEquals(url, foto.url)
        assertEquals(true, foto.protegido)
        esperarError("clave_distinta") { Ntag(chip).use { it.aplicar(uri("https://malo.com"), null, null, false) } }
        esperarError("clave_distinta") { Ntag(chip).use { it.aplicar(uri("https://malo.com"), otraPwd, pack, false) } }
        assertEquals(url, Ntag(chip).use { it.fotografiar() }.url)
    }

    @Test
    fun chipYaBloqueadoConNuestraClave_seReescribe() {
        val chip = NtagSimulada()
        Ntag(chip).use { it.aplicar(uri("https://next-tap.tech/v/viejo"), pwd, pack, true) }
        chip.reconectar()

        val nuevo = "https://mi-link-personal.com/hola?x=1"
        val r = Ntag(chip).use { it.aplicar(uri(nuevo), pwd, pack, true) }
        assertEquals("ya_estaba", r.bloqueo)
        assertEquals("https://next-tap.tech/v/viejo", r.urlAntes)
        assertEquals(4, chip.auth0)
        chip.reconectar()
        assertEquals(nuevo, Ntag(chip).use { it.fotografiar() }.url)
    }

    @Test
    fun chipBloqueadoConOtraClave_noSeToca() {
        val chip = NtagSimulada()
        chip.paginas[4] = byteArrayOf(0x03, 0x00, 0xFE.toByte(), 0x00)
        chip.bloquearConClave(otraPwd, byteArrayOf(9, 9))
        val antes = chip.paginas.map { it.copyOf() }

        esperarError("clave_distinta") { Ntag(chip).use { it.aplicar(uri("https://x.com"), pwd, pack, true) } }
        // Después del NAK el chip se puede volver a usar y sigue idéntico.
        for (i in 0 until 45) assertArrayEquals("página $i", antes[i], chip.paginas[i])
        assertEquals(true, Ntag(chip).use { it.fotografiar() }.protegido)
    }

    @Test
    fun soloEscribir_sinBloquear() {
        val chip = NtagSimulada()
        val r = Ntag(chip).use { it.aplicar(uri("http://www.ejemplo.com/a"), null, null, false) }
        assertEquals("no", r.bloqueo)
        assertEquals(255, chip.auth0)
        assertEquals("http://www.ejemplo.com/a", Ntag(chip).use { it.fotografiar() }.url)
    }

    @Test
    fun soloBloquear_sinCambiarElLink() {
        val chip = NtagSimulada()
        Ntag(chip).use { it.aplicar(uri("https://next-tap.tech/v/zzz"), null, null, false) }
        val r = Ntag(chip).use { it.aplicar(null, pwd, pack, true) }
        assertEquals("aplicado", r.bloqueo)
        assertFalse(r.escribio)
        chip.reconectar()
        assertEquals("https://next-tap.tech/v/zzz", Ntag(chip).use { it.fotografiar() }.url)
    }

    @Test
    fun linkQueNoEntra_noTocaNadaDelChip() {
        val chip = NtagSimulada()
        Ntag(chip).use { it.aplicar(uri("https://next-tap.tech/v/ok"), null, null, false) }
        val largo = "https://x.com/" + "a".repeat(200)
        esperarError("sin_espacio") { Ntag(chip).use { it.aplicar(uri(largo), pwd, pack, true) } }
        assertEquals(255, chip.auth0) // ni se intentó bloquear
        assertEquals("https://next-tap.tech/v/ok", Ntag(chip).use { it.fotografiar() }.url)
    }

    @Test
    fun mimeDe200Bytes_noEntraEnUnaNtag213() {
        val chip = NtagSimulada()
        val m = NdefUtil.registroMime("application/octet-stream", ByteArray(200))
        esperarError("sin_espacio") { Ntag(chip).use { it.aplicar(m, null, null, false) } }
    }

    @Test
    fun chipQueSeVaEnElMedio_dicePerdido() {
        // Probamos perderlo en cada comando posible: nunca puede quedar "a medias" sin avisar.
        for (corte in 3..60) {
            val chip = NtagSimulada()
            chip.perderEn = corte
            try {
                Ntag(chip).use { it.aplicar(uri("https://next-tap.tech/v/medio"), pwd, pack, true) }
            } catch (e: ChipError) {
                assertEquals("corte en $corte", "perdido", e.codigo)
                // Si el corte fue durante el candado, nunca puede quedar AUTH0 armado con PWD sin escribir:
                if (chip.auth0 == 4) assertArrayEquals("corte en $corte", pwd, chip.paginas[43])
            }
        }
    }

    @Test
    fun candadoSeArmaConAuth0AlFinal() {
        // Si el corte pasa antes del último paso, el chip queda abierto (se puede reintentar).
        val chip = NtagSimulada()
        var vistoAbiertoConPwd = false
        for (corte in 3..60) {
            val c = NtagSimulada()
            c.perderEn = corte
            try { Ntag(c).use { it.aplicar(null, pwd, pack, true) } } catch (_: ChipError) {}
            if (c.auth0 == 255 && c.paginas[43].contentEquals(pwd)) vistoAbiertoConPwd = true
            // Nunca AUTH0 armado sin la clave escrita: sería un chip bloqueado que nadie puede abrir.
            if (c.auth0 == 4) assertArrayEquals("corte $corte", pwd, c.paginas[43])
        }
        assertTrue(vistoAbiertoConPwd)
        // Y reintentar sobre un chip a medio armar termina bien.
        val medio = NtagSimulada()
        medio.paginas[43] = pwd.copyOf()
        medio.paginas[44] = byteArrayOf(pack[0], pack[1], 0, 0)
        assertEquals("aplicado", Ntag(medio).use { it.aplicar(null, pwd, pack, true) }.bloqueo)
    }

    @Test
    fun ndefUtil_idaYVuelta() {
        for (u in listOf(
            "https://www.next-tap.tech/v/a", "http://www.x.com", "https://a.com/?q=ñandú&z=%20",
            "http://insegura.com", "otro-esquema:cosa",
        )) assertEquals(u, NdefUtil.urlDe(NdefUtil.registroUri(u)))
        assertNull(NdefUtil.urlDe(NdefUtil.registroMime("text/plain", "hola".toByteArray())))
    }
}
