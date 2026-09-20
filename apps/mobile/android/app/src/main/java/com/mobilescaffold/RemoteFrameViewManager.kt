package com.mobilescaffold

import android.graphics.SurfaceTexture
import android.view.Surface
import android.view.TextureView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

/** 把硬解画面画在 TextureView 上，避免 JPEG→JS→Image 二次有损。 */
class RemoteFrameViewManager : SimpleViewManager<TextureView>() {
  override fun getName(): String = "RemoteFrameView"

  override fun createViewInstance(reactContext: ThemedReactContext): TextureView {
    val view = TextureView(reactContext)
    view.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
        SessionRelayModule.attachOutputSurface(Surface(surfaceTexture))
      }

      override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) {}

      override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
        SessionRelayModule.detachOutputSurface()
        return true
      }

      override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) {}
    }
    return view
  }
}
