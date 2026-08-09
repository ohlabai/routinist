package com.routinist.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * ExerciseClient 를 감싸는 health|location 포그라운드 서비스.
 * Wear OS 5+ 는 운동 트래킹을 health 타입 FGS 안에서 돌려야 화면 잠금·손목 내림에도 유지된다.
 */
class ExerciseRecordingService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 2026-08-09 리뷰 P0: startForeground 는 카운트다운 중 손목을 내리면 API 31+ 에서
        // ForegroundServiceStartNotAllowedException, API 34+ 권한 미비면 SecurityException 을
        // 던진다 — try/catch 없으면 주 진입 경로 하드 크래시. 실패 시 정리하고 접는다.
        try {
            startForegroundCompat()
        } catch (e: Exception) {
            Log.e("ExerciseRecording", "startForeground failed — self stop", e)
            stopSelf()
            return START_NOT_STICKY
        }
        // START_STICKY 재기동 (null intent) 은 이미 러닝 중인 세션을 beginExercise 로 초기화
        // (route.clear·startMs 리셋)해 진행 기록을 날린다 → 실제 시작 요청(intent != null)만 처리.
        if (intent != null && !WorkoutManager.isRunning()) {
            WorkoutManager.beginExercise(applicationContext)
        }
        return START_STICKY
    }

    private fun startForegroundCompat() {
        val channelId = "run_tracking"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(channelId, "러닝 기록", NotificationManager.IMPORTANCE_LOW)
            nm.createNotificationChannel(ch)
        }
        val notification: Notification = Notification.Builder(this, channelId)
            .setContentTitle("러닝 기록 중")
            .setContentText("거리·시간·심박을 측정하고 있어요")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // API 34+ (Wear OS 5): health 타입 필수 + GPS 는 location 타입
            startForeground(
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    companion object {
        private const val NOTIF_ID = 42

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context, Intent(context, ExerciseRecordingService::class.java),
            )
        }

        fun stop(context: Context?) {
            context ?: return
            context.stopService(Intent(context, ExerciseRecordingService::class.java))
        }
    }
}
