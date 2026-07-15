package com.routinist.app

import android.Manifest
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

/**
 * RunSession Capacitor 브리지 — iOS RunSessionPlugin.swift 와 동일 계약 (run-session.ts).
 *
 * 엔진 로직은 전부 RunSessionEngine (싱글턴) — 이 클래스는 PluginCall ↔ 엔진 콜백 변환과
 * update/milestone 이벤트 릴레이만 담당한다. WebView 재생성/앱 재시작 시에도 엔진은
 * FGS(RunSessionService) 와 함께 살아 있고, JS 는 getSnapshot() 으로 재부착한다.
 *
 * requestPermissions 는 Capacitor 기본 구현 사용 — @Permission alias "location" 을
 * 프롬프트하고 { location: 'granted'|'denied'|'prompt' } 형태로 resolve (계약의 location
 * 필드와 일치). motion 은 Android 에선 pedometer 융합이 없어 프롬프트하지 않는다
 * (JS 는 location 만 gate — track/page.tsx).
 */
@CapacitorPlugin(
    name = "RunSession",
    permissions = [
        Permission(
            alias = "location",
            strings = [Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION],
        ),
    ],
)
class RunSessionPlugin : Plugin(), RunSessionEngine.EventSink {

    /** 계약: update 이벤트는 foreground 에서만 (백그라운드에선 native 적산만). */
    @Volatile private var isForeground = true

    override fun load() {
        RunSessionEngine.attach(context)
        RunSessionEngine.eventSink = this
    }

    override fun handleOnResume() {
        super.handleOnResume()
        isForeground = true
    }

    override fun handleOnPause() {
        super.handleOnPause()
        isForeground = false
    }

    override fun handleOnDestroy() {
        if (RunSessionEngine.eventSink === this) RunSessionEngine.eventSink = null
        super.handleOnDestroy()
    }

    // ── EventSink (엔진 handler 스레드에서 호출 — notifyListeners 는 스레드 안전) ──

    override fun onUpdate(data: JSObject) {
        if (isForeground) notifyListeners("update", data)
    }

    override fun onMilestone(data: JSObject) {
        if (isForeground) notifyListeners("milestone", data)
    }

    // ── 계약 메서드 ──────────────────────────────────────────────────────────

    @PluginMethod
    fun start(call: PluginCall) {
        val locale = call.getString("locale") ?: "ko"
        val voiceEnabled = call.getBoolean("voiceEnabled") ?: true
        val everyKm = call.getDouble("milestoneEveryKm") ?: 1.0
        val templatesObj = call.getObject("voiceTemplates") ?: JSObject()
        val isKo = locale.lowercase().startsWith("ko")
        val templates = RunSessionEngine.VoiceTemplates(
            milestone = templatesObj.getString("milestone")
                ?: if (isKo) "{km}킬로미터. 평균 페이스 {pace}" else "{km} kilometers. Average pace {pace}",
            autoPause = templatesObj.getString("autoPause") ?: if (isKo) "자동 일시정지" else "Auto paused",
            autoResume = templatesObj.getString("autoResume") ?: if (isKo) "다시 시작합니다" else "Resuming",
            start = templatesObj.getString("start") ?: if (isKo) "출발!" else "Go!",
        )
        RunSessionEngine.startSession(
            locale, voiceEnabled, everyKm, templates,
            onSuccess = { startedAtMs ->
                call.resolve(JSObject().put("ok", true).put("startedAtMs", startedAtMs))
            },
            onError = { message -> call.reject(message) },
        )
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        RunSessionEngine.pauseSession { ok ->
            if (ok) call.resolve(JSObject().put("ok", true)) else call.reject("no-active-session")
        }
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        RunSessionEngine.resumeSession { ok ->
            if (ok) call.resolve(JSObject().put("ok", true)) else call.reject("no-active-session")
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        RunSessionEngine.stopSession(
            onSuccess = { summary -> call.resolve(summary) },
            onError = { message -> call.reject(message) },
        )
    }

    @PluginMethod
    fun getSnapshot(call: PluginCall) {
        RunSessionEngine.getSnapshot { data -> call.resolve(data) }
    }

    /** 시작 제스처 직후 호출 — TTS 엔진 선초기화 (카운트다운 첫 발화 전 준비). */
    @PluginMethod
    fun prepareAudio(call: PluginCall) {
        RunSessionEngine.ensureTts()
        call.resolve(JSObject().put("ok", true))
    }

    /** 카운트다운 TTS ("셋/둘/하나/출발"). 미준비면 ok:false → JS 가 beep 폴백. */
    @PluginMethod
    fun speakText(call: PluginCall) {
        val text = call.getString("text")
        if (text.isNullOrEmpty()) {
            call.resolve(JSObject().put("ok", false))
            return
        }
        val ok = RunSessionEngine.speakTextNow(text)
        call.resolve(JSObject().put("ok", ok))
    }
}
