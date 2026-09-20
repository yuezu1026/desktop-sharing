package com.mobilescaffold

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 钉住 MediaCodec 输入契约：Annex-B 起始码、去掉 SPS/PPS。 */
class H264AnnexBTest {
  @Test
  fun annexBForDecoderInput_stripsSpsPps_keepsStartCodes() {
    val sps = byteArrayOf(0, 0, 0, 1, 0x67, 0x42, 0xc0.toByte(), 0x1e)
    val pps = byteArrayOf(0, 0, 0, 1, 0x68, 0xce.toByte(), 0x06, 0xe2.toByte())
    val idr = byteArrayOf(0, 0, 0, 1, 0x65, 0x88.toByte(), 0x80.toByte())
    val stream = sps + pps + idr

    val input = H264ToJpegDecoder.annexBForDecoderInput(stream)
    assertNotNull(input)
    val body = input!!
    assertEquals(0.toByte(), body[0])
    assertEquals(0.toByte(), body[1])
    assertEquals(0.toByte(), body[2])
    assertEquals(1.toByte(), body[3])
    assertEquals(0x65.toByte(), body[4])
    assertTrue(H264ToJpegDecoder.annexBHasIdr(body))
    assertNull(H264ToJpegDecoder.findSpsPps(body))
  }

  @Test
  fun alignMacroblock_matchesSessionCore() {
    assertEquals(960, H264ToJpegDecoder.alignMacroblock(960))
    assertEquals(528, H264ToJpegDecoder.alignMacroblock(540))
    assertEquals(16, H264ToJpegDecoder.alignMacroblock(15))
  }
}
