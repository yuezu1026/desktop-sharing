package com.mobilescaffold

import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.util.Base64
import android.view.Surface
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/** 解码结果：Surface 直出或 JPEG 回传。 */
sealed class H264DecodeResult {
  data class SurfaceFrame(val width: Int, val height: Int) : H264DecodeResult()
  data class JpegFrame(val width: Int, val height: Int, val jpeg: ByteArray) : H264DecodeResult()
}

/** Annex-B → MediaCodec。有 Surface 时硬解直出；否则 YUV→JPEG 回传 JS。 */
class H264ToJpegDecoder {
  private var codec: MediaCodec? = null
  private var configured = false
  private var outputWidth = 0
  private var outputHeight = 0
  private var pendingSps: ByteArray? = null
  private var pendingPps: ByteArray? = null
  private var keyframeAsks = 0
  private var emptyDrains = 0
  @Volatile private var outputSurface: Surface? = null
  @Volatile private var surfaceGeneration = 0
  private var openedWithSurfaceGeneration = -1

  fun setOutputSurface(surface: Surface?) {
    outputSurface = surface
    surfaceGeneration += 1
    // 换 Surface 后需等关键帧重建解码器。
    if (configured) {
      releaseCodec()
      configured = false
    }
  }

  fun close() {
    releaseCodec()
    configured = false
    pendingSps = null
    pendingPps = null
    emptyDrains = 0
    outputSurface = null
  }

  fun needsKeyframe(): Boolean = !configured || keyframeAsks < 12 || emptyDrains >= 8

  fun pushAnnexB(annexB: ByteArray, hintWidth: Int, hintHeight: Int): H264DecodeResult? {
    if (annexB.isEmpty()) return null
    val found = findSpsPps(annexB)
    if (found != null) {
      pendingSps = found.first
      pendingPps = found.second
    }
    if (!configured || openedWithSurfaceGeneration != surfaceGeneration) {
      val sps = pendingSps ?: return null
      val pps = pendingPps ?: return null
      if (!annexBHasIdr(annexB)) {
        keyframeAsks += 1
        return null
      }
      try {
        openCodec(sps, pps, hintWidth.coerceAtLeast(16), hintHeight.coerceAtLeast(16))
        configured = true
        openedWithSurfaceGeneration = surfaceGeneration
        keyframeAsks = 0
        emptyDrains = 0
      } catch (_: Exception) {
        releaseCodec()
        configured = false
        keyframeAsks += 1
        return null
      }
    }
    val active = codec ?: return null
    val accessUnit = annexBForDecoderInput(annexB) ?: return null
    val isKey = annexBHasIdr(annexB)
    try {
      feedInput(active, accessUnit, isKey)
      val result = drain(active)
      if (result != null) {
        emptyDrains = 0
        return result
      }
      emptyDrains += 1
      if (emptyDrains >= 24) {
        releaseCodec()
        configured = false
        keyframeAsks += 1
      }
      return null
    } catch (_: Exception) {
      releaseCodec()
      configured = false
      keyframeAsks += 1
      emptyDrains = 0
      return null
    }
  }

  private fun releaseCodec() {
    try {
      codec?.stop()
    } catch (_: Exception) {
    }
    try {
      codec?.release()
    } catch (_: Exception) {
    }
    codec = null
  }

