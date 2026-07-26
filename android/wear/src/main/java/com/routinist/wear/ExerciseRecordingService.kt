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
import androidx.core.content.ContextCompat

/**
 * ExerciseClient 를 감싸는 health|location 포그라운드 서비스.
 * Wear OS 5+ 는 운동 트래킹을 health 타입 FGS 안에서 돌려야 화면 잠금·손목 내림에도 유지된다.
 */
class ExerciseRecordingService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        // 서비스가 살아난 뒤 실제 운동 시작 (ExerciseClient 는 이 프로세스에서 유지됨)
        WorkoutManager.beginExercise(applicationContext)
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
