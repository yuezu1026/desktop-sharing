package com.mobilescaffold

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/** Annex-B → MediaCodec → JPEG。供 SessionRelay 把 H264 画回 JS。 */
class H264ToJpegDecoder {
  private var codec: MediaCodec? = null
  private var configured = false
  private var outputWidth = 0
  private var outputHeight = 0

  fun close() {
    try {
      codec?.stop()
    } catch (_: Exception) {
    }
    try {
      codec?.release()
    } catch (_: Exception) {
    }
    codec = null
    configured = false
  }

  /**
   * @return Pair(width, height, jpegBytes) 或 null
   */
  fun pushAnnexB(annexB: ByteArray, hintWidth: Int, hintHeight: Int): Triple<Int, Int, ByteArray>? {
    if (annexB.isEmpty()) return null
    if (!configured) {
      val pair = findSpsPps(annexB) ?: return null
      openCodec(pair.first, pair.second, hintWidth.coerceAtLeast(16), hintHeight.coerceAtLeast(16))
      configured = true
    }
    val active = codec ?: return null
    val accessUnit = annexBToLengthPrefixed(annexB) ?: return null
    val isKey = annexBHasIdr(annexB)
    feedInput(active, accessUnit, isKey)
    return drainJpeg(active)
  }

  private fun openCodec(sps: ByteArray, pps: ByteArray, width: Int, height: Int) {
    close()
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
    format.setByteBuffer("csd-0", ByteBuffer.wrap(sps))
    format.setByteBuffer("csd-1", ByteBuffer.wrap(pps))
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 2 * 1024 * 1024)
    val decoder = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    decoder.configure(format, null, null, 0)
    decoder.start()
    codec = decoder
    outputWidth = width
    outputHeight = height
  }

  private fun feedInput(decoder: MediaCodec, data: ByteArray, keyframe: Boolean) {
    val index = decoder.dequeueInputBuffer(8_000)
    if (index < 0) return
    val buffer = decoder.getInputBuffer(index) ?: return
    buffer.clear()
    buffer.put(data)
    val flags = if (keyframe) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
    decoder.queueInputBuffer(index, 0, data.size, System.nanoTime() / 1000, flags)
  }

  private fun drainJpeg(decoder: MediaCodec): Triple<Int, Int, ByteArray>? {
    val info = MediaCodec.BufferInfo()
    val index = decoder.dequeueOutputBuffer(info, 8_000)
    if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
      val format = decoder.outputFormat
      outputWidth = format.getInteger(MediaFormat.KEY_WIDTH)
      outputHeight = format.getInteger(MediaFormat.KEY_HEIGHT)
      return drainJpeg(decoder)
    }
    if (index < 0) return null
    try {
      val image = decoder.getOutputImage(index) ?: return null
      val nv21 = yuv420ToNv21(image)
      val width = image.width
      val height = image.height
      image.close()
      val yuv = YuvImage(nv21, ImageFormat.NV21, width, height, null)
      val jpeg = ByteArrayOutputStream()
      if (!yuv.compressToJpeg(Rect(0, 0, width, height), 70, jpeg)) return null
      return Triple(width, height, jpeg.toByteArray())
    } finally {
      decoder.releaseOutputBuffer(index, false)
    }
  }

  companion object {
    fun splitAnnexB(bytes: ByteArray): List<ByteArray> {
      val nals = ArrayList<ByteArray>()
      var index = 0
      while (index + 3 < bytes.size) {
        val startCode = when {
          bytes[index] == 0.toByte() && bytes[index + 1] == 0.toByte() && bytes[index + 2] == 1.toByte() -> 3
          index + 4 <= bytes.size &&
            bytes[index] == 0.toByte() && bytes[index + 1] == 0.toByte() &&
            bytes[index + 2] == 0.toByte() && bytes[index + 3] == 1.toByte() -> 4
          else -> {
            index += 1
            continue
          }
        }
        val nalStart = index + startCode
        var nalEnd = bytes.size
        var scan = nalStart
        while (scan + 3 < bytes.size) {
          if (bytes[scan] == 0.toByte() && bytes[scan + 1] == 0.toByte() && bytes[scan + 2] == 1.toByte()) {
            nalEnd = scan
            break
          }
          if (
            scan + 4 <= bytes.size &&
            bytes[scan] == 0.toByte() && bytes[scan + 1] == 0.toByte() &&
            bytes[scan + 2] == 0.toByte() && bytes[scan + 3] == 1.toByte()
          ) {
            nalEnd = scan
            break
          }
          scan += 1
        }
        if (nalEnd > nalStart) {
          nals.add(bytes.copyOfRange(nalStart, nalEnd))
        }
        index = nalEnd
      }
      return nals
    }

    fun nalType(nal: ByteArray): Int = if (nal.isEmpty()) 0 else nal[0].toInt() and 0x1f

    fun annexBHasIdr(bytes: ByteArray): Boolean =
      splitAnnexB(bytes).any { nalType(it) == 5 }

    fun findSpsPps(bytes: ByteArray): Pair<ByteArray, ByteArray>? {
      var sps: ByteArray? = null
      var pps: ByteArray? = null
      for (nal in splitAnnexB(bytes)) {
        when (nalType(nal)) {
          7 -> if (sps == null) sps = nal
          8 -> if (pps == null) pps = nal
        }
      }
      val foundSps = sps ?: return null
      val foundPps = pps ?: return null
      return foundSps to foundPps
    }

    fun annexBToLengthPrefixed(bytes: ByteArray): ByteArray? {
      val nals = splitAnnexB(bytes).filter {
        val type = nalType(it)
        type != 7 && type != 8 && type != 9
      }
      if (nals.isEmpty()) return null
      var total = 0
      for (nal in nals) total += 4 + nal.size
      val out = ByteArray(total)
      var offset = 0
      for (nal in nals) {
        val length = nal.size
        out[offset++] = ((length ushr 24) and 0xff).toByte()
        out[offset++] = ((length ushr 16) and 0xff).toByte()
        out[offset++] = ((length ushr 8) and 0xff).toByte()
        out[offset++] = (length and 0xff).toByte()
        System.arraycopy(nal, 0, out, offset, length)
        offset += length
      }
      return out
    }

    fun yuv420ToNv21(image: android.media.Image): ByteArray {
      val width = image.width
      val height = image.height
      val ySize = width * height
      val nv21 = ByteArray(ySize + ySize / 2)
      val yPlane = image.planes[0]
      val uPlane = image.planes[1]
      val vPlane = image.planes[2]
      val yBuffer = yPlane.buffer
      val uBuffer = uPlane.buffer
      val vBuffer = vPlane.buffer
      val yRowStride = yPlane.rowStride
      val yPixelStride = yPlane.pixelStride
      var pos = 0
      for (row in 0 until height) {
        val yRow = row * yRowStride
        for (col in 0 until width) {
          nv21[pos++] = yBuffer.get(yRow + col * yPixelStride)
        }
      }
      val chromaHeight = height / 2
      val chromaWidth = width / 2
      val vRowStride = vPlane.rowStride
      val uRowStride = uPlane.rowStride
      val vPixelStride = vPlane.pixelStride
      val uPixelStride = uPlane.pixelStride
      for (row in 0 until chromaHeight) {
        for (col in 0 until chromaWidth) {
          nv21[pos++] = vBuffer.get(row * vRowStride + col * vPixelStride)
          nv21[pos++] = uBuffer.get(row * uRowStride + col * uPixelStride)
        }
      }
      return nv21
    }

    fun toBase64(jpeg: ByteArray): String = Base64.encodeToString(jpeg, Base64.NO_WRAP)
  }
}
