package com.routinist.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * 러닝 세션 Foreground Service (type=location) — RunSessionEngine 의 생명 유지 장치.
 *
 * WebView(JS) 는 잠금/앱 전환 시 suspend 되지만, 이 FGS 가 떠 있는 동안은
 * 프로세스 우선순위가 유지되고 FusedLocationProvider 콜백 + 엔진 tick 이 계속 돈다.
 * partial wake lock 으로 doze 진입 시 tick 정지도 차단 (러닝 앱 표준 패턴).
 *
 * 서비스 자체는 상태를 소유하지 않는다 — 알림 채널/텍스트 갱신 + wake lock 만 담당.
 * 시작/종료는 엔진의 startTrackingIfNeeded/stopTracking 이 호출.
 */
class RunSessionService : Service() {

    companion object {
        private const val CHANNEL_ID = "run_session"
        private const val NOTIFICATION_ID = 4001
        /** 마라톤 초과 안전망 — wake lock 최대 보유 시간 (10h). 세션 종료 시 즉시 해제. */
        private const val WAKE_LOCK_TIMEOUT_MS = 10L * 60 * 60 * 1000

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, RunSessionService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RunSessionService::class.java))
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        // START_STICKY 재기동 (OS kill 후) 경로 — 엔진이 영속 스냅샷에서 세션을 복원한다.
        RunSessionEngine.attach(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotification(
            defaultTitle(),
            // 첫 텍스트는 즉시 tick 이 갱신 — placeholder 만.
            "0.00 km · 00:00"
        )
        ServiceCompat.startForeground(
            this, NOTIFICATION_ID, notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        )
        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "routinist:run-session").apply {
                setReferenceCounted(false)
                acquire(WAKE_LOCK_TIMEOUT_MS)
            }
        }
        RunSessionEngine.notificationSink = { title, text -> updateNotification(title, text) }

        // stale-restore 안전망: START_STICKY 로 깨어났는데 엔진이 트래킹을 재가동하지 않았다면
        // (30분 초과 stale → paused 데이터 보존만, GPS/tick 미가동) FGS 를 유지할 이유가 없다.
        // 리뷰 P1: isSessionActive 는 stale-paused 도 true 라 영원히 안 걸림 — 트래킹
        // 실가동 여부 (isTrackingRunning) 로 판정해야 좀비 FGS + wake lock 이 안 남는다.
        RunSessionEngine.handler.postDelayed({
            if (!RunSessionEngine.isTrackingRunning()) stopSelf()
        }, 3000)

        return START_STICKY
    }

    override fun onDestroy() {
        if (RunSessionEngine.notificationSink != null) RunSessionEngine.notificationSink = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // 리뷰 P2: 하드코딩 한국어 → 시스템/세션 locale 분기. 채널명은 시스템 locale (설정 앱 노출),
    // 알림 제목은 엔진이 세션 locale 로 전달.
    private fun isKoDevice() = resources.configuration.locales[0]?.language == "ko"
    private fun defaultTitle() = if (isKoDevice()) "달리기 기록 중" else "Recording your run"

    private fun createChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            if (isKoDevice()) "러닝 기록" else "Run tracking", // 시스템 설정에 노출되는 채널명
            NotificationManager.IMPORTANCE_LOW, // 무음·무진동 — 초당 갱신되는 진행 알림
        ).apply {
            setShowBadge(false)
            description = if (isKoDevice()) "달리기 트래킹 진행 상황" else "Live run tracking progress"
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(title: String, text: String): Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_run)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun updateNotification(title: String, text: String) {
        try {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, buildNotification(title, text))
        } catch (_: Exception) { /* 알림 갱신 실패는 트래킹에 영향 없음 */ }
    }
}
