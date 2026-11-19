package tech.nexttap.chips

import android.nfc.Tag
import android.nfc.TagLostException
import android.nfc.tech.NfcA
import java.io.IOException

/** [Transporte] real: NfcA del teléfono. */
class TransporteNfcA(tag: Tag) : Transporte {
    private val nfca: NfcA = NfcA.get(tag) ?: throw ChipError("no_ntag", "El chip no habla NFC-A: no es una NTAG.")

    override fun connect() {
        try {
            nfca.connect()
            nfca.timeout = 2500
        } catch (e: TagLostException) {
            throw Perdido()
        }
    }

    override fun close() {
        try { nfca.close() } catch (_: IOException) { /* ya estaba cerrado */ }
    }

    override fun transceive(datos: ByteArray): ByteArray = try {
        nfca.transceive(datos)
    } catch (e: TagLostException) {
        throw Perdido()
    }

    override fun reconectar(): Boolean = try {
        nfca.close()
        nfca.connect()
        nfca.timeout = 2500
        true
    } catch (_: IOException) {
        false
    }
}

fun abrirNtag(tag: Tag): Ntag = Ntag(TransporteNfcA(tag))
