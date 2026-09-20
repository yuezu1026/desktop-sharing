package com.mobilescaffold

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import kotlin.concurrent.thread

/**
 * 控制端进中继：TLS + hello + RDS1。本刀先把 JPEG 帧以 base64 回传给 JS。
 * 本地自签证书在调试构建里信任；上线要换成系统信任链。
 */
class SessionRelayModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val running = AtomicBoolean(false)
  @Volatile private var worker: Thread? = null
  @Volatile private var socket: SSLSocket? = null

  override fun getName(): String = "SessionRelay"

  @ReactMethod
  fun connect(address: String, ticket: String, fingerprint: String) {
    stopInternal()
    running.set(true)
    emit("connecting", null)
    worker = thread(name = "session-relay", isDaemon = true) {
      try {
        runSession(address.trim(), ticket.trim(), fingerprint.trim())
      } catch (error: Exception) {
        emit("error", Arguments.createMap().apply {
          putString("message", error.message ?: "中继未接通")
        })
      } finally {
        running.set(false)
        closeSocket()
        emit("closed", null)
      }
    }
  }

  @ReactMethod
  fun disconnect() {
    stopInternal()
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // RN 事件订阅占位
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // RN 事件订阅占位
  }

  private fun stopInternal() {
    running.set(false)
    closeSocket()
    worker?.interrupt()
    worker = null
  }

  private fun closeSocket() {
    try {
      socket?.close()
    } catch (_: Exception) {
    }
    socket = null
  }

  private fun runSession(address: String, ticket: String, fingerprint: String) {
    if (ticket.length < 20 || fingerprint.length < 8) {
      throw IllegalArgumentException("票据或指纹不正确")
    }
    val hostPort = splitHostPort(address)
    val ssl = trustAllContext().socketFactory.createSocket() as SSLSocket
    socket = ssl
    ssl.soTimeout = 3000
    ssl.connect(InetSocketAddress(hostPort.first, hostPort.second), 8000)
    ssl.startHandshake()
    val output = DataOutputStream(ssl.outputStream)
    val helloBody = buildHelloJson(ticket, fingerprint).toByteArray(StandardCharsets.UTF_8)
    output.writeInt(helloBody.size)
    output.write(helloBody)
    output.flush()
    emit("connected", null)

    val input = DataInputStream(ssl.inputStream)
    val pending = ByteArrayOutputStream()
    val chunk = ByteArray(16 * 1024)
    while (running.get() && !Thread.currentThread().isInterrupted) {
      val read = try {
        input.read(chunk)
      } catch (_: java.net.SocketTimeoutException) {
        continue
      }
      if (read < 0) break
      if (read == 0) continue
      pending.write(chunk, 0, read)
      drainFrames(pending)
    }
  }

  private fun drainFrames(pending: ByteArrayOutputStream) {
    var bytes = pending.toByteArray()
    while (true) {
      if (bytes.size < 12) {
        pending.reset()
        pending.write(bytes)
        return
      }
      if (bytes[0] != 'R'.code.toByte() || bytes[1] != 'D'.code.toByte() ||
        bytes[2] != 'S'.code.toByte() || bytes[3] != '1'.code.toByte() || bytes[4] != 1.toByte()
      ) {
        pending.reset()
        return
      }
      val payloadLength = ByteBuffer.wrap(bytes, 8, 4).int
      if (payloadLength < 0 || payloadLength > 4 * 1024 * 1024) {
        pending.reset()
        return
      }
      val total = 12 + payloadLength
      if (bytes.size < total) {
        pending.reset()
        pending.write(bytes)
        return
      }
      val kind = bytes[5].toInt() and 0xff
      val payload = bytes.copyOfRange(12, total)
      if (kind == 1) {
        handleVideo(payload)
      }
      bytes = bytes.copyOfRange(total, bytes.size)
    }
  }

  private fun handleVideo(payload: ByteArray) {
    if (payload.size < 6) return
    val width = ((payload[0].toInt() and 0xff) shl 8) or (payload[1].toInt() and 0xff)
    val height = ((payload[2].toInt() and 0xff) shl 8) or (payload[3].toInt() and 0xff)
    val codec = payload[4].toInt() and 0xff
    val body = payload.copyOfRange(6, payload.size)
    if (codec == 1) {
      val map = Arguments.createMap()
      map.putInt("width", width)
      map.putInt("height", height)
      map.putString("jpegBase64", Base64.encodeToString(body, Base64.NO_WRAP))
      emit("frame", map)
    } else if (codec == 2) {
      emit("h264", null)
    }
  }

  private fun emit(type: String, extra: com.facebook.react.bridge.WritableMap?) {
    val map = Arguments.createMap()
    map.putString("type", type)
    if (extra != null) {
      map.merge(extra)
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("sessionRelay", map)
  }

  private fun buildHelloJson(ticket: String, fingerprint: String): String {
    return "{\"ticket\":${jsonString(ticket)},\"role\":\"controller\",\"fingerprint\":${jsonString(fingerprint)}}"
  }

  private fun jsonString(value: String): String {
    val escaped = StringBuilder(value.length + 2)
    escaped.append('"')
    for (ch in value) {
      when (ch) {
        '"' -> escaped.append("\\\"")
        '\\' -> escaped.append("\\\\")
        '\n' -> escaped.append("\\n")
        '\r' -> escaped.append("\\r")
        '\t' -> escaped.append("\\t")
        else -> escaped.append(ch)
      }
    }
    escaped.append('"')
    return escaped.toString()
  }

  private fun splitHostPort(address: String): Pair<String, Int> {
    val index = address.lastIndexOf(':')
    if (index <= 0) throw IllegalArgumentException("中继地址不正确")
    val host = address.substring(0, index)
    val port = address.substring(index + 1).toIntOrNull()
      ?: throw IllegalArgumentException("中继端口不正确")
    return host to port
  }

  private fun trustAllContext(): SSLContext {
    val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    })
    val context = SSLContext.getInstance("TLS")
    context.init(null, trustAll, SecureRandom())
    return context
  }
}
