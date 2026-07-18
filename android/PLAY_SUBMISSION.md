# Play Console 정식 출시 양식 — 답안지 (2026-07-11, build 304 기준)

대시보드 "앱 설정 > 할 일 보기" 의 각 양식을 열고 아래 그대로 선택/붙여넣기.
스토어 등록정보 텍스트는 API 권한이 뚫리면 (`scripts/play-upload.mjs` 커밋 403 해소 시)
Claude 가 API 로 직접 넣을 수도 있음 — 그 전엔 복붙.

---

## 1. 앱 액세스 권한 (App access)

- "전체 또는 일부 기능이 제한됨" 선택 (로그인 필요)
- 안내 추가: 이름 `데모 계정`, 사용자 이름 `demo@routinist.kr`, 비밀번호 `demo1234`
- 기타 안내: `이메일 로그인으로 모든 기능 사용 가능. Health Connect 연동은 실기기 + Health Connect 앱 필요.`

## 2. 광고 (Ads)

- **아니요 — 앱에 광고 없음**

## 3. 콘텐츠 등급 설문 (Content rating)

- 이메일: hans@openhan.kr / 카테고리: **유틸리티·생산성·커뮤니케이션·기타**
- 폭력/성적 콘텐츠/비속어/약물 등 전부 **아니요**
- 사용자 간 상호작용: **예** (채팅·댓글·사진 공유 있음) → "사용자가 생성한 콘텐츠 공유" 예, "다른 사용자와 교류" 예
- 개인정보 공유: 예 (닉네임·프로필 사진 등 자발 공개)
- 디지털 구매: 아니요 (실물 상품만 — 마일리지는 무료 적립)
- 결과: 전체이용가 (3+) 예상

## 4. 타겟층 및 콘텐츠 (Target audience)

- 타겟 연령: **18세 이상** (커뮤니티·위치 기능 + 관리 부담 최소화)
- "어린이의 관심을 끌 수 있는 앱인가" → 아니요

## 5. 뉴스 앱 (News) → 아니요
## 6. 코로나19 접촉자 추적 앱 → 아니요

## 7. 데이터 보안 (Data safety) — 핵심 양식

"데이터 수집 또는 공유 여부" → **수집함** / 공유 → **아니요 (제3자 공유 없음)**
"전송 중 암호화" → **예** / "삭제 요청 가능" → **예** (계정 탈퇴 시 영구 삭제)
계정 삭제 요청 URL → `https://app.routinist.kr/delete-account`
"계정을 삭제하지 않고도 데이터 삭제 요청 가능?" (선택사항) → **예**, 같은 URL
`https://app.routinist.kr/delete-account` (페이지에 '계정 유지 + 일부 데이터만 삭제' 섹션 있음)

수집 항목 (각각 "수집됨 / 공유 안 함 / 필수 아님*은 표기 / 계정과 연결됨 / 추적 아님"):

| Play 카테고리 | 항목 | 목적 |
|---|---|---|
| 개인 정보 | 이름 (닉네임), 이메일 주소, 사용자 ID | 앱 기능 (계정) |
| 건강 및 피트니스 | 건강 정보·피트니스 정보 (거리·시간·페이스·심박·칼로리 — Health Connect/GPS) | 앱 기능, 분석 |
| 위치 | 정확한 위치 (GPS 경로 — 권한 허용 시만), 대략적 위치 (지역 랭킹) | 앱 기능, 맞춤설정 |
| 사진 및 동영상 | 사진 (루틴포토 — 자발 업로드) | 앱 기능 |
| 메시지 | 기타 인앱 메시지 (쪽지·댓글) | 앱 기능 |
| 앱 활동 | 앱 상호작용 (페이지뷰 자체 분석) | 분석 |
| 기기 또는 기타 ID | 없음 (광고 ID 미사용) | — |
| 금융 정보 | **수집 안 함** (결제는 토스페이먼츠가 처리 — 카드 정보 앱 미보관, 주문 내역만) |
| 주소 | 실물 배송 주소 (쇼핑 주문 시만, 선택) | 앱 기능 |

※ 출생연도·성별 (또래 랭킹, 자발 입력) → "개인 정보 > 기타 정보" 로 추가.

