package com.routinist.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.routinist.wear.ui.RunApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // 2026-08-12 Play 거절 fix — 콜드스타트에 앱 아이콘 스플래시.
        // 반드시 super.onCreate 앞에서 호출해야 스플래시가 잡힌다.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        WorkoutManager.initTts(this)
        setContent { RunApp() }
    }
}
