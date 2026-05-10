import Foundation
import Capacitor
import HealthKit

@objc(WorkoutRoutePlugin)
public class WorkoutRoutePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "WorkoutRoutePlugin"
    public let jsName = "WorkoutRoute"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRoutes", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()

    /// workout + workoutRoute 권한을 요청합니다. capgo Health 플러그인은 route 타입을 다루지 않으므로
    /// connect flow 에서 이 메서드를 추가로 호출해 다이얼로그가 두 번 뜨는 UX 분산을 막습니다.
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available")
            return
        }
        let workoutType = HKObjectType.workoutType()
        let routeType = HKSeriesType.workoutRoute()
        healthStore.requestAuthorization(toShare: nil, read: [workoutType, routeType]) { success, error in
            if let error = error {
                call.reject("HealthKit authorization failed: \(error.localizedDescription)")
                return
            }
            call.resolve(["success": success])
        }
    }

    /// startDate ~ endDate 사이의 러닝 워크아웃 GPS 경로를 모두 가져옵니다.
    /// JS 호출: WorkoutRoute.getRoutes({ startDate, endDate, limit })
    /// 권한은 requestAuthorization 으로 미리 받아두는 것을 권장.
    @objc func getRoutes(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available")
            return
        }

        let startDateStr = call.getString("startDate") ?? ""
        let endDateStr = call.getString("endDate") ?? ""
        let limit = call.getInt("limit") ?? 500

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        guard let startDate = formatter.date(from: startDateStr) ?? ISO8601DateFormatter().date(from: startDateStr) else {
            call.reject("Invalid startDate")
            return
        }
        guard let endDate = formatter.date(from: endDateStr) ?? ISO8601DateFormatter().date(from: endDateStr) else {
            call.reject("Invalid endDate")
            return
        }

        // 권한이 이미 결정돼 있으면 OS가 다이얼로그를 다시 띄우지 않으므로 안전하게 한 번 더 호출.
        let workoutType = HKObjectType.workoutType()
        let routeType = HKSeriesType.workoutRoute()
        healthStore.requestAuthorization(toShare: nil, read: [workoutType, routeType]) { [weak self] _, _ in
            guard let self = self else { return }
            self.queryRunningWorkouts(startDate: startDate, endDate: endDate, limit: limit, call: call)
        }
    }

    private func queryRunningWorkouts(startDate: Date, endDate: Date, limit: Int, call: CAPPluginCall) {
        let predicate = HKQuery.predicateForWorkouts(with: .running)
        let datePredicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let compound = NSCompoundPredicate(andPredicateWithSubpredicates: [predicate, datePredicate])

        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: compound,
            limit: limit,
            sortDescriptors: [sortDescriptor]
        ) { [weak self] _, samples, error in
            guard let self = self else { return }

            if let error = error {
                call.reject("Workout query failed: \(error.localizedDescription)")
                return
            }

            guard let workouts = samples as? [HKWorkout], !workouts.isEmpty else {
                call.resolve(["routes": []])
                return
            }

            // 각 워크아웃에서 경로 추출.
            // build 58 안전망: 어떤 fetchRoute callback 이 안 오는 케이스 (HKWorkoutRouteQuery 의 done=true 가 영영
            // 안 오는 edge) 에 대비, 50s 후 부분 결과라도 강제 resolve. 사용자가 audit 페이지에서 영영 spinner 도는 회귀 차단.
            // build 후속 fix: timeout 시 활성 HK query 들을 stop 하지 않으면 다음 audit 호출 때 누적 → 메모리 누수.
            let group = DispatchGroup()
            var results: [[String: Any]] = []
            var activeQueries: [HKQuery] = []
            let lock = NSLock()
            var resolved = false
            let resolveOnce: ([String: Any]) -> Void = { [weak self] payload in
                lock.lock()
                guard !resolved else { lock.unlock(); return }
                resolved = true
                let queriesToStop = activeQueries
                activeQueries.removeAll()
                lock.unlock()
                // 진행 중인 HK query 모두 정리 — leak 방지.
                queriesToStop.forEach { self?.healthStore.stop($0) }
                call.resolve(payload)
            }

            DispatchQueue.global().asyncAfter(deadline: .now() + 50) {
                lock.lock()
                let snapshot = results
                lock.unlock()
                resolveOnce(["routes": snapshot, "partial": true, "reason": "native_timeout_50s"])
            }

            for workout in workouts {
                group.enter()
                self.fetchRoute(for: workout, registerQuery: { q in
                    lock.lock()
                    activeQueries.append(q)
                    lock.unlock()
                }) { routeData in
                    if let routeData = routeData {
                        lock.lock()
                        results.append(routeData)
                        lock.unlock()
                    }
                    group.leave()
                }
            }

            group.notify(queue: .main) {
                lock.lock()
                let snapshot = results
                lock.unlock()
                resolveOnce(["routes": snapshot])
            }
        }

        healthStore.execute(query)
    }

    private func fetchRoute(for workout: HKWorkout, registerQuery: @escaping (HKQuery) -> Void, completion: @escaping ([String: Any]?) -> Void) {
        let routeType = HKSeriesType.workoutRoute()
        let predicate = HKQuery.predicateForObjects(from: workout)

        let routeQuery = HKSampleQuery(
            sampleType: routeType,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { [weak self] _, samples, error in
            guard let self = self,
                  let routes = samples as? [HKWorkoutRoute],
                  let route = routes.first else {
                completion(nil)
                return
            }

            // Route에서 CLLocation 배열 추출
            var allLocations: [[Double]] = []
            var routeCompleted = false

            let routeDataQuery = HKWorkoutRouteQuery(route: route) { query, locations, done, error in
                // error 가 있고 done 이 false 면 callback 이 더 이상 안 올 수 있음 — completion 호출하고 종료.
                if let _ = error, !done {
                    if !routeCompleted {
                        routeCompleted = true
                        completion(nil)
                    }
                    return
                }

                if let locations = locations {
                    for location in locations {
                        // GeoJSON 형식: [lng, lat, elevation]
                        allLocations.append([
                            location.coordinate.longitude,
                            location.coordinate.latitude,
                            location.altitude
                        ])
                    }
                }

                if done {
                    if routeCompleted { return }
                    routeCompleted = true
                    if allLocations.isEmpty {
                        completion(nil)
                        return
                    }

                    let formatter = ISO8601DateFormatter()
                    let result: [String: Any] = [
                        "startDate": formatter.string(from: workout.startDate),
                        "endDate": formatter.string(from: workout.endDate),
                        "distance": workout.totalDistance?.doubleValue(for: .meter()) ?? 0,
                        "duration": workout.duration,
                        "coordinates": allLocations,
                    ]
                    completion(result)
                }
            }

            registerQuery(routeDataQuery)
            self.healthStore.execute(routeDataQuery)
        }

        registerQuery(routeQuery)
        healthStore.execute(routeQuery)
    }
}
