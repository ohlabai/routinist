'use client';

// 가벼운 자체 i18n. 페이지 대부분이 한국어로 하드코딩되어 있어 점진적 이관을 위한 기반만 제공.
// 언어 결정 우선순위: (1) 유저 설정(localStorage) → (2) navigator.language → (3) 기본 'ko'.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, createElement } from 'react';

// build 158: ja/zh/es 제거 — 한국어/영어 2개만 지원. 사용자 결정.
export type Locale = 'ko' | 'en';

export const SUPPORTED_LOCALES: { code: Locale; native: string }[] = [
  { code: 'ko', native: '한국어' },
  { code: 'en', native: 'English' },
];

export type TranslationKey =
  | 'common.loading'
  | 'common.save'
  | 'common.cancel'
  | 'common.retry'
  | 'common.back'
  | 'nav.home'
  | 'nav.map'
  | 'nav.ranking'
  | 'nav.social'
  | 'nav.shop'
  | 'nav.profile'
  | 'home.matchedRank.cta'
  | 'home.matchedRank.ctaSub'
  | 'home.todayTop'
  | 'home.friendsWeek'
  | 'home.gallery'
  | 'home.gallery.empty'
  | 'profile.editTitle'
  | 'profile.nickname'
  | 'profile.region'
  | 'profile.detectRegion'
  | 'profile.detecting'
  | 'profile.birthYear'
  | 'profile.gender'
  | 'profile.male'
  | 'profile.female'
  | 'profile.other'
  | 'profile.runningSince'
  | 'profile.rankingInfoNote'
  | 'profile.edit'
  | 'profile.runner'
  | 'profile.totalKm'
  | 'profile.totalRuns'
  | 'profile.streakDays'
  | 'profile.badges'
  | 'profile.actionConnect'
  | 'profile.actionMessages'
  | 'profile.actionMileage'
  | 'profile.actionMileageGift'
  | 'profile.menuAudit'
  | 'profile.menuAdminMileage'
  | 'profile.menuSupport'
  | 'profile.menuPrivacy'
  | 'profile.menuTerms'
  | 'profile.deleteAccount'
  // build 167 #7: 내 정보 페이지 하드코딩 한글 영문화
  | 'profile.title'
  | 'profile.menuFeedback'
  | 'profile.menuPushSettings'
  | 'profile.menuOrders'
  | 'profile.menuAddresses'
  | 'profile.menuSeller'
  | 'profile.menuAdmin'
  | 'profile.pushOnSummary'
  | 'profile.themeTitle'
  | 'profile.themeLight'
  | 'profile.themeDark'
  | 'profile.themeSystem'
  | 'profile.signOut'
  | 'profile.totalSummary'
  | 'settings.language'
  // build 157: 핵심 화면 영어 확장
  // build 168 #6: 홈 dashboard 잔여 한글 영문화
  | 'home.title'
  | 'home.userMonthTitle'
  | 'home.recentActivity'
  | 'home.viewAllHistory'
  | 'home.noActivityYet'
  | 'home.connectHealthCta'
  | 'home.regionNotSet'
  | 'home.regionNotSetSub'
  | 'home.set'
  | 'home.goalAchieved'
  | 'home.goalLabel'
  | 'home.goalRemaining'
  | 'home.totalSummary'
  | 'home.todayKm'
  | 'home.todayPace'
  | 'home.recentPace'
  | 'home.monthKm'
  | 'home.monthDays'
  | 'home.monthGoal'
  | 'home.monthGoalEmpty'
  | 'home.monthGoalSet'
  | 'home.weekChallenge'
  | 'home.weekChallengeRun'
  | 'home.weekRunCta'
  | 'home.sync'
  | 'home.synced'
  | 'home.tabToday'
  | 'home.tabMonth'
  | 'home.tabYear'
  | 'ranking.title'
  | 'ranking.mine'
  | 'ranking.mileage'
  | 'ranking.world'
  | 'ranking.today'
  | 'ranking.week'
  | 'ranking.month'
  | 'ranking.year'
  | 'ranking.rank'
  | 'ranking.of'
  | 'ranking.champion'
  | 'ranking.keepIt'
  | 'world.inProgress'
  | 'world.medals'
  | 'world.series'
  | 'world.newCourses'
  | 'world.start'
  | 'world.continue'
  | 'world.entryFee'
  | 'world.confirmStart'
  | 'world.completedAt'
  | 'world.distance'
  | 'world.participantsHeader'
  // build 158: social / shop / activity / ranking hero
  | 'social.title'
  | 'social.tabFriends'
  | 'social.tabClubs'
  | 'social.tabPhotos'
  | 'social.tabQuotes'
  | 'social.weekCompare'
  | 'social.monthCompare'
  | 'social.thisWeek'
  | 'social.thisMonth'
  | 'social.weekMondayBase'
  | 'social.me'
  | 'social.emptyFriendsTitle'
  | 'social.emptyFriendsSub'
  | 'social.findFriendsCta'
  | 'social.nearbyTitle'
  | 'social.nearbySub'
  | 'social.findRunners'
  | 'social.searchPlaceholder'
  | 'social.noMatchRunner'
  | 'social.noPublicRunner'
  | 'social.searchHintMatch'
  | 'social.searchHintPublic'
  | 'social.myClubs'
  | 'social.createClub'
  | 'social.noClub'
  | 'social.browseClubs'
  | 'social.memberCount'
  | 'social.allClubs'
  | 'social.allClubsSub'
  | 'shop.title'
  | 'shop.search'
  | 'shop.cart'
  | 'shop.menu'
  | 'shop.searchPlaceholder'
  | 'shop.cancel'
  | 'shop.recentSearch'
  | 'shop.clearAll'
  | 'shop.suggested'
  | 'shop.heroBadge'
  | 'shop.heroTitle1'
  | 'shop.heroTitle2'
  | 'shop.heroSub'
  | 'shop.heroCta'
  | 'shop.categories'
  | 'shop.seeAll'
  | 'shop.all'
  | 'shop.catClothes'
  | 'shop.catHats'
  | 'shop.catAccessories'
  | 'shop.catGoods'
  | 'shop.searchNoResult'
  | 'shop.categoryPreparing'
  | 'shop.comingSoon'
  | 'shop.viewAllProducts'
  | 'shop.hotProducts'
  | 'shop.itemUnit'
  | 'shop.allProducts'
  | 'shop.like'
  | 'shop.liked'
  | 'shop.unliked'
  | 'shop.retryLater'
  | 'shop.fabCart'
  | 'shop.menuWishlist'
  | 'shop.menuOrders'
  | 'shop.menuAddresses'
  | 'shop.menuMileage'
  | 'shop.menuSupport'
  | 'shop.menuBusinessInfo'
  | 'shop.menuTerms'
  | 'shop.menuRefund'
  | 'shop.menuSignOut'
  | 'shop.menuClose'
  | 'activity.title'
  | 'activity.notFound'
  | 'activity.duration'
  | 'activity.pacePerKm'
  | 'activity.kcal'
  | 'activity.heartRateAvg'
  | 'activity.heartRateMax'
  | 'activity.exerciseType'
  | 'activity.walking'
  | 'activity.running'
  | 'activity.date'
  | 'activity.source'
  | 'activity.sourceManual'
  | 'activity.sourceGps'
  | 'activity.memo'
  | 'activity.commentsTitle'
  | 'activity.createShareCard'
  | 'rankingHero.starHint'
  | 'rankingHero.starExample'
  | 'rankingHero.toTop10'
  | 'rankingHero.peopleSlash'
  | 'rankingHero.viewAll'
  | 'rankingHero.regionTitle'
  | 'rankingHero.regionSub'
  | 'rankingHero.decadeTitle'
  | 'rankingHero.decadeSub'
  | 'rankingHero.genderTitle'
  | 'rankingHero.genderSub'
  | 'rankingHero.starterTitle'
  | 'rankingHero.starterSub'
  | 'rankingHero.noRecord'
  | 'rankingHero.runOnceCta'
  | 'rankingHero.champion'
  | 'rankingHero.toRank'
  | 'rankingHero.oneStep'
  | 'quotes.tabAll'
  | 'quotes.tabMine'
  | 'quotes.write'
  | 'quotes.emptyMine'
  | 'quotes.emptyAll'
  | 'quotes.emptyHint'
  | 'quotes.anonymous'
  | 'quotes.tagRunner'
  | 'quotes.tagClassic'
  | 'quotes.delete'
  | 'quotes.report'
  | 'quotes.composeTitle'
  | 'quotes.composeSub'
  | 'quotes.composePlaceholder'
  | 'quotes.composeFooter'
  | 'quotes.composeSubmit'
  | 'quotes.composing'
  | 'quotes.reportTitle'
  | 'quotes.reportSub'
  | 'quotes.reportR1'
  | 'quotes.reportR2'
  | 'quotes.reportR3'
  | 'quotes.reportR4'
  | 'quotes.reportR5'
  | 'quotes.reportSubmitted'
  | 'quotes.deleteConfirm'
  | 'quotes.deleted'
  | 'quotes.submitted'
  | 'photos.subTrending'
  | 'photos.subFriends'
  | 'photos.subRegion'
  | 'photos.subRecent'
  | 'photos.subLiked'
  | 'photos.uploadCta'
  | 'photos.emptyFriends'
  | 'photos.emptyRegionNoLoc'
  | 'photos.emptyRegion'
  | 'photos.emptyLiked'
  | 'photos.emptyDefault'
  | 'homeHero.rankingPrepping'
  | 'homeHero.rankingPreppingSub'
  | 'homeHero.retry'
  | 'homeHero.seeMyRanking'
  | 'homeHero.seeMyRankingSub'
  | 'homeHero.myRankingCondition'
  | 'homeHero.conditionDone'
  | 'homeHero.edit'
  | 'homeHero.waitingForOthers'
  | 'homeHero.holdSpot'
  | 'homeHero.viewFullRanking'
  | 'homeHero.tierChamp'
  | 'homeHero.tierRunnerUp'
  | 'homeHero.tierMedal'
  | 'homeHero.tierTop10'
  | 'homeHero.tierChallenging'
  | 'homeHero.runner'
  | 'homeHero.kmMore'
  | 'homeHero.toRankAbbr'
  // build 169: 잔여 영문화 — 홈 요약 4칩, 프로필 잔여, 마일리지 선물, 게시판 등
  | 'home.summaryTitle'
  | 'home.summaryWeek'
  | 'home.summaryMonth'
  | 'home.summaryYear'
  | 'home.summaryAllTime'
  | 'home.summaryRuns'
  | 'home.summaryMonthDays'
  | 'home.yoyLast'
  | 'home.friendStoriesTitle'
  | 'home.friendStoriesSeeAll'
  | 'ptr.welcomeTitle'
  | 'ptr.welcomeSub'
  | 'profile.mileage'
  | 'profile.totalLine'
  | 'profile.bestLong'
  | 'profile.bestPace'
  | 'profile.bestDur'
  | 'profile.pushOnTitle'
  | 'profile.pushOnSubReenable'
  | 'profile.pushOnSubInvite'
  | 'profile.menuMileageAdmin'
  | 'profile.dialogDeleteTitle'
  | 'profile.dialogDeleteBody'
  | 'profile.dialogDeleteSummary'
  | 'profile.dialogDeleteSummary2'
  | 'profile.dialogDeleteSummary3'
  | 'profile.dialogDeleteSummary4'
  | 'profile.dialogDeleteConfirmTip'
  | 'profile.dialogDeleteConfirmPlaceholder'
  | 'profile.dialogDeleteConfirmCta'
  | 'profile.dialogDeleteProcessing'
  | 'profile.dialogDeleteCancel'
  | 'profile.editPageTitle'
  | 'gift.title'
  | 'gift.balanceLabel'
  | 'gift.recipient'
  | 'gift.searchPlaceholder'
  | 'gift.recipientLabel'
  | 'gift.amountTitle'
  | 'gift.amountAll'
  | 'gift.cta'
  | 'gift.sending'
  | 'gift.errInvalid'
  | 'gift.errNotEnough'
  | 'gift.success'
  | 'gift.errGeneric'
  | 'feedback.boardTitle'
  | 'feedback.menuLabel'
  | 'ranking.notRunningYetTitle'
  | 'ranking.notRunningYetSub'
  | 'friend.add'
  | 'friend.added'
  | 'nearby.title'
  | 'nearby.modeRegion'
  | 'nearby.modePace'
  | 'nearby.searchCta';

