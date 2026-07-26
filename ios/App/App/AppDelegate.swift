import UIKit
import Capacitor
import GoogleSignIn
import AVFoundation
import WatchConnectivity
// CapApp-SPM 모듈 — 커스텀 WorkoutRoutePlugin 이 들어있는 SPM 모듈을 강제 로드.
// SPM 빌드에선 ObjC runtime 의 lazy load 때문에 Capacitor 가 plugin 클래스를 iterate 할 때
// 모듈이 아직 메모리에 안 올라와서 검출 못 함 → "WorkoutRoute plugin is not implemented on ios" 회귀.
// 클래스 한 번 참조해서 모듈을 active 시키면 plugin 등록 정상화.
import CapApp_SPM

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 커스텀 SPM plugin 강제 로드 — 자동 검출이 안 되는 SPM 환경 대응.
        _ = WorkoutRoutePlugin.self

        // build 223: 백그라운드 TTS 음성 cue 를 위한 AVAudioSession **카테고리만** 등록.
        // build 240 hotfix (v1.2.1): launch 시점에 `setActive(true)` 를 호출하면
        // ASAuthorizationController / GIDSignIn 의 인증 시트 presentation 과 audio session
        // routing race 가 발생해 시트가 즉시 닫히는 회귀 (사용자: "Google 로 이동중 잠깐 →
        // 원복"). 카테고리는 등록해 두되, 실제 활성화는 AVSpeechSynthesizer.speak() 호출
        // 시 시스템이 알아서 처리 — 인증 흐름과 충돌 차단.
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.mixWithOthers, .duckOthers]
            )
        } catch {
            NSLog("[AppDelegate] AVAudioSession setCategory failed: \(error)")
        }

        // watch v9: WCSession 활성화 (RoutinistWatch 연동)
        WatchBridge.shared.activate()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {
        // watch v9: 웹 레이어가 Preferences 로 심어둔 워치 컨텍스트 (max_hr·이달 챌린지) 를
        // WCSession applicationContext 로 워치에 push. 웹 키 = CapacitorStorage.watch_ctx (JSON).
        WatchBridge.shared.pushContextIfPossible()
    }
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // GoogleSignIn 콜백 우선 처리 — capgo capacitor-social-login 의 Google 인증 흐름.
        if GIDSignIn.sharedInstance.handle(url) {
            return true
        }
        // 그 외 URL 은 Capacitor 기본 처리 (기존 routinist:// 딥링크 등)
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // build 271: APNs 등록 결과를 Capacitor 의 PushNotifications plugin 으로 전달.
    // 이 두 함수가 없으면 PushNotifications.register() 후 'registration' / 'registrationError'
    // 이벤트가 영원히 발사 안 됨 → push_device_tokens 테이블 0건 → push 전체 발사 불가.
    // hans 2026-06-09 진단으로 발견 — 14일간 push_send_log 196건 pending, sent 0건.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }
}
