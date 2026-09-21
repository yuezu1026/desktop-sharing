package com.mobilescaffold

import android.app.Activity
import android.os.Build
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

/**
 * 手持沉浸式：隐藏 / 恢复状态栏与导航栏（W6-09）。
 * 唤出靠边缘手势（App 层）；系统条短暂露出用 transient swipe。
 */
class SystemChromeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SystemChrome"

  @ReactMethod
  fun setHidden(hidden: Boolean) {
    UiThreadUtil.runOnUiThread {
      val activity: Activity = currentActivity ?: return@runOnUiThread
      val window = activity.window
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        window.attributes = window.attributes.apply {
          layoutInDisplayCutoutMode =
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        window.setDecorFitsSystemWindows(!hidden)
        val controller = window.insetsController ?: return@runOnUiThread
        if (hidden) {
          controller.hide(WindowInsets.Type.systemBars())
          controller.systemBarsBehavior =
            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
          controller.show(WindowInsets.Type.systemBars())
        }
        return@runOnUiThread
      }
      @Suppress("DEPRECATION")
      if (hidden) {
        window.decorView.systemUiVisibility = (
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
          )
      } else {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
      }
    }
  }
}
