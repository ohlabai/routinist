import UIKit
import Capacitor
import CapApp_SPM

// CAPBridgeViewController subclass — Capacitor 6 SPM 환경에서 자동 검출이 안 되는
// 커스텀 plugin 을 명시적으로 등록한다. capacitorDidLoad() 가 bridge 가 준비된 후 호출되는
// 공식 hook 이라 가장 안전. 이전 시도들 (AppDelegate 의 _ = ClassName.self, import 강제) 은
// ObjC runtime 등록이 lazy 라 효과가 없었음.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WorkoutRoutePlugin())
        bridge?.registerPluginInstance(BackgroundLocationPlugin())
        // build 240 임시 진단 — TestFlight/Release 빌드에서도 Safari Web Inspector 접근 가능.
        // SocialLogin 회귀 (Apple/Google 둘 다 즉시 복귀) 원인 추적 후 다음 빌드에서 제거.
        if #available(iOS 16.4, *) {
            bridge?.webView?.isInspectable = true
        }
    }
}