const DICT: Record<Locale, Record<TranslationKey, string>> = {
  ko: {
    'common.loading': '로딩 중...',
    'common.save': '저장',
    'common.cancel': '취소',
    'common.retry': '다시 시도',
    'common.back': '뒤로',
    'nav.home': '홈',
    'nav.map': '지도',
    'nav.ranking': '랭킹',
    'nav.social': '소셜',
    'nav.shop': '쇼핑',
    'nav.profile': '내 정보',
    'home.matchedRank.cta': '내 랭킹 보기',
    'home.matchedRank.ctaSub': '지역·나이·성별을 입력하면 비슷한 러너들 사이 내 순위를 보여드려요',
    'home.todayTop': '오늘의 TOP',
    'home.friendsWeek': '이번 주 친구 비교',
    'home.gallery': '루티니스트 갤러리',
    'home.gallery.empty': '러닝 사진을 공유하면 이곳에 표시돼요',
    'profile.editTitle': '프로필 편집',
    'profile.nickname': '닉네임',
    'profile.region': '지역',
    'profile.detectRegion': '현재 위치로 자동 선택',
    'profile.detecting': '감지 중...',
    'profile.birthYear': '출생 연도',
    'profile.gender': '성별',
    'profile.male': '남성',
    'profile.female': '여성',
    'profile.other': '기타',
    'profile.runningSince': '러닝 시작 시점',
    'profile.rankingInfoNote': '비슷한 조건의 러너와 나를 비교해 재미있는 순위를 보여드려요',
    'profile.edit': '편집',
    'profile.runner': '러너',
    'profile.totalKm': '총 km',
    'profile.totalRuns': '총 러닝',
    'profile.streakDays': '연속일 🔥',
    'profile.badges': '배지',
    'profile.actionConnect': '건강 앱 연동',
    'profile.actionMessages': '쪽지함',
    'profile.actionMileage': '마일리지 내역',
    'profile.actionMileageGift': '마일리지 선물',
    'profile.menuAudit': '데이터 점검',
    'profile.menuAdminMileage': '마일리지 보상 설정 (관리자)',
    'profile.menuSupport': '고객 지원',
    'profile.menuPrivacy': '개인정보처리방침',
    'profile.menuTerms': '이용약관',
    'profile.deleteAccount': '계정 탈퇴',
    'profile.title': '내 정보',
    'profile.menuFeedback': '앱 기능 제안 게시판',
    'profile.menuPushSettings': '알림 설정',
    'profile.menuOrders': '내 주문 내역',
    'profile.menuAddresses': '배송지 관리',
    'profile.menuSeller': '판매자 콘솔',
    'profile.menuAdmin': '어드민 대시보드',
    'profile.pushOnSummary': '알림 ON · 주문·메시지·매칭 즉시 받기',
    'profile.themeTitle': '화면 모드',
    'profile.themeLight': '라이트',
    'profile.themeDark': '다크',
    'profile.themeSystem': '시스템',
    'profile.signOut': '로그아웃',
    'profile.totalSummary': '통산 {km}km · {runs}회 러닝',
    'settings.language': '언어',
    'home.title': '홈',
    'home.userMonthTitle': '{name}님의 {month}',
    'home.recentActivity': '최근 활동',
    'home.viewAllHistory': '전체 기록',
    'home.noActivityYet': '아직 기록이 없습니다',
    'home.connectHealthCta': '건강 앱 연동하기 →',
    'home.regionNotSet': '지역을 설정하면 랭킹에 참여할 수 있어요!',
    'home.regionNotSetSub': '프로필에서 시/구/동을 선택해보세요',
    'home.set': '설정',
    'home.goalAchieved': '{km}km 목표 달성!',
    'home.goalLabel': '/ {km} 목표',
    'home.goalRemaining': '남은 {remain}km · 하루 {daily}km',
    'home.totalSummary': '통산 {km}km · {runs}회 러닝',
    'home.todayKm': '오늘 km',
    'home.todayPace': '오늘 페이스',
    'home.recentPace': '최근 페이스',
    'home.monthKm': '이달 km',
    'home.monthDays': '이달 일수',
    'home.monthGoal': '내 {month} 목표',
    'home.monthGoalEmpty': '아직 이번 달 목표가 없습니다',
    'home.monthGoalSet': '목표 설정하기 →',
    'home.weekChallenge': '이번 주 도전',
    'home.weekChallengeRun': '이번 주도 한 번 달려볼까요?',
    'home.weekRunCta': '시작',
    'home.sync': '동기화',
    'home.synced': '{ago} 동기화',
    'home.tabToday': '오늘',
    'home.tabMonth': '이달',
    'home.tabYear': '올해',
    'ranking.title': '랭킹',
    'ranking.mine': '내 랭킹',
    'ranking.mileage': '마일리지',
    'ranking.world': '월드마라톤',
    'ranking.today': '🔥 오늘',
    'ranking.week': '📆 이번주',
    'ranking.month': '📅 이달',
    'ranking.year': '🏆 올해',
    'ranking.rank': '위',
    'ranking.of': '명',
    'ranking.champion': '챔피언!',
    'ranking.keepIt': '자리를 지켜요',
    'world.inProgress': '진행 중',
    'world.medals': '완주 메달',
    'world.series': '챌린지 시리즈',
    'world.newCourses': '새 코스',
    'world.start': '도전 시작',
    'world.continue': '계속하기',
    'world.entryFee': '참가비',
    'world.confirmStart': '이 코스를 시작할까요?',
    'world.completedAt': '완주: {date}',
    'world.distance': '{km}km',
    'world.participantsHeader': '같은 코스 도전 중',
    'social.title': '소셜',
    'social.tabFriends': '친구',
    'social.tabClubs': '클럽',
    'social.tabPhotos': '포토',
    'social.tabQuotes': '러너 한 줄',
    'social.weekCompare': '이번 주 친구 비교',
    'social.monthCompare': '이번 달 친구 비교',
    'social.thisWeek': '이번 주',
    'social.thisMonth': '이번 달',
    'social.weekMondayBase': '월요일 기준',
    'social.me': '나',
    'social.emptyFriendsTitle': '친구와 함께 달려보세요',
    'social.emptyFriendsSub': '동네·페이스 비슷한 러너를 추가하면 이번 주 km 비교가 보여요',
    'social.findFriendsCta': '친구 찾기 →',
    'social.nearbyTitle': '동네 러너 찾기',
    'social.nearbySub': '같은 동·구·시 러너와 친구 맺고 함께 달려요',
    'social.findRunners': '러너 찾기',
    'social.searchPlaceholder': '닉네임으로 검색',
    'social.noMatchRunner': '해당 닉네임의 러너가 없어요',
    'social.noPublicRunner': '아직 공개된 러너가 없어요',
    'social.searchHintMatch': '다른 닉네임으로 검색해보거나, 친구를 Routinist 에 초대해보세요',
    'social.searchHintPublic': '친구가 Routinist 에 가입하면 여기 나타납니다',
    'social.myClubs': '내 클럽',
    'social.createClub': '클럽 만들기',
    'social.noClub': '아직 가입한 클럽이 없습니다',
    'social.browseClubs': '클럽 둘러보기 →',
    'social.memberCount': '멤버 {count}명',
    'social.allClubs': '모든 클럽 둘러보기',
    'social.allClubsSub': '인기 클럽 · 가입하기',
    'shop.title': '쇼핑',
    'shop.search': '검색',
    'shop.cart': '장바구니',
    'shop.menu': '메뉴',
    'shop.searchPlaceholder': '찾으시는 상품을 입력하세요',
    'shop.cancel': '취소',
    'shop.recentSearch': '최근 검색',
    'shop.clearAll': '전체 삭제',
    'shop.suggested': '추천 검색어',
    'shop.heroBadge': 'RUNNERS PICK',
    'shop.heroTitle1': '러닝을 더 즐겁게',
    'shop.heroTitle2': '루티니스트 컬렉션',
    'shop.heroSub': '매일 달리는 사람을 위한 큐레이션',
    'shop.heroCta': '마일리지로 결제하기',
    'shop.categories': '카테고리',
    'shop.seeAll': '전체 보기',
    'shop.all': '전체',
    'shop.catClothes': '의류',
    'shop.catHats': '모자',
    'shop.catAccessories': '악세사리',
    'shop.catGoods': '굿즈',
    'shop.searchNoResult': '검색 결과가 없어요',
    'shop.categoryPreparing': '준비 중인 카테고리예요',
    'shop.comingSoon': '곧 상품이 올라올 예정이에요',
    'shop.viewAllProducts': '전체 상품 보기',
    'shop.hotProducts': '지금 핫한 상품',
    'shop.itemUnit': '{n}개',
    'shop.allProducts': '전체 상품',
    'shop.like': '찜',
    'shop.liked': '찜했어요 ❤️',
    'shop.unliked': '찜 해제했어요',
    'shop.retryLater': '잠시 후 다시 시도해주세요',
    'shop.fabCart': '장바구니 {n}',
    'shop.menuWishlist': '찜한 상품',
    'shop.menuOrders': '주문 내역',
    'shop.menuAddresses': '배송지 관리',
    'shop.menuMileage': '마일리지',
    'shop.menuSupport': '고객센터',
    'shop.menuBusinessInfo': '사업자 정보',
    'shop.menuTerms': '이용약관',
    'shop.menuRefund': '청약·환불',
    'shop.menuSignOut': '로그아웃',
    'shop.menuClose': '닫기',
    'activity.title': '활동 상세',
    'activity.notFound': '활동을 찾을 수 없습니다.',
    'activity.duration': '시간',
    'activity.pacePerKm': '페이스/km',
    'activity.kcal': 'kcal',
    'activity.heartRateAvg': '평균 심박수',
    'activity.heartRateMax': '최대 심박수',
    'activity.exerciseType': '운동 종류',
    'activity.walking': '걷기 🚶',
    'activity.running': '러닝 🏃',
    'activity.date': '날짜',
    'activity.source': '기록 방식',
    'activity.sourceManual': '수동 입력',
    'activity.sourceGps': 'GPS 트래킹',
    'activity.memo': '메모',
    'activity.commentsTitle': '응원 & 댓글',
    'activity.createShareCard': '공유카드 만들기',
    'rankingHero.starHint': '별을 눌러 필터를 풀면 더 넓은 코호트에서의 내 순위가 보여요.',
    'rankingHero.starExample': '예: 같은 동네에선 1위라도, 전 세계 기준에서는 순위가 달라질 수 있어요.',
    'rankingHero.toTop10': 'TOP 10 까지 {km}km',
    'rankingHero.peopleSlash': '/ {n}명',
    'rankingHero.viewAll': '전체 보기',
    'rankingHero.regionTitle': '우리 동네 TOP 10',
    'rankingHero.regionSub': '같은 구 러너끼리',
    'rankingHero.decadeTitle': '내 또래 TOP 10',
    'rankingHero.decadeSub': '같은 연령대·성별 전국',
    'rankingHero.genderTitle': '같은 성별 TOP 10',
    'rankingHero.genderSub': '성별 기준 전국',
    'rankingHero.starterTitle': '동기 러너 TOP 10',
    'rankingHero.starterSub': '비슷한 시기에 가입한 러너',
    'rankingHero.noRecord': '아직 기록이 없어요',
    'rankingHero.runOnceCta': '한 번 달리고 랭킹에 들어가봐요!',
    'rankingHero.champion': '챔피언! 자리를 지켜요',
    'rankingHero.toRank': '{target}위까지 {km}km',
    'rankingHero.oneStep': '한 발 더, 어제의 나를 이겨요',
    'quotes.tabAll': '전체',
    'quotes.tabMine': '내 한 줄',
    'quotes.write': '쓰기',
    'quotes.emptyMine': '아직 쓴 한 줄이 없어요',
    'quotes.emptyAll': '아직 등록된 한 줄이 없어요',
    'quotes.emptyHint': '우측 상단 쓰기로 첫 한 줄을 남겨보세요',
    'quotes.anonymous': '익명',
    'quotes.tagRunner': '러너',
    'quotes.tagClassic': '고전',
    'quotes.delete': '삭제',
    'quotes.report': '신고',
    'quotes.composeTitle': '한 줄 일기',
    'quotes.composeSub': '{name} 닉네임으로 표시돼요',
    'quotes.composePlaceholder': '예) "오늘도 한 발 더, 어제의 나를 이겼다."',
    'quotes.composeFooter': '좋아요 받기 + 공유 카드 캡션',
    'quotes.composeSubmit': '러너 한 줄 등록',
    'quotes.composing': '등록 중…',
    'quotes.reportTitle': '러너 한 줄 신고',
    'quotes.reportSub': '신고 사유를 선택해주세요. 3회 누적 시 자동 숨김 처리.',
    'quotes.reportR1': '부적절한 콘텐츠',
    'quotes.reportR2': '스팸/광고',
    'quotes.reportR3': '괴롭힘/혐오',
    'quotes.reportR4': '저작권 위반',
    'quotes.reportR5': '기타',
    'quotes.reportSubmitted': '신고 접수됨',
    'quotes.deleteConfirm': '이 한 줄을 삭제할까요?',
    'quotes.deleted': '삭제했어요',
    'quotes.submitted': '✨ 한 줄 일기가 등록됐어요',
    'photos.subTrending': '인기',
    'photos.subFriends': '친구',
    'photos.subRegion': '동네',
    'photos.subRecent': '최신',
    'photos.subLiked': '좋아요',
    'photos.uploadCta': '오늘 러닝 사진 올리기',
    'photos.emptyFriends': '친구가 올린 사진이 없어요. 친구 탭에서 러너를 친구로 추가해보세요!',
    'photos.emptyRegionNoLoc': '지역을 설정하면 내 동네 사진이 여기 보여요',
    'photos.emptyRegion': '{region} 에서 올린 사진이 아직 없어요',
    'photos.emptyLiked': '아직 좋아요한 사진이 없어요',
    'photos.emptyDefault': '오늘 러닝 기록이 있다면 위 버튼으로 공유카드를 만들어 첫 번째 러닝사진가 되어보세요!',
    'homeHero.rankingPrepping': '랭킹 준비 중...',
    'homeHero.rankingPreppingSub': '네트워크가 안정되면 자동으로 표시돼요',
    'homeHero.retry': '다시',
    'homeHero.seeMyRanking': '내 랭킹 보러가기 🏃‍♂️',
    'homeHero.seeMyRankingSub': '지역·성별·출생년도를 입력하면 비슷한 러너들 중 내 순위를 알려드려요',
    'homeHero.myRankingCondition': '랭킹 매칭 준비 중',
    'homeHero.conditionDone': '조건 입력 완료',
    'homeHero.edit': '수정',
    'homeHero.waitingForOthers': '같은 동네·또래 러너들을 모으는 중이에요. 한 번 달려보고, 친구도 초대해보세요 🏃',
    'homeHero.holdSpot': '자리를 지키고 있어요',
    'homeHero.viewFullRanking': '전체 랭킹 보기',
    'homeHero.tierChamp': '챔피언',
    'homeHero.tierRunnerUp': '준우승권',
    'homeHero.tierMedal': '메달권',
    'homeHero.tierTop10': 'TOP 10',
    'homeHero.tierChallenging': '도전 중',
    'homeHero.runner': '러너',
    'homeHero.kmMore': '{km}km 더',
    'homeHero.toRankAbbr': '→ {rank}위',
    'home.summaryTitle': '요약',
    'home.summaryWeek': '이번 주',
    'home.summaryMonth': '이번 달',
    'home.summaryYear': '올해',
    'home.summaryAllTime': '누적',
    'home.summaryRuns': '{n}회 러닝',
    'home.summaryMonthDays': '{days}일 · {runs}회',
    'home.yoyLast': '전년 {sign}{km}km',
    'home.friendStoriesTitle': '친구 활동 · 최근 72시간',
    'home.friendStoriesSeeAll': '전체 보기 →',
    'ptr.welcomeTitle': '👋 처음 오셨어요? 환영해요!',
    'ptr.welcomeSub': '화면을 아래로 살짝 당기면 Apple 건강 기록이 자동으로 채워져요 🍎',
    'profile.mileage': '마일리지',
    'profile.totalLine': '통산',
    'profile.bestLong': '최장 거리',
    'profile.bestPace': '최빠 페이스',
    'profile.bestDur': '최장 시간',
    'profile.pushOnTitle': '알림 켜기',
    'profile.pushOnSubReenable': '설정에서 다시 활성화하면 새 메시지·주문 알림을 받을 수 있어요',
    'profile.pushOnSubInvite': '주문·메시지·매칭 알림 받기',
    'profile.menuMileageAdmin': '마일리지 보상 설정 (관리자)',
    'profile.dialogDeleteTitle': '정말 탈퇴할까요?',
    'profile.dialogDeleteBody': '탈퇴하면 러닝 기록·사진·친구·마일리지 등 모든 데이터가 영구 삭제되며 복구할 수 없어요.',
    'profile.dialogDeleteSummary': '• 통산 {km}km · {runs}회 러닝 기록',
    'profile.dialogDeleteSummary2': '• 업로드한 사진과 캘린더',
    'profile.dialogDeleteSummary3': '• 친구·쪽지·응원 내역',
    'profile.dialogDeleteSummary4': '• 적립한 마일리지',
    'profile.dialogDeleteConfirmTip': '계속하려면 아래에 "탈퇴" 라고 입력해주세요',
    'profile.dialogDeleteConfirmPlaceholder': '탈퇴',
    'profile.dialogDeleteConfirmCta': '탈퇴하기',
    'profile.dialogDeleteProcessing': '탈퇴 처리 중...',
    'profile.dialogDeleteCancel': '취소',
    'profile.editPageTitle': '프로필 편집',
    'gift.title': '마일리지 선물',
    'gift.balanceLabel': '보유 마일리지',
    'gift.recipient': '받는 사람',
    'gift.searchPlaceholder': '닉네임으로 검색',
    'gift.recipientLabel': '받는 사람',
    'gift.amountTitle': '선물할 마일리지',
    'gift.amountAll': '전액',
    'gift.cta': '선물 보내기',
    'gift.sending': '전송 중…',
    'gift.errInvalid': '올바른 금액을 입력하세요',
    'gift.errNotEnough': '마일리지가 부족합니다',
    'gift.success': '{name}님에게 {pts}P 를 선물했어요 🎁',
    'gift.errGeneric': '선물 실패',
    'feedback.boardTitle': '앱 기능 제안 게시판',
    'feedback.menuLabel': '앱 기능 제안 게시판',
    'ranking.notRunningYetTitle': '이번 주는 아직 안 달렸어요',
    'ranking.notRunningYetSub': '이번 주 0km 인 러너들 사이에서는 모두 동률이에요. 한 번 달리면 순위에 오를 수 있어요!',
    'friend.add': '친구 추가',
    'friend.added': '친구',
    'nearby.title': '동네 러너 찾기',
    'nearby.modeRegion': '동네별',
    'nearby.modePace': '비슷한 페이스',
    'nearby.searchCta': '찾기',
  },
  en: {
    'common.loading': 'Loading...',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.retry': 'Retry',
    'common.back': 'Back',
    'nav.home': 'Home',
    'nav.map': 'Map',
    'nav.ranking': 'Ranking',
    'nav.social': 'Social',
    'nav.shop': 'Shop',
    'nav.profile': 'Profile',
    'home.matchedRank.cta': 'See your ranking',
    'home.matchedRank.ctaSub': 'Add your region, age, and gender to see how you rank among similar runners',
    'home.todayTop': "Today's TOP",
    'home.friendsWeek': "This week's friends",
    'home.gallery': 'Routinist Gallery',
    'home.gallery.empty': 'Share your running photos to see them here',
    'profile.editTitle': 'Edit profile',
    'profile.nickname': 'Nickname',
    'profile.region': 'Region',
    'profile.detectRegion': 'Auto-detect from current location',
    'profile.detecting': 'Detecting...',
    'profile.birthYear': 'Birth year',
    'profile.gender': 'Gender',
    'profile.male': 'Male',
    'profile.female': 'Female',
    'profile.other': 'Other',
    'profile.runningSince': 'Running since',
    'profile.rankingInfoNote': 'We rank you against runners with similar profiles for fun comparisons',
    'profile.edit': 'Edit',
    'profile.runner': 'Runner',
    'profile.totalKm': 'Total km',
    'profile.totalRuns': 'Total runs',
    'profile.streakDays': 'Streak 🔥',
    'profile.badges': 'Badges',
    'profile.actionConnect': 'Connect Health',
    'profile.actionMessages': 'Messages',
    'profile.actionMileage': 'Mileage',
    'profile.actionMileageGift': 'Gift mileage',
    'profile.menuAudit': 'Data audit',
    'profile.menuAdminMileage': 'Mileage rewards (admin)',
    'profile.menuSupport': 'Support',
    'profile.menuPrivacy': 'Privacy policy',
    'profile.menuTerms': 'Terms of service',
    'profile.deleteAccount': 'Delete account',
    'profile.title': 'Profile',
    'profile.menuFeedback': 'Feature requests',
    'profile.menuPushSettings': 'Notifications',
    'profile.menuOrders': 'My orders',
    'profile.menuAddresses': 'Addresses',
    'profile.menuSeller': 'Seller console',
    'profile.menuAdmin': 'Admin dashboard',
    'profile.pushOnSummary': 'Push ON · Get orders, messages, matches instantly',
    'profile.themeTitle': 'Theme',
    'profile.themeLight': 'Light',
    'profile.themeDark': 'Dark',
    'profile.themeSystem': 'System',
    'profile.signOut': 'Sign out',
    'profile.totalSummary': 'Total {km}km · {runs} runs',
    'settings.language': 'Language',
    'home.title': 'Home',
    'home.userMonthTitle': "{name}'s {month}",
    'home.recentActivity': 'Recent activity',
    'home.viewAllHistory': 'View all',
    'home.noActivityYet': 'No activity yet',
    'home.connectHealthCta': 'Connect health app →',
    'home.regionNotSet': 'Set your region to join the ranking!',
    'home.regionNotSetSub': 'Pick city / district in your profile',
    'home.set': 'Set up',
    'home.goalAchieved': '{km}km goal reached!',
    'home.goalLabel': '/ {km} goal',
    'home.goalRemaining': '{remain}km left · {daily}km/day',
    'home.totalSummary': 'Total {km}km · {runs} runs',
    'home.todayKm': 'Today km',
    'home.todayPace': 'Today pace',
    'home.recentPace': 'Recent pace',
    'home.monthKm': 'Month km',
    'home.monthDays': 'Month days',
    'home.monthGoal': 'My {month} goal',
    'home.monthGoalEmpty': "No goal for this month yet",
    'home.monthGoalSet': 'Set a goal →',
    'home.weekChallenge': 'Weekly challenge',
    'home.weekChallengeRun': 'Ready for a run this week?',
    'home.weekRunCta': 'Start',
    'home.sync': 'Sync',
    'home.synced': 'Synced {ago}',
    'home.tabToday': 'Today',
    'home.tabMonth': 'Month',
    'home.tabYear': 'Year',
    'ranking.title': 'Ranking',
    'ranking.mine': 'My ranking',
    'ranking.mileage': 'Mileage',
    'ranking.world': 'World marathon',
    'ranking.today': '🔥 Today',
    'ranking.week': '📆 Week',
    'ranking.month': '📅 Month',
    'ranking.year': '🏆 Year',
    'ranking.rank': 'th',
    'ranking.of': 'people',
    'ranking.champion': 'Champion!',
    'ranking.keepIt': 'Hold your spot',
    'world.inProgress': 'In progress',
    'world.medals': 'Medals',
    'world.series': 'Challenge series',
    'world.newCourses': 'New courses',
    'world.start': 'Start course',
    'world.continue': 'Continue',
    'world.entryFee': 'Entry fee',
    'world.confirmStart': 'Start this course?',
    'world.completedAt': 'Completed: {date}',
    'world.distance': '{km}km',
    'world.participantsHeader': 'Same course runners',
    'social.title': 'Social',
    'social.tabFriends': 'Friends',
    'social.tabClubs': 'Clubs',
    'social.tabPhotos': 'Photos',
    'social.tabQuotes': 'Quotes',
    'social.weekCompare': 'This week with friends',
    'social.monthCompare': 'This month with friends',
    'social.thisWeek': 'Week',
    'social.thisMonth': 'Month',
    'social.weekMondayBase': 'Starts Monday',
    'social.me': 'me',
    'social.emptyFriendsTitle': 'Run with friends',
    'social.emptyFriendsSub': 'Add runners nearby and at similar paces to compare your weekly km',
    'social.findFriendsCta': 'Find friends →',
    'social.nearbyTitle': 'Find runners nearby',
    'social.nearbySub': 'Connect with runners in your neighborhood and run together',
    'social.findRunners': 'Find runners',
    'social.searchPlaceholder': 'Search by nickname',
    'social.noMatchRunner': 'No runner with that nickname',
    'social.noPublicRunner': 'No public runners yet',
    'social.searchHintMatch': 'Try a different nickname, or invite friends to Routinist',
    'social.searchHintPublic': 'Your friends will show here when they join Routinist',
    'social.myClubs': 'My clubs',
    'social.createClub': 'Create club',
    'social.noClub': 'You have not joined any club yet',
    'social.browseClubs': 'Browse clubs →',
    'social.memberCount': '{count} members',
    'social.allClubs': 'Browse all clubs',
    'social.allClubsSub': 'Popular clubs · Join now',
    'shop.title': 'Shop',
    'shop.search': 'Search',
    'shop.cart': 'Cart',
    'shop.menu': 'Menu',
    'shop.searchPlaceholder': 'Search for products',
    'shop.cancel': 'Cancel',
    'shop.recentSearch': 'Recent',
    'shop.clearAll': 'Clear all',
    'shop.suggested': 'Suggested',
    'shop.heroBadge': 'RUNNERS PICK',
    'shop.heroTitle1': 'Make running more fun',
    'shop.heroTitle2': 'Routinist Collection',
    'shop.heroSub': 'Curated for daily runners',
    'shop.heroCta': 'Pay with mileage',
    'shop.categories': 'Categories',
    'shop.seeAll': 'See all',
    'shop.all': 'All',
    'shop.catClothes': 'Apparel',
    'shop.catHats': 'Hats',
    'shop.catAccessories': 'Accessories',
    'shop.catGoods': 'Goods',
    'shop.searchNoResult': 'No results found',
    'shop.categoryPreparing': 'Coming soon',
    'shop.comingSoon': 'New products coming soon',
    'shop.viewAllProducts': 'View all products',
    'shop.hotProducts': 'Trending now',
    'shop.itemUnit': '{n} items',
    'shop.allProducts': 'All products',
    'shop.like': 'Like',
    'shop.liked': 'Added to wishlist ❤️',
    'shop.unliked': 'Removed from wishlist',
    'shop.retryLater': 'Please try again later',
    'shop.fabCart': 'Cart {n}',
    'shop.menuWishlist': 'Wishlist',
    'shop.menuOrders': 'Orders',
    'shop.menuAddresses': 'Addresses',
    'shop.menuMileage': 'Mileage',
    'shop.menuSupport': 'Support',
    'shop.menuBusinessInfo': 'Business info',
    'shop.menuTerms': 'Terms',
    'shop.menuRefund': 'Refunds',
    'shop.menuSignOut': 'Sign out',
    'shop.menuClose': 'Close',
    'activity.title': 'Activity detail',
    'activity.notFound': 'Activity not found.',
    'activity.duration': 'Duration',
    'activity.pacePerKm': 'Pace/km',
    'activity.kcal': 'kcal',
    'activity.heartRateAvg': 'Avg HR',
    'activity.heartRateMax': 'Max HR',
    'activity.exerciseType': 'Type',
    'activity.walking': 'Walking 🚶',
    'activity.running': 'Running 🏃',
    'activity.date': 'Date',
    'activity.source': 'Source',
    'activity.sourceManual': 'Manual',
    'activity.sourceGps': 'GPS tracking',
    'activity.memo': 'Notes',
    'activity.commentsTitle': 'Cheers & comments',
    'activity.createShareCard': 'Create share card',
    'rankingHero.starHint': 'Tap a star to drop that filter and see your rank in a wider cohort.',
    'rankingHero.starExample': 'e.g. You might be #1 in your neighborhood but ranked differently worldwide.',
    'rankingHero.toTop10': '{km}km to TOP 10',
    'rankingHero.peopleSlash': '/ {n} people',
    'rankingHero.viewAll': 'View all',
    'rankingHero.regionTitle': 'My area TOP 10',
    'rankingHero.regionSub': 'Same district',
    'rankingHero.decadeTitle': 'My age group TOP 10',
    'rankingHero.decadeSub': 'Same age & gender nationwide',
    'rankingHero.genderTitle': 'Same gender TOP 10',
    'rankingHero.genderSub': 'By gender, nationwide',
    'rankingHero.starterTitle': 'Joined together TOP 10',
    'rankingHero.starterSub': 'Runners who joined around the same time',
    'rankingHero.noRecord': 'No records yet',
    'rankingHero.runOnceCta': 'Run once to get on the ranking!',
    'rankingHero.champion': 'Champion! Hold your spot',
    'rankingHero.toRank': '{km}km to #{target}',
    'rankingHero.oneStep': 'One more step — beat yesterday',
    'quotes.tabAll': 'All',
    'quotes.tabMine': 'Mine',
    'quotes.write': 'Write',
    'quotes.emptyMine': 'No notes yet',
    'quotes.emptyAll': 'No notes yet',
    'quotes.emptyHint': 'Tap Write at the top right to share your first note',
    'quotes.anonymous': 'Anonymous',
    'quotes.tagRunner': 'Runner',
    'quotes.tagClassic': 'Classic',
    'quotes.delete': 'Delete',
    'quotes.report': 'Report',
    'quotes.composeTitle': 'Today\'s note',
    'quotes.composeSub': 'Posted as {name}',
    'quotes.composePlaceholder': 'e.g. "One more step today — beat yesterday."',
    'quotes.composeFooter': 'Likes + share card caption',
    'quotes.composeSubmit': 'Post note',
    'quotes.composing': 'Posting…',
    'quotes.reportTitle': 'Report note',
    'quotes.reportSub': 'Pick a reason. Auto-hidden after 3 reports.',
    'quotes.reportR1': 'Inappropriate content',
    'quotes.reportR2': 'Spam / ads',
    'quotes.reportR3': 'Harassment / hate',
    'quotes.reportR4': 'Copyright',
    'quotes.reportR5': 'Other',
    'quotes.reportSubmitted': 'Reported',
    'quotes.deleteConfirm': 'Delete this note?',
    'quotes.deleted': 'Deleted',
    'quotes.submitted': '✨ Your note was posted',
    'photos.subTrending': 'Trending',
    'photos.subFriends': 'Friends',
    'photos.subRegion': 'Area',
    'photos.subRecent': 'Recent',
    'photos.subLiked': 'Liked',
    'photos.uploadCta': 'Upload today\'s run photo',
    'photos.emptyFriends': 'No photos from friends yet. Add runners as friends in the Friends tab!',
    'photos.emptyRegionNoLoc': 'Set your region to see local photos here',
    'photos.emptyRegion': 'No photos shared from {region} yet',
    'photos.emptyLiked': 'No liked photos yet',
    'photos.emptyDefault': 'If you ran today, tap the button above to create a share card and be the first runner photo!',
    'homeHero.rankingPrepping': 'Ranking is loading...',
    'homeHero.rankingPreppingSub': 'It will appear once the network is stable',
    'homeHero.retry': 'Retry',
    'homeHero.seeMyRanking': 'See my ranking 🏃‍♂️',
    'homeHero.seeMyRankingSub': 'Add region, gender, and birth year to see your rank among similar runners',
    'homeHero.myRankingCondition': 'Matching nearby runners',
    'homeHero.conditionDone': 'Profile complete',
    'homeHero.edit': 'Edit',
    'homeHero.waitingForOthers': "We're gathering runners in your area and age range. Try a run and invite friends 🏃",
    'homeHero.holdSpot': 'Holding the top spot',
    'homeHero.viewFullRanking': 'View full ranking',
    'homeHero.tierChamp': 'Champion',
    'homeHero.tierRunnerUp': 'Runner-up',
    'homeHero.tierMedal': 'Medalist',
    'homeHero.tierTop10': 'TOP 10',
    'homeHero.tierChallenging': 'Chasing',
    'homeHero.runner': 'Runner',
    'homeHero.kmMore': '{km}km more',
    'homeHero.toRankAbbr': '→ #{rank}',
    'home.summaryTitle': 'Summary',
    'home.summaryWeek': 'This week',
    'home.summaryMonth': 'This month',
    'home.summaryYear': 'This year',
    'home.summaryAllTime': 'All time',
    'home.summaryRuns': '{n} runs',
    'home.summaryMonthDays': '{days} days · {runs} runs',
    'home.yoyLast': 'YoY {sign}{km}km',
    'home.friendStoriesTitle': "Friends · Last 72 h",
    'home.friendStoriesSeeAll': 'See all →',
    'ptr.welcomeTitle': '👋 New here? Welcome!',
    'ptr.welcomeSub': 'Pull the screen down to auto-fill your Apple Health records 🍎',
    'profile.mileage': 'Mileage',
    'profile.totalLine': 'Total',
    'profile.bestLong': 'Longest km',
    'profile.bestPace': 'Best pace',
    'profile.bestDur': 'Longest time',
    'profile.pushOnTitle': 'Turn on notifications',
    'profile.pushOnSubReenable': 'Re-enable in Settings to receive new messages and order alerts',
    'profile.pushOnSubInvite': 'Get order, message, and match alerts',
    'profile.menuMileageAdmin': 'Mileage rewards (admin)',
    'profile.dialogDeleteTitle': 'Delete your account?',
    'profile.dialogDeleteBody': 'Deleting permanently removes your runs, photos, friends, mileage, and all data. This cannot be undone.',
    'profile.dialogDeleteSummary': '• {km}km · {runs} runs history',
    'profile.dialogDeleteSummary2': '• Uploaded photos & calendar',
    'profile.dialogDeleteSummary3': '• Friends, messages, cheers',
    'profile.dialogDeleteSummary4': '• Accumulated mileage',
    'profile.dialogDeleteConfirmTip': 'To continue, type "DELETE" below',
    'profile.dialogDeleteConfirmPlaceholder': 'DELETE',
    'profile.dialogDeleteConfirmCta': 'Delete account',
    'profile.dialogDeleteProcessing': 'Deleting...',
    'profile.dialogDeleteCancel': 'Cancel',
    'profile.editPageTitle': 'Edit profile',
    'gift.title': 'Gift mileage',
    'gift.balanceLabel': 'Your balance',
    'gift.recipient': 'Recipient',
    'gift.searchPlaceholder': 'Search by nickname',
    'gift.recipientLabel': 'Recipient',
    'gift.amountTitle': 'Amount to gift',
    'gift.amountAll': 'All',
    'gift.cta': 'Send gift',
    'gift.sending': 'Sending…',
    'gift.errInvalid': 'Please enter a valid amount',
    'gift.errNotEnough': 'Not enough mileage',
    'gift.success': 'Sent {pts}P to {name} 🎁',
    'gift.errGeneric': 'Gift failed',
    'feedback.boardTitle': 'Feature requests',
    'feedback.menuLabel': 'Feature requests',
    'ranking.notRunningYetTitle': 'No runs this week yet',
    'ranking.notRunningYetSub': 'All runners with 0km this week are tied. Run once to climb the ranks!',
    'friend.add': 'Add friend',
    'friend.added': 'Friends',
    'nearby.title': 'Find runners nearby',
    'nearby.modeRegion': 'Region',
    'nearby.modePace': 'Pace',
    'nearby.searchCta': 'Search',
  },
};

