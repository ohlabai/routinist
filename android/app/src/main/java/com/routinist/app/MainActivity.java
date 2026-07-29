package com.routinist.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;

public class MainActivity extends BridgeActivity {

    // v3 (갤럭시워치): 폰 → 워치 컨텍스트 push — iOS WatchBridge 의 대응물.
    // JS(watch-bridge.ts)가 CapacitorStorage.watch_ctx 에 심어둔 JSON(max_hr 등)을
    // 앱 활성화 때마다 DataItem 으로 워치에 전달 (워치 CtxReceiverService 가 수신).
    @Override
    public void onResume() {
        super.onResume();
        try {
            String json = getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .getString("watch_ctx", null);
            if (json != null && !json.isEmpty()) {
                PutDataMapRequest req = PutDataMapRequest.create("/routinist/ctx");
                req.getDataMap().putString("json", json);
                req.getDataMap().putLong("sentAt", System.currentTimeMillis()); // 변경 보장
                PutDataRequest put = req.asPutDataRequest().setUrgent();
                Wearable.getDataClient(this).putDataItem(put);
            }
        } catch (Exception ignored) {
            // 워치 미페어링/Play services 부재 — 조용히 무시
        }
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WorkoutRoutePlugin.class);
        registerPlugin(RunSessionPlugin.class);
        super.onCreate(savedInstanceState);

        // 2026-07-15 리뷰 P1: Toss 결제창의 카드사 앱카드 인증은 Android 에서
        // intent://...#Intent;scheme=...;package=...;end 링크로 온다. Capacitor 기본
        // Bridge.launchIntent 는 raw URI 에 ACTION_VIEW 를 시도해 아무것도 못 열고
        // 조용히 삼킴 → 인증 단계에서 결제 사망. Intent.parseUri 로 해석해 실행하고,
        // 앱 미설치면 Play 스토어로 유도한다. (iOS 는 커스텀 스킴 직행이라 무관)
        this.bridge.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("intent://")) {
                    try {
                        Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                        try {
                            startActivity(intent);
                        } catch (ActivityNotFoundException e) {
                            String pkg = intent.getPackage();
                            if (pkg != null) {
                                try {
                                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)));
                                } catch (ActivityNotFoundException ignored) {
                                    // Play 스토어 없는 기기 — 조용히 무시 (사용자는 다른 인증 수단 선택)
                                }
                            }
                        }
                    } catch (Exception ignored) {
                        // 파싱 불가 링크 — WebView 내 로딩도 의미 없으므로 소비만
                    }
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }
}