## 8. 건강 앱 선언 (Health apps declaration)

- 건강 관련 기능: **예 — 피트니스 및 운동 추적**
- Health Connect 사용: **예** — 읽기 권한: 운동 세션, 거리, 걸음 수, 심박수, 활성 칼로리, 운동 경로
- 사용 목적: `사용자의 러닝 기록을 가져와 통계·개인 기록·랭킹·습관 형성 기능을 제공. 데이터는 사용자 계정에만 연결되며 제3자 공유·광고 활용 없음.`
- 개인정보처리방침 URL: `https://app.routinist.kr/privacy`

## 9. 스토어 등록정보 (Main store listing)

**앱 이름 (30자)**: `루티니스트 - 러닝 기록, 달리기 습관`

**간단한 설명 (80자)**:
`주 2~3회 러너를 위한 습관 앱. 주간 스트릭, GPS 트래킹, 음성 코칭, 마라톤 준비까지.`

**자세한 설명 (4000자)**:
```
루티니스트는 "매일" 이 아니라 "매주 꾸준히" 달리는 사람을 위한 러닝 습관 앱입니다.

■ 주간 러닝 스트릭
하루 빠졌다고 끊기는 스트릭은 그만. 일주일에 몇 번 달릴지 정하면 (추천: 주 3회),
채운 주가 이어질 때마다 연속 기록이 쌓입니다. 바쁜 주는 보호권으로 이어가세요.

■ GPS 러닝 트래킹 + 음성 코칭
시작 버튼 하나로 거리·페이스·경로를 기록합니다. 화면을 잠가도 기록은 계속되고,
1km 마다 음성 안내가, 신호 대기 중엔 자동 일시정지가 함께합니다.

■ 건강 앱 연동
Health Connect 를 연결하면 삼성 헬스·갤럭시 워치의 러닝 기록이 자동으로 들어옵니다.
과거 기록까지 한 번에 — 설치 첫날부터 내 러닝 히스토리가 완성됩니다.

■ 함께 달리는 재미
친구에게 응원 보내기, 이달의 페이스메이커와 선의의 경쟁, 동네 러너 찾기,
러닝 클럽, 오늘의 러닝 선정까지. 혼자 달려도 혼자가 아닙니다.

■ 기록이 쌓이는 즐거움
러닝 마일리지 적립, 배지 컬렉션, 개인 최고 기록, 월간 랭킹, AI 러닝 코치의
컨디션 분석까지. 달릴수록 보이는 것이 많아집니다.

■ 공유 카드
오늘의 러닝을 지도·페이스와 함께 예쁜 카드나 영상으로 만들어 친구에게 자랑하세요.

■ 마라톤 준비
10K·하프·풀코스 도전을 위한 페이스 트렌드와 개인 기록 관리,
세계 유명 코스를 가상으로 달리는 월드 마라톤까지. 첫 마라톤 준비를 함께합니다.

권한 안내
- 위치: GPS 트래킹과 지역 랭킹에 사용합니다 (허용 시에만).
- Health Connect: 러닝 기록을 가져오는 데만 사용하며 제3자와 공유하지 않습니다.

문의: routinist@openhan.kr
```

**그래픽**: 앱 아이콘 512×512 (기존 아이콘 리사이즈), 피처 그래픽 1024×500 (제작 필요 — Claude 에게 요청),
스크린샷: iOS 6.7" 스크린샷 재사용 가능 (Play 는 비율만 맞으면 됨, 최소 2장 — 홈·트래킹·랭킹·코치 추천)

## 10. 카테고리·연락처

- 앱 카테고리: **건강/운동**
- 이메일: routinist@openhan.kr / 웹사이트: https://app.routinist.kr
- 개인정보처리방침: https://app.routinist.kr/privacy

---

체크리스트 전부 완료 후: 프로덕션 → 새 버전 만들기 → AAB 304 (내부 테스트에서 승격 가능) → 검토 제출.
Health Connect 선언은 별도 승인 심사가 있어 프로덕션 심사와 병행됨 (수일 소요 가능).

---

# 2026-07-18 거절 대응 — 재제출 가이드 (AAB 307)