const STORAGE_KEY = 'routinist_locale';

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'ko';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && DICT[stored]) return stored;
  } catch {}
  const nav = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase();
  if (nav.startsWith('en')) return 'en';
  return 'ko';
}

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey) => string;
  // build 205 #14: 자유 텍스트 한↔영 매핑 — JSX 안 raw 한글을 점진적으로 영문화.
  // tt('판매자 신청') → 한국어 모드면 그대로, 영어 모드면 EXTRAS_EN['판매자 신청'] (fallback ko).
  // 새 키 추가는 정식 t('key') 권장. 잔존 한글을 일괄 영문화할 때 빠른 우회로.
  tt: (ko: string) => string;
}

const I18nContext = createContext<I18nState>({
  locale: 'ko',
  setLocale: () => {},
  t: (k) => k,
  tt: (ko) => ko,
});

// 자주 노출되는 잔존 한글 → 영어 매핑. 정식 키는 DICT 에 추가하고 t() 사용 권장.
// 임시 alias 로 사용 — 점진적 마이그레이션 안전망.
const EXTRAS_EN: Record<string, string> = {
  // 셀러 (build 205)
  '판매자 신청': 'Seller application',
  '판매자 신청 제출': 'Submit application',
  '심사 중이에요': 'Under review',
  '반려되었어요': 'Application rejected',
  '이미 판매자세요!': 'You are already a seller!',
  '상품을 직접 등록하고 매출 정산을 받아볼 수 있어요.': 'Register your own products and receive payouts.',
  '셀러 콘솔로 가기': 'Go to seller console',
  '신청이 접수되었어요. 영업일 기준 1~3일 안에 검토됩니다.': 'Application received. Review takes 1-3 business days.',
  '모든 항목을 입력해주세요': 'Please fill in every field',
  '제출 중...': 'Submitting...',
  '브랜드 정보': 'Brand info',
  '연락처': 'Contact',
  '정산 계좌': 'Payout account',
  '출고지': 'Shipping origin',
  '브랜드명 *': 'Brand name *',
  '사업자등록번호 *': 'Business registration no. *',
  '상호 *': 'Trade name *',
  '대표자명 *': 'Owner name *',
  '연락 전화 *': 'Phone *',
  '이메일 *': 'Email *',
  '은행명 *': 'Bank *',
  '계좌번호 *': 'Account no. *',
  '예금주명 *': 'Account holder *',
  '우편번호 *': 'Zip *',
  '주소 *': 'Address *',
  '출고지 전화 *': 'Origin phone *',
  '셀러 콘솔': 'Seller console',
  '아직 판매자가 아니에요': "You're not a seller yet",
  '상품을 직접 등록하려면 판매자 신청을 먼저 해주세요.': 'Apply for a seller account to register products.',
  '첫 상품 등록': 'Register first product',
  '신규': 'New',
  '편집': 'Edit',
  '삭제': 'Delete',
  '삭제 완료': 'Deleted',
  '판매중': 'Published',
  '임시저장': 'Draft',
  '비활성': 'Inactive',
  '전체': 'All',
  '심사 대기': 'Pending',
  '승인됨': 'Approved',
  '반려': 'Rejected',
  '승인 완료': 'Approved',
  '반려 완료': 'Rejected',
  '이 신청을 승인할까요?': 'Approve this application?',
  '반려 사유 (셀러에게 전달됨)': 'Reason for rejection (shown to seller)',
  '실패': 'Failed',
  // 어드민 상품
  '상품 관리': 'Products',
  // 트래킹
  '달리기 시작하기': 'Start running',
  'GPS 로 경로·거리·시간이 자동 기록돼요': 'GPS auto-records route, distance, and time',
  '달리기 완료!': 'Run complete!',
  '저장하기': 'Save',
  '저장 중…': 'Saving…',
  '저장 실패': 'Save failed',
  '이번 기록을 저장하지 않고 버릴까요?': 'Discard this run without saving?',
  // 홈
  '공유카드': 'Share card',
  '이번 주': 'This week',
  '이번 달': 'This month',
  '한 주·한 달 기록을 8초 영상 또는 9:16 이미지로 친구에게 자랑하세요':
    'Share your week or month as an 8-second video or 9:16 image',
  '이번 주 도전': 'This week challenge',
  '이번 주 목표 달성! 멋져요': 'Weekly goal achieved! Awesome',
  '절반 넘어왔어요. 계속!': "Halfway there. Keep going!",
  '이번 주도 한 번 달려볼까요?': "Let's run this week",
  // Apple Health
  'Apple 건강 앱 연동하기': 'Connect Apple Health',
  '러닝·걷기·심박·GPS 자동으로 가져옵니다': 'Auto import runs, walks, heart rate, GPS',
  'Apple Health 연동됨': 'Apple Health connected',
  'Apple Health 권한이 필요해요': 'Apple Health permission required',
  'Apple Health 최신 기록 불러오기': 'Sync latest from Apple Health',
  '새 기록이 없어요': 'No new records',
  '동기화 실패': 'Sync failed',
  '재시도': 'Retry',
  '동기화 시작...': 'Starting sync...',
  '동기화가 너무 오래 걸려요. 다시 시도해주세요': 'Sync took too long. Please try again',
  'Apple Health 와 연결해보세요': 'Connect with Apple Health',
  'Apple Health 다시 동기화 중...': 'Re-syncing Apple Health...',
  'Apple Health 다시 동기화 (90일)': 'Re-sync Apple Health (90 days)',
  '권한 + 데이터 진단 (30일)': 'Permissions + data diagnosis (30 days)',
  'iOS 설정 → 앱 권한 열기': 'Open iOS Settings → App permissions',
  '결과를 받지 못했어요. 잠시 후 다시 시도해주세요.': "Didn't receive a result. Please try again later.",
  '데이터 점검': 'Data audit',
  '활동 기록이 없습니다.': 'No activity records.',

  // build 206 추가 — shop/cart, checkout, orders, wishlist, product, addresses, payment
  '장바구니': 'Cart',
  '장바구니가 비어있어요': 'Your cart is empty',
  '재고가 부족해요': 'Out of stock',
  '실패했어요. 다시 시도해주세요': 'Something failed. Please try again',
  '장바구니에서 빼시겠어요?': 'Remove from cart?',
  '무료 🎉': 'Free 🎉',
  '결제': 'Checkout',
  '결제하기': 'Pay now',
  '필수 항목을 모두 입력해주세요': 'Please fill in all required fields',
  '전화번호 형식이 올바르지 않아요': 'Invalid phone number format',
  '조금만 기다려주세요\n다음주 정식 런칭 후 살 수 있어요 ✨': "Please wait\nGoes live next week ✨",
  '결제 시작 실패': 'Failed to start payment',
  '배송지': 'Shipping address',
  '새 배송지 추가': '+ New shipping address',
  '받는 사람 이름 *': 'Recipient name *',
  '마일리지': 'Mileage',
  '보유': 'Available',
  '모두 사용': 'Use all',
  '주문 내역': 'Orders',
  '아직 주문 내역이 없어요': 'No orders yet',
  '리뷰 작성하기': 'Write a review',
  '주문 상세': 'Order details',
  '정말 주문을 취소하시겠어요?\n결제 완료된 주문은 환불 처리됩니다.':
    'Cancel this order?\nPaid orders will be refunded.',
  '취소 요청 완료. 환불은 영업일 3-5일 소요돼요': 'Cancellation requested. Refund takes 3-5 business days',
  '취소 실패': 'Cancellation failed',
  '주문 취소': 'Cancel order',
  '결제 취소·환불': 'Cancel & refund',
  '반품·환불 신청': 'Return / refund',
  '잠시 후 다시 시도해주세요': 'Please try again later',
  '장바구니에 담았어요 🛒': 'Added to cart 🛒',
  '담기 실패': 'Add to cart failed',
  '아직 찜한 상품이 없어요': 'No favorites yet',
  '옵션을 선택해주세요': 'Please choose an option',
  '링크를 복사했어요 📋': 'Link copied 📋',
  '상품을 찾을 수 없어요': 'Product not found',
  '찜 해제했어요': 'Removed from favorites',
  '찜했어요 ❤️': 'Added to favorites ❤️',
  '품절': 'Sold out',
  '바로 구매': 'Buy now',
  '새 배송지 추가 완료': 'Address added',
  '수정 완료': 'Updated',
  '이 배송지를 삭제하시겠어요?': 'Delete this address?',
  '배송지 관리': 'Addresses',
  '등록된 배송지가 없어요': 'No saved addresses',
  '결제 정보가 부족해요': 'Payment info missing',
  '결제 확인 중...': 'Confirming payment...',
  '결제 확정 실패': 'Payment confirmation failed',
  '결제 완료!': 'Payment complete!',
  '주문이 접수됐어요': 'Your order has been received',
  '결제가 취소되었거나 실패했어요': 'Payment was cancelled or failed',
  '결제 실패': 'Payment failed',
  '다시 시도하시거나, 다른 결제 수단으로 진행해주세요': 'Please try again or use a different payment method',
  '의류': 'Apparel',
  '모자': 'Hats',
  '악세사리': 'Accessories',
  '굿즈': 'Goods',

  // profile
  '프로필 사진을 변경했어요 ✨': 'Profile photo updated ✨',
  '사진 업로드 실패': 'Photo upload failed',
  '탈퇴 실패': 'Account deletion failed',
  '러닝 코치 (AI)': 'Running coach (AI)',
  '오늘 컨디션 · 자기 기록 분석': "Today's condition · personal record analysis",
  '정말 탈퇴할까요?': 'Really delete your account?',
  '탈퇴하면 러닝 기록·사진·친구·마일리지 등 모든 데이터가 영구 삭제되며 복구할 수 없어요.':
    'Deleting your account permanently removes all runs, photos, friends, and mileage — this cannot be undone.',
  '계속하려면 아래에 ': 'To continue, type ',
  ' 라고 입력해주세요': ' below',
  '탈퇴': 'Delete',
  '탈퇴 처리 중...': 'Deleting...',
  '현재 위치: ': 'Current location: ',
  '위치 감지 실패': 'Failed to detect location',
  '닉네임을 다시 확인해주세요': 'Please check your nickname',
  '저장 요청 15초 초과 — 네트워크 확인 후 다시 시도해주세요': 'Save timed out (15s) — check network and try again',
  '저장되었습니다!': 'Saved!',
  '프로필 편집': 'Edit profile',
  '한 줄 소개를 입력해주세요': 'Enter a short bio',
  '현재 위치로 자동 선택': 'Auto from current location',
  '감지 중...': 'Detecting...',
  '비슷한 조건의 러너와 나를 비교해서 재미있는 순위를 보여드려요.':
    'Compare yourself with similar runners and see fun rankings.',
  '저장': 'Save',
  '저장됨': 'Saved',
  '✨ 저장됨': '✨ Saved',
  '채팅 메시지': 'Chat messages',
  '새 쪽지·채팅이 도착했을 때': 'When new messages arrive',
  '마일리지 선물': 'Mileage gifts',
  '다른 러너에게 선물을 받았을 때': 'When another runner sends you a gift',
  '운영자 답글': 'Admin replies',
  '내 제안에 운영자가 답글을 달았을 때': 'When admin replies to your feedback',
  '좋아요·응원': 'Likes & cheers',
  '필요한 알림만 받으세요': 'Choose only the notifications you want',

  // home cards
  '나의 러닝 지도': 'My running map',
  'GPS 경로가 모이면 지도가 그려져요': 'Your map appears as GPS routes accumulate',
  '최근 7일 러닝 경로': 'Last 7 days routes',
  '내 랭킹 보기': 'See my ranking',
  '지역·나이·성별을 입력하면 비슷한 러너들 사이 내 순위를 보여드려요':
    'Fill in your region, age, and gender to see your ranking among similar runners',
  '친구와 함께 달려보세요': 'Run with friends',
  '이번 주 친구 비교': 'This week with friends',
  '친구 관리': 'Manage friends',
  '이번 주 내 주변 러너': 'Neighbor runners this week',
  '전체 랭킹 보기': 'See full ranking',
  '짧게라도 1km 만 달려보세요': 'Try a quick 1km run',
  '오늘': 'Today',
  '오늘 ': "Today's ",
  '러닝 기록': ' run',
  '가장 먼저 기록해보세요': 'Be the first to log',
  '이미 픽했습니다 (변경 불가)': 'Already picked (cannot change)',
  '픽 완료! 일요일 자정에 결과 공개': 'Pick saved! Results Sunday midnight',
  '곧 마감': 'Closing soon',
  '🏆 이번 주 우승자 맞히기': '🏆 Pick this week winner',
  '한 번 정한 응원 픽은 일요일까지! 다음 주에 다시 만나요 ✨':
    'Your pick stands until Sunday. See you next week ✨',
  '우승자 맞히기 — 전체 후보': 'Pick the winner — all candidates',
  '전국 이번 주 거리 상위 후보들이에요. 1명만 응원할 수 있고, 변경은 불가능합니다.':
    'Top runners by distance this week. Pick only one — no changes after that.',
  '아직 이번 주에 달린 사람이 없어요': 'No runs logged this week yet',
  '일요일 자정 결과 공개 · 맞추면 +10점 + 예측왕 뱃지':
    'Results Sunday midnight · +10 points + Prophet badge if correct',
  '첫 번째 러닝사진가 되어보세요!': 'Be the first to post a run photo!',
  '사진 올리기': 'Upload photo',
  '이번 주 인기 러닝사진': 'Top photos this week',
  '루티니스트 갤러리': 'Routinist gallery',
  '러닝 사진을 공유하면 이곳에 표시돼요': 'Photos you share appear here',
  '내 기록에 사진 추가': 'Add photo to my runs',
  '러너': 'Runner',
  '한 달 동안 정말 잘 달렸어요. 마지막까지 달려봐요':
    "You ran great this month. Keep it up to the finish",
  '지난 주 회고': 'Last week recap',
  '이번 주 베스트:': 'Best this week:',
  '✓ 저장됐어요': '✓ Saved',
  '저장됐어요': 'Saved',
  '🎯 이달 목표를 설정했어요!': '🎯 Monthly goal saved!',
  '목표 거리를 입력해주세요': 'Please enter a target distance',
  'GPS 로 현재 지역 가져오기': 'Detect my region via GPS',

  // track summary
  '저장 후 id 없음': 'Saved without id',
  '시간': 'Time',
  '평균 페이스': 'Average pace',
  '경로': 'Route',
  '구간별 페이스': 'Pace by segment',

  // RichTextEditor
  '이미지 업로드 실패': 'Image upload failed',
  '링크 주소': 'Link URL',

  // build 207 — 프로필 라이트박스
  '프로필 보기 →': 'View profile →',

  // build 207 — home dashboard
  '연속 달리기 스트릭': 'Running streak',
  '현재 연속일': 'Current streak',
  '최장 연속일': 'Longest streak',
  '총 러닝': 'Total runs',
  '🔥 최장 기록 갱신 중!': '🔥 Breaking your record!',
  '개인 베스트': 'Personal best',
  '누적': 'All-time',
  '최장 거리': 'Longest distance',
  '최빠 페이스': 'Fastest pace',
  '최장 시간': 'Longest duration',
  '최다 칼로리': 'Most calories',
  '일별 거리 추이': 'Daily distance trend',
  '최근 12주 러닝': 'Last 12 weeks',
  '전년 동기 첫 기록 🎉': 'First record vs last year 🎉',
  '페이스 추이 (최근 12개월)': 'Pace trend (last 12 months)',
  '아래로 갈수록 빠른 페이스': 'Lower means faster pace',
  '요일별 러닝 패턴': 'Day-of-week pattern',
  '러닝 횟수': 'Run count',
  '시간대별 러닝 분포': 'Time-of-day distribution',
  '기간별 상세 통계': 'Detailed stats by period',
  '히스토리': 'History',
  '막대': 'Bar',
  '선': 'Line',
  '주간': 'Weekly',
  '월간': 'Monthly',
  '분기': 'Quarterly',
  '반기': 'Half-year',
  '연간': 'Yearly',
  '통계 로딩 중...': 'Loading stats...',
  '지역을 자동 등록했어요': 'Region auto-registered',
  '확인': 'OK',
  '내 정보': 'My profile',

  // build 207 — ranking
  // 칩 라벨 (RankingBreakdown)
  '대한민국': 'Korea',
  '서울특별시': 'Seoul',
  '부산광역시': 'Busan',
  '대구광역시': 'Daegu',
  '인천광역시': 'Incheon',
  '광주광역시': 'Gwangju',
  '대전광역시': 'Daejeon',
  '울산광역시': 'Ulsan',
  '세종특별자치시': 'Sejong',
  '경기도': 'Gyeonggi',
  '강원특별자치도': 'Gangwon',
  '강원도': 'Gangwon',
  '충청북도': 'Chungbuk',
  '충청남도': 'Chungnam',
  '전북특별자치도': 'Jeonbuk',
  '전라북도': 'Jeonbuk',
  '전라남도': 'Jeonnam',
  '경상북도': 'Gyeongbuk',
  '경상남도': 'Gyeongnam',
  '제주특별자치도': 'Jeju',
  '남성': 'Male',
  '여성': 'Female',
  '10대': '10s',
  '20대': '20s',
  '30대': '30s',
  '40대': '40s',
  '50대': '50s',
  '60대': '60s',
  '70대': '70s',
  '80대': '80s',
  '90대': '90s',
  '신규 러너': 'New runners',
  '동기 러너': 'Same start',
  // RankingTimeline
  '내 순위 시계열': 'My rank over time',
  '아직 시계열 데이터가 부족해요': 'Not enough timeline data yet',
  '몇 주만 더 달리면 그래프가 채워져요': 'A few more weeks and the chart fills up',
  '순위': 'Rank',
  '주간 (12주)': 'Weekly (12w)',
  '월간 (12개월)': 'Monthly (12mo)',
  '연간 (5년)': 'Yearly (5y)',
  '전국': 'All Korea',
  '내 지역': 'My region',
  '내 또래': 'My age',
  '동기': 'Same start',
  '같은 성별': 'Same gender',
  '위로 갈수록 좋은 순위 · 1위가 최상단': 'Higher = better rank · #1 at top',
  '기간별 내 거리 합계': 'Distance total per period',
  '거리': 'Distance',
  // MileageRankingTab
  '우리 동네': 'My neighborhood',
  '우리 또래': 'My age group',
  '지역(시·구)': 'Region (city/district)',
  '출생연도·성별': 'Birth year & gender',
  ' 정보를 입력하면 표시됩니다': ' info required to display',
  '내 프로필 편집 →': 'Edit my profile →',
  '아직 마일리지를 모은 러너가 없어요': 'No mileage runners yet',
  '달리고 첫 번째 1위가 되세요!': 'Run and be the first #1!',
  '마일': 'mileage',
  '(나)': '(me)',
  // CohortLeaderboardInline
  '내 위치': 'My position',
  // WorldTab
  '챌린지 시리즈': 'Challenge series',
  '한국 도전': 'Korea challenges',
  '자세히 →': 'Details →',
  '자세히': 'Details',
  '달리는 중': 'Running',
  '🏃 달리는 중': '🏃 Running',
  '새 코스': 'New courses',
  '아시아': 'Asia',
  '유럽': 'Europe',
  '미주': 'Americas',
  '오세아니아': 'Oceania',
  '아프리카': 'Africa',
  '글로벌': 'Global',
  '아직 등록된 코스가 없어요': 'No courses registered yet',
  '곧 추가될 예정이에요': 'More coming soon',
  '세계': 'World',
  ' 마일리지': ' mileage',
  '도전하기 →': 'Take the challenge →',
  '완주 후 도전 가능': 'Available after finishing',
  '진행 중인 코스를 완주한 후에 새 도전을 시작할 수 있어요 🏃': 'Finish your current course before starting a new one 🏃',
  '취소': 'Cancel',
  '출발! 🚀': 'Start! 🚀',
  '차감 중…': 'Charging…',
  '코스': 'course',
  '🏃 {name} 참가중이에요 — 바로 진입할게요!': '🏃 {name} already joined — entering now!',
  '🎉 출발! {fee} 마일리지 차감 (잔액 {bal})': '🎉 Start! {fee} mileage charged (balance {bal})',
  '출발 준비!': 'Ready to start!',
  '참가비': 'Entry fee',
  '차감하고 시작할게요.': 'will be charged.',
  '지금부터 달리는 모든 km 이 이 코스에 쌓여요.': 'Every km you run from now adds to this course.',
  '완주하면 디지털 인증서와 실물 메달이 기다리고 있어요! 🏅': 'Finish to earn a digital certificate and physical medal! 🏅',
  '시작에 실패했어요. 잠시 후 다시 시도해주세요': 'Failed to start. Please try again later',
  '남은 거리 ': 'Remaining ',
  '🎉 완주했어요! 메달이 기다려요': '🎉 Finished! Your medal is waiting',
  // 마라톤 고유명사
  '보스턴 마라톤': 'Boston Marathon',
  '뉴욕 마라톤': 'New York Marathon',
  '시카고 마라톤': 'Chicago Marathon',
  '런던 마라톤': 'London Marathon',
  '베를린 마라톤': 'Berlin Marathon',
  '도쿄 마라톤': 'Tokyo Marathon',
  '서울 마라톤': 'Seoul Marathon',
  '춘천 마라톤': 'Chuncheon Marathon',
  '제주 국제 마라톤': 'Jeju International Marathon',
  // 국가명
  '미국': 'USA',
  '영국': 'UK',
  '독일': 'Germany',
  '일본': 'Japan',
  '한국': 'Korea',
  '프랑스': 'France',
  '이탈리아': 'Italy',
  '중국': 'China',
  '캐나다': 'Canada',
  '호주': 'Australia',
  // 안내문
  '내 조건 입력하고 랭킹 보기 →': 'Enter your info to see rankings →',
  '지역·출생년도·성별을 설정하면 4가지 축으로 내 위치가 보여요': 'Set region, birth year, gender to see your rank across 4 axes',
  // build 208: feedback / support 페이지 영문 sweep
  '앱 기능 제안 게시판': 'Suggestions board',
  '접수됨': 'Open',
  '검토 중': 'Reviewing',
  '완료': 'Done',
  '인기순': 'Top',
  '최신순': 'Latest',
  '서비스를 더 나아지게 도와주세요': 'Help us make the service better',
  '버그·기능·UI 어떤 제안이든 환영해요. 좋아요가 모이면 우선 검토하고, 운영자가 직접 답글로 진행 상황을 알려드려요.':
    'Bugs, features, UI — any suggestion is welcome. We prioritize posts with more likes, and the team replies directly with progress updates.',
  '아직 글이 없어요': 'No posts yet',
  '첫 제안을 남겨주세요': 'Be the first to suggest',
  '버그': 'Bug',
  '기능 요청': 'Feature',
  'UI/UX': 'UI/UX',
  '비공개': 'Private',
  '첨부': 'Attachment',
  '신고': 'Report',
  '로그인이 필요해요': 'Sign in required',
  '제안 쓰기': 'Write suggestion',
  '✨ 제안이 등록됐어요': '✨ Suggestion posted',
  '게시글 신고': 'Report post',
  '신고 사유를 선택해주세요. 3회 누적되면 자동 숨김 처리되며 24시간 안에 운영자가 검토합니다.':
    'Please choose a reason. Posts auto-hide after 3 reports and are reviewed by the team within 24 hours.',
  '부적절한 콘텐츠': 'Inappropriate content',
  '스팸/광고': 'Spam / Ad',
  '괴롭힘/혐오': 'Harassment / Hate',
  '이미지 파일만 첨부할 수 있어요': 'Only image files are allowed',
  '이미지가 10MB 보다 커요': 'Image larger than 10MB',
  '제목이 너무 짧아요': 'Title too short',
  '내용이 너무 짧아요': 'Body too short',
  '알 수 없는 오류': 'Unknown error',
  '등록 실패': 'Submission failed',
  '의견을 들려주세요': 'Share your thoughts',
  '닫기': 'Close',
  '카테고리': 'Category',
  '사진 첨부': 'Attach photo',
  '(선택 · 캡쳐 화면 첨부 가능)': '(optional · screenshots welcome)',
  '첨부 이미지': 'Attached image',
  '첨부 이미지 제거': 'Remove attached image',
  '캡쳐 화면 / 사진 첨부하기': 'Attach screenshot / photo',
  '제목': 'Title',
  '한 줄로 요약해주세요': 'Summarize in one line',
  '내용': 'Content',
  '충분히 적었어요': 'Looks good',
  '공개로 등록': 'Post publicly',
  '비공개 (나·운영자만)': 'Private (you + admins)',
  '다른 러너가 좋아요를 누를 수 있어요. 같은 의견이 모이면 우선 반영됩니다.':
    'Other runners can like it. Popular requests get priority.',
  '공개 게시판에는 노출되지 않아요. 운영자만 볼 수 있어요.':
    'Not shown on the public board. Only admins can see it.',
  '등록 중…': 'Submitting…',
  '등록': 'Submit',
  '신고가 접수됐어요. 24시간 안에 검토합니다': 'Report received. We will review within 24 hours',
  '삭제됨': 'Deleted',
  '삭제 실패': 'Delete failed',
  '내 글을 삭제할까요?': 'Delete this post?',
  // support
  '고객 지원': 'Support',
  '제안 / 버그 게시판': 'Suggestions / Bugs board',
  '버그·기능 요청을 남기면 좋아요 모인 순서대로 우선 반영해요. 공개 글에는 운영자가 답글로 진행 상황을 알려드려요.':
    'Submit bugs or feature requests — the most-liked items get priority. Admins reply on public posts with progress.',
  '앱 소개': 'About the app',
  '문의하기': 'Contact us',
  '앱 사용 중 문제가 발생하거나 문의사항이 있으시면 아래 이메일로 연락해 주세요.':
    'If you encounter issues or have questions, please reach out by email below.',
  '이메일': 'Email',
  '자주 묻는 질문': 'Frequently asked questions',
  '러닝 기록이 자동으로 동기화되지 않아요': 'Running records are not syncing automatically',
  '목표는 어떻게 설정하나요?': 'How do I set goals?',
  '회원 탈퇴는 어떻게 하나요?': 'How do I delete my account?',
  '앱에서 수집하는 데이터는 무엇인가요?': 'What data does the app collect?',
  '운영 정보': 'Operator info',
  '서비스명': 'Service',
  '운영사': 'Operator',
  // build 208 #2: /track active state UI
  '위치 권한이 필요해요': 'Location permission required',
  '돌아가기': 'Go back',
  '뒤로': 'Back',
  '달리기 시작': 'Start running',
  '달리기 준비': 'Ready to run',
  '재개': 'Resume',
  '지도를 불러올 수 없어요': 'Map could not be loaded',
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ko');

  useEffect(() => {
    setLocaleState(detectInitialLocale());
  }, []);

  const value = useMemo<I18nState>(() => {
    return {
      locale,
      setLocale: (l) => {
        setLocaleState(l);
        try { window.localStorage.setItem(STORAGE_KEY, l); } catch {}
      },
      t: (key) => DICT[locale]?.[key] ?? DICT.ko[key] ?? key,
      tt: (ko) => locale === 'en' ? (EXTRAS_EN[ko] ?? ko) : ko,
    };
  }, [locale]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}

// build 206: 통화 포맷 — 한국어: "12,300원" / 영어: "₩12,300".
// 원/원화 표기 차이를 locale 별로 일관 처리. 모든 shop 화면에서 공통 사용.
export function formatKrw(amount: number, locale: Locale): string {
  if (amount == null || isNaN(amount)) return locale === 'en' ? '₩0' : '0원';
  const formatted = amount.toLocaleString();
  return locale === 'en' ? `₩${formatted}` : `${formatted}원`;
}

// build 207: 서수 포맷 — 한국어 "3위" / 영어 "3rd". 빌드 205 부터 단순 'th' 회귀로 "3th" 표시.
// 영어 ordinal 규칙: 11/12/13 은 th, 그 외엔 1→st 2→nd 3→rd 4~9→th, 21/22/23 도 st/nd/rd.
export function formatRank(rank: number, locale: Locale): string {
  if (rank == null || isNaN(rank) || rank < 1) return '—';
  return `${rank}${rankSuffix(rank, locale)}`;
}

// 숫자와 접미사를 분리 렌더하는 UI 용 (큰 숫자 + 작은 접미사 디자인). "위" 또는 "st/nd/rd/th".
export function rankSuffix(rank: number, locale: Locale): string {
  if (locale === 'ko') return '위';
  if (rank == null || isNaN(rank) || rank < 1) return '';
  const lastTwo = rank % 100;
  const lastOne = rank % 10;
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  if (lastOne === 1) return 'st';
  if (lastOne === 2) return 'nd';
  if (lastOne === 3) return 'rd';
  return 'th';
}