  private fun openCodec(sps: ByteArray, pps: ByteArray, width: Int, height: Int) {
    releaseCodec()
    val alignedWidth = alignMacroblock(width)
    val alignedHeight = alignMacroblock(height)
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, alignedWidth, alignedHeight)
    format.setByteBuffer("csd-0", ByteBuffer.wrap(withStartCode(sps)))
    format.setByteBuffer("csd-1", ByteBuffer.wrap(withStartCode(pps)))
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 2 * 1024 * 1024)
    val surface = outputSurface
    if (surface == null) {
      format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
    }
    val decoder = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    decoder.configure(format, surface, null, 0)
    decoder.start()
    codec = decoder
    outputWidth = alignedWidth
    outputHeight = alignedHeight
  }

  private fun feedInput(decoder: MediaCodec, data: ByteArray, keyframe: Boolean) {
    val index = decoder.dequeueInputBuffer(50_000)
    if (index < 0) return
    val buffer = decoder.getInputBuffer(index) ?: return
    buffer.clear()
    buffer.put(data)
    val flags = if (keyframe) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
    decoder.queueInputBuffer(index, 0, data.size, System.nanoTime() / 1000, flags)
  }

  private fun drain(decoder: MediaCodec): H264DecodeResult? {
    val useSurface = outputSurface != null
    val info = MediaCodec.BufferInfo()
    var attempts = 0
    while (attempts < 6) {
      attempts += 1
      val index = decoder.dequeueOutputBuffer(info, if (attempts == 1) 40_000 else 8_000)
      if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        val format = decoder.outputFormat
        outputWidth = format.getInteger(MediaFormat.KEY_WIDTH)
        outputHeight = format.getInteger(MediaFormat.KEY_HEIGHT)
        continue
      }
      if (index == MediaCodec.INFO_TRY_AGAIN_LATER) return null
      if (index < 0) return null
      if (useSurface) {
        decoder.releaseOutputBuffer(index, true)
        return H264DecodeResult.SurfaceFrame(outputWidth.coerceAtLeast(16), outputHeight.coerceAtLeast(16))
      }
      try {
        val image = decoder.getOutputImage(index)
        if (image != null) {
          val nv21 = yuv420ToNv21(image)
          val width = image.width
          val height = image.height
          image.close()
          val yuv = YuvImage(nv21, ImageFormat.NV21, width, height, null)
          val jpeg = ByteArrayOutputStream()
          if (!yuv.compressToJpeg(Rect(0, 0, width, height), 88, jpeg)) return null
          return H264DecodeResult.JpegFrame(width, height, jpeg.toByteArray())
        }
        val buffer = decoder.getOutputBuffer(index) ?: return null
        if (info.size <= 0) return null
        buffer.position(info.offset)
        buffer.limit(info.offset + info.size)
        val yuvBytes = ByteArray(info.size)
        buffer.get(yuvBytes)
        val width = outputWidth.coerceAtLeast(16)
        val height = outputHeight.coerceAtLeast(16)
        if (yuvBytes.size < width * height + width * height / 2) return null
        val yuv = YuvImage(yuvBytes, ImageFormat.NV21, width, height, null)
        val jpeg = ByteArrayOutputStream()
        if (!yuv.compressToJpeg(Rect(0, 0, width, height), 88, jpeg)) return null
        return H264DecodeResult.JpegFrame(width, height, jpeg.toByteArray())
      } finally {
        decoder.releaseOutputBuffer(index, false)
      }
    }
    return null
  }

  companion object {
    fun alignMacroblock(value: Int): Int {
      if (value <= 0) return 16
      val aligned = (value / 16) * 16
      return aligned.coerceAtLeast(16)
    }

    fun withStartCode(nal: ByteArray): ByteArray {
      if (
        nal.size >= 4 &&
        nal[0] == 0.toByte() && nal[1] == 0.toByte() &&
        nal[2] == 0.toByte() && nal[3] == 1.toByte()
      ) {
        return nal
      }
      if (nal.size >= 3 && nal[0] == 0.toByte() && nal[1] == 0.toByte() && nal[2] == 1.toByte()) {
        return nal
      }
      val out = ByteArray(4 + nal.size)
      out[0] = 0
      out[1] = 0
      out[2] = 0
      out[3] = 1
      System.arraycopy(nal, 0, out, 4, nal.size)
      return out
    }

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

    fun annexBForDecoderInput(bytes: ByteArray): ByteArray? {
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
        out[offset++] = 0
        out[offset++] = 0
        out[offset++] = 0
        out[offset++] = 1
        System.arraycopy(nal, 0, out, offset, nal.size)
        offset += nal.size
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