## 거절 사유 2건 (둘 다 헬스 커넥트 권한 정책, 버전 306)
1. **과도한 데이터 액세스**: Steps 권한이 기능 대비 불필요 판정
2. **근거 부족**: 요청한 데이터 유형별 사용 근거 설명 부족

## 코드 대응 (완료 — AAB 307 에 반영)
- manifest 건강 권한 7종 → **실사용 4종** (READ_EXERCISE / READ_EXERCISE_ROUTE / READ_DISTANCE / READ_ACTIVE_CALORIES_BURNED)
- 제거: STEPS·TOTAL_CALORIES·HEART_RATE (전부 코드 미사용 검증됨)
- **경로 동기화 Android 활성화** (iOS 와 동일 기능): WorkoutRoutePlugin 실권한 요청 UI + JS 게이트 해제 — EXERCISE_ROUTE 는 실기능으로 심사받음
- 런타임 요청 (health-sync) 도 manifest 와 정합

## 콘솔 작업 순서 (사용자)

### 1) 앱 콘텐츠 → 건강 앱 (Health apps) 선언 갱신
- 데이터 유형 선택을 **4종만** (운동 세션·운동 경로·거리·활동 칼로리) 남기고 나머지 (걸음수·심박수·총칼로리) 체크 해제
- 각 유형 근거 (아래 복붙):

| 데이터 유형 | 근거 (한국어) | Rationale (EN) |
|---|---|---|
| 운동 세션 (Exercise) | 사용자가 삼성 헬스·갤럭시 워치로 기록한 러닝 운동을 앱의 러닝 일지·주간 스트릭·월간 목표·랭킹에 자동 반영하기 위해 러닝/걷기 세션을 읽습니다. 앱의 핵심 기능입니다. | Reads running/walking exercise sessions recorded by Samsung Health or Galaxy Watch to automatically populate the user's running log, weekly streaks, monthly goals and rankings — the app's core feature. |
| 거리 (Distance) | 각 러닝 세션의 총 거리를 표시하고 주간/월간 누적 거리, 목표 달성률, 페이스 계산에 사용합니다. | Used to show each run's total distance and to compute weekly/monthly totals, goal progress and average pace. |
| 활동 칼로리 (Active calories) | 각 러닝 세션에서 소모한 활동 칼로리를 기록 상세와 공유 카드에 표시합니다. | Displays active calories burned per run on the record detail screen and share cards. |
| 운동 경로 (Exercise route) | 워치로 기록한 러닝의 GPS 경로를 기록 상세 화면과 공유 카드의 지도에 그려 사용자가 자신이 달린 코스를 확인·공유할 수 있게 합니다. | Draws the GPS route of watch-recorded runs on the record detail map and share cards so users can review and share the course they ran. |

### 2) 앱 콘텐츠 → 포그라운드 서비스 권한 선언 (신규 — 307 이 FGS location 추가)
- FOREGROUND_SERVICE_LOCATION 사용: **예**
- 사유 (복붙): "사용자가 명시적으로 시작한 GPS 러닝 트래킹을 화면 잠금 상태에서도 지속하기 위해 위치 유형 포그라운드 서비스를 사용합니다. 서비스 실행 중에는 상시 알림으로 거리·시간이 표시되며, 러닝을 종료하면 즉시 중단됩니다. / A location foreground service keeps GPS run tracking alive while the screen is locked, only during a run the user explicitly started. An ongoing notification shows distance/time, and the service stops immediately when the run ends."
- **데모 영상** 요구 시: 트래킹 시작 → 화면 잠금 → 상단 알림 (달리기 기록 중) → 잠금 해제 → 완료, ~30초 화면 녹화 → YouTube 비공개 업로드 링크
- 이 폼 저장 후 아래 3) 이 뚫림 (API 커밋이 이 선언 미작성으로 403)

### 3) AAB 307 업로드
- 터미널: `node scripts/play-upload.mjs play-publish-key.json android/app/build/outputs/bundle/release/app-release.aab production`
- (스크립트가 "검토 미전송 모드로 commit" 출력하면 정상)

### 4) 게시 개요 → "변경사항 전송" 클릭 (심사 제출)
- 릴리스 노트는 fastlane/metadata/android/{ko-KR,en-US}/changelogs/307.txt 복붙
