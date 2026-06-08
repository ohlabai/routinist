import Foundation
import Capacitor
import UIKit

// build 262: iOS 앱 아이콘 빨간 숫자 배지 제어.
// @capacitor/push-notifications 는 push payload 의 badge 만 처리하고 수동 setBadge 함수는 없음.
// 자체 plugin 으로 UIApplication.shared.applicationIconBadgeNumber 직접 set.
//
// 사용 흐름:
//   - 앱 진입 / 포어그라운드 복귀 시 layout.tsx 가 unread 합계 계산 후 setBadge(N)
//   - push 도착 시엔 iOS 가 자동 +1 처리 (PushNotifications payload 의 badge 필드)
//   - logout / clearAll 같은 동작에서 clearBadge() 로 0
@objc(BadgeManagerPlugin)
public class BadgeManagerPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "BadgeManagerPlugin"
    public let jsName = "BadgeManager"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBadge", returnType: CAPPluginReturnPromise),
    ]

    @objc func setBadge(_ call: CAPPluginCall) {
        let count = call.getInt("count") ?? 0
        let clamped = max(0, count)
        // applicationIconBadgeNumber 는 main thread 에서 설정해야 안전.
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = clamped
            call.resolve(["count": clamped])
        }
    }

    @objc func clearBadge(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = 0
            call.resolve(["count": 0])
        }
    }

    @objc func getBadge(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let n = UIApplication.shared.applicationIconBadgeNumber
            call.resolve(["count": n])
        }
    }
}
