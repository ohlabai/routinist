import UIKit
import Capacitor
import GoogleSignIn
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
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
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
}
