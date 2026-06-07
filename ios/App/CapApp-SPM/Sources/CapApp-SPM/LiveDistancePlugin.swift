import Foundation
import Capacitor
import HealthKit

// build 254: HealthKit 의 distanceWalkingRunning sample 합을 운동 종료 직후 조회해서
// 우리 자체 GPS 누적값을 Apple 의 sensor-fusion 결과로 보정한다.
//
// 왜:
// - 우리 GPS 누적은 좌표 jitter / 정지 상태 흔들림 / multipath 등으로 부풀려질 수 있음
//   (build 253 의 listener+flush 이중 emit fix 이후에도 jitter 누적은 남아 있음)
// - Apple 의 distanceWalkingRunning 은 GPS + 가속도계 + 보폭 ML + Apple Watch 우선순위
//   까지 처리한 결과. 사용자가 Apple Fitness 에서 보는 거리와 동일
// - 운동 종료 직후 15초쯤 기다리면 sample 이 HealthKit 에 적재돼 있음
//
// 라이브 구독 (HKAnchoredObjectQuery updateHandler) 은 미래 phase. 현재는 종료 후 1회 조회만.
@objc(LiveDistancePlugin)
public class LiveDistancePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "LiveDistancePlugin"
    public let jsName = "LiveDistance"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "querySamples", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()

    /// startMs ~ endMs (unix ms) 사이의 distanceWalkingRunning sample 들 합 (미터) 을 반환.
    /// 권한이 없거나 sample 이 없으면 totalMeters=0 + hasData=false.
    @objc func querySamples(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["totalMeters": 0, "sampleCount": 0, "hasData": false, "reason": "not-available"])
            return
        }
        let startMs = call.getDouble("startMs") ?? 0
        let endMs = call.getDouble("endMs") ?? 0
        if startMs <= 0 || endMs <= startMs {
            call.reject("invalid range: startMs=\(startMs), endMs=\(endMs)")
            return
        }
        let start = Date(timeIntervalSince1970: startMs / 1000.0)
        let end = Date(timeIntervalSince1970: endMs / 1000.0)

        guard let dwrType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) else {
            call.reject("distanceWalkingRunning type unavailable")
            return
        }

        // 권한 확인. authorizationStatus 가 sharingAuthorized 가 아니어도 read 는 silent 일 수
        // 있으므로 sample query 자체로 실패 검출하는 편이 정확. 그래도 명시적으로 한 번 체크.
        let auth = healthStore.authorizationStatus(for: dwrType)
        if auth == .notDetermined {
            call.resolve([
                "totalMeters": 0, "sampleCount": 0, "hasData": false,
                "reason": "not-determined",
            ])
            return
        }

        // .strictStartDate: sample.startDate >= start. .strictEndDate: sample.endDate <= end.
        // 운동 시작~종료 사이에 완전히 포함된 sample 만 합산.
        let pred = HKQuery.predicateForSamples(
            withStart: start, end: end,
            options: [.strictStartDate, .strictEndDate])

        let query = HKStatisticsQuery(
            quantityType: dwrType, quantitySamplePredicate: pred,
            options: [.cumulativeSum]
        ) { _, stats, error in
            if let error = error {
                call.reject("HKStatisticsQuery failed: \(error.localizedDescription)")
                return
            }
            let sumQty = stats?.sumQuantity()
            let meters = sumQty?.doubleValue(for: HKUnit.meter()) ?? 0
            // sample 개수도 같이 — 0 이면 HealthKit 가 아직 sample 적재 안 한 것.
            // statistics 만으론 count 모르므로 별도 sample query 한 번 더.
            self.countSamples(type: dwrType, predicate: pred) { count in
                call.resolve([
                    "totalMeters": meters,
                    "sampleCount": count,
                    "hasData": count > 0 && meters > 0,
                    "startMs": startMs,
                    "endMs": endMs,
                ])
            }
        }
        healthStore.execute(query)
    }

    private func countSamples(type: HKQuantityType, predicate: NSPredicate, completion: @escaping (Int) -> Void) {
        let q = HKSampleQuery(
            sampleType: type, predicate: predicate,
            limit: HKObjectQueryNoLimit, sortDescriptors: nil
        ) { _, samples, _ in
            completion(samples?.count ?? 0)
        }
        healthStore.execute(q)
    }
}
