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
    'ranking.world': '월드런 챌린지',
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
    'ranking.world': 'WorldRun Challenge',
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
  // build 290 (i18n Phase A): fallback 을 ko → en 으로 반전.
  // 이전엔 "en 시작만 en, 나머지 전부 ko" — 프랑스/일본/스페인 등 비영어권 기기가
  // 전부 한국어로 시작하는 글로벌 역행 버그. 한국어 기기만 ko, 그 외엔 en.
  const nav = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase();
  if (nav.startsWith('ko')) return 'ko';
  return 'en';
}

// build 290: React context 밖 (lib 함수) 에서 현재 locale 이 필요할 때 사용.
// I18nProvider.setLocale 이 STORAGE_KEY 에 즉시 기록하므로 저장값 = 현재 선택값.
export function getCurrentLocale(): Locale {
  return detectInitialLocale();
}

// build 290 (i18n Phase A): lib 함수 (auth.ts 에러, health-sync 토스트 등 hook 사용 불가 위치) 용
// tt() 대응물. EXTRAS_EN 에 키가 있으면 en 번역, 없으면 한국어 원문 (tt 와 동일 계약).
export function ttl(ko: string): string {
  return getCurrentLocale() === 'en' ? (EXTRAS_EN[ko] ?? ko) : ko;
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
  // 알림함 (build 298)
  '모두 읽음': 'Mark all read',

  // 주간 스트릭 + 주간 목표 원탭 (build 299 C1+C2)
  '주간 목표': 'Weekly goal',
  '이번 주 몇 번 달릴까요?': 'How many runs this week?',
  '거리보다 꾸준함! 횟수 목표를 채우면 주간 연속 기록이 쌓여요': 'Consistency beats distance! Hit your weekly count and your weekly streak grows',
  '다른 횟수로 정하기': 'Pick a different count',
  '수정': 'Edit',
  '좋아요! 이번 주부터 하나씩 채워봐요': 'Nice! Let’s fill them in one by one this week',
  '지난주는 이미 지켜져 있어요': 'Last week is already covered',
  '주간 러닝 스트릭': 'Weekly running streak',
  '연속 달성 주': 'Weeks in a row',
  '이번 주 러닝': 'Runs this week',
  '최장 연속 주': 'Longest streak',

  // 러닝 직후 보상 순간 (build 299 C3)
  '마일리지 +{n}P 적립!': 'Earned +{n}P mileage!',
  '이번 주 {n}번째 러닝 🔥': 'Run #{n} this week 🔥',
  '러닝 {n}개를 가져왔어요!': 'We imported {n} runs!',
  '지금까지의 기록이 모두 준비됐어요.': 'All your past records are ready.',
  '이번 주 첫 러닝, 가볍게 달려볼까요? 👟': 'How about an easy first run this week? 👟',
  '좋아요, 시작할게요!': "Great, let's go!",

  // Android Health Connect (build 297)
  'Health Connect 앱이 필요해요. Play 스토어에서 설치해주세요.': 'The Health Connect app is required. Please install it from the Play Store.',
  'Health Connect 업데이트가 필요해요. Play 스토어에서 업데이트해주세요.': 'Health Connect needs an update. Please update it in the Play Store.',
  'Health Connect 연결 완료! 러닝 기록을 가져오는 중...': 'Health Connect connected! Importing your runs...',
  'Health Connect 앱에서 Routinist 권한을 허용해주세요.': 'Please allow Routinist access in the Health Connect app.',
  'Health Connect 러닝 기록 조회 중...': 'Reading runs from Health Connect...',
  'Health Connect 에 러닝 기록이 아직 없어요 👟': 'No runs in Health Connect yet 👟',
  '삼성 헬스·갤럭시 워치 러닝 기록 자동 가져오기': 'Auto-import runs from Samsung Health & Galaxy Watch',
  '건강 데이터를 가져오려면 Health Connect 앱이 필요해요': 'The Health Connect app is required to import health data',
  'Play 스토어에서 Health Connect 받기': 'Get Health Connect on the Play Store',
  '연결하는 중…': 'Connecting…',
  '연결하기': 'Connect',
  '연결됨': 'Connected',
  '동기화': 'Sync',
  '마지막 동기화': 'Last synced',
  'Health Connect에서 권한 관리': 'Manage permissions in Health Connect',

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
  '위로 갈수록 빠른 페이스': 'Higher means faster pace',
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
  // ── build 290 i18n Phase A: 인증 여정 ──
  // login page
  '인증을 확인했어요. 비밀번호를 입력해 로그인해주세요.': "You're verified! Enter your password to sign in.",
  '로그인이 만료되어 자동으로 로그아웃했어요. 다시 로그인해주세요.': 'Your session expired, so we signed you out. Please sign in again.',
  '세션을 초기화했어요. 다시 로그인해주세요.': 'Your session was reset. Please sign in again.',
  '(로그 없음)': '(no log)',
  '(로그 접근 실패)': '(could not read log)',
  '로그인 중 오류가 발생했습니다.': 'Something went wrong while signing in.',
  '로그인 실패': 'Sign-in failed',
  '오류가 발생했습니다.': 'Something went wrong.',
  '가입되지 않은 이메일이거나 비밀번호가 틀렸어요.\n처음이라면 아래에서 회원가입을 진행해주세요.':
    "We couldn't find that account, or the password didn't match.\nIf you're new here, just sign up below.",
  '이미 가입된 이메일이에요.\n비밀번호로 로그인하거나, 비밀번호를 잊으셨다면 아래 "비밀번호를 잊으셨나요?"를 눌러주세요.':
    'This email is already registered.\nSign in with your password, or tap "Forgot your password?" below if you need a reset.',
  '비밀번호 재설정을 위해 이메일을 먼저 입력해주세요.': 'Please enter your email first so we can send a reset link.',
  '비밀번호 재설정 메일을 보냈습니다.': 'Password reset email sent. Please check your inbox.',
  '재설정 메일 전송 실패': 'Could not send the reset email',
  '인증 메일 재전송을 위해 이메일을 먼저 입력해주세요.': 'Please enter your email first so we can resend the verification email.',
  '인증 메일을 다시 보냈어요. 메일함을 확인해주세요.': 'Verification email sent again. Please check your inbox.',
  '재전송 실패': 'Could not resend',
  'Google로 이동 중...': 'Heading to Google...',
  'Google로 시작하기': 'Continue with Google',
  'Apple로 이동 중...': 'Heading to Apple...',
  'Apple로 시작하기': 'Continue with Apple',
  '또는': 'or',
  '이메일 로그인': 'Email sign-in',
  '이메일 회원가입': 'Email sign-up',
  '메일을 보냈어요!': 'Email sent!',
  '재전송 완료': 'Sent!',
  '인증 메일 다시 보내기': 'Resend verification email',
  '다른 이메일로 가입하기': 'Sign up with a different email',
  '이미 인증을 마쳤어요 → 로그인': 'Already verified → Sign in',
  '닉네임 (선택)': 'Nickname (optional)',
  '비밀번호 (6자 이상)': 'Password (6+ characters)',
  '처리 중...': 'Working on it...',
  '로그인': 'Sign in',
  '가입하기': 'Sign up',
  '비밀번호를 잊으셨나요?': 'Forgot your password?',
  '← 소셜 로그인으로 돌아가기': '← Back to social sign-in',
  '외부 브라우저에서 인증을 완료해주세요. 인증이 끝나면 앱이 자동으로 돌아옵니다.':
    "Please finish signing in from the browser window. The app will pick right back up once you're done.",
  '진단 로그 (/login?debug=1)': 'Diagnostic log (/login?debug=1)',
  '새로고침': 'Refresh',
  '(새로고침 눌러 로그 보기)': '(tap Refresh to view the log)',
  '🛍️ 로그인 없이 쇼핑 둘러보기 →': '🛍️ Browse the shop without signing in →',
  // auth callback page
  '이메일 인증 완료!': 'Email verified!',
  '인증이 정상적으로 처리됐어요.': 'Your email was verified successfully.',
  '이제 앱(또는 웹)으로 돌아가 로그인해주세요.': 'Now head back to the app (or web) and sign in.',
  '앱 열기': 'Open the app',
  '웹에서 로그인 계속하기': 'Continue signing in on the web',
  '앱이 안 열리면 App Store 에서 Routinist 를 먼저 설치해주세요.':
    "If the app doesn't open, please install Routinist from the App Store first.",
  '인증 링크가 만료됐어요': 'This verification link has expired',
  '링크가 이미 사용됐거나 시간이 지났을 수 있어요.': 'The link may have been used already or timed out.',
  '로그인 화면에서 메일을 다시 받아주세요.': 'Please request a new email from the sign-in screen.',
  '로그인 화면으로': 'Go to sign-in',
  '로그인 처리 중...': 'Signing you in...',
  // member page (클럽 멤버 상세)
  '멤버를 찾을 수 없습니다': 'Member not found',
  '대시보드로 돌아가기': 'Back to dashboard',
  '대시보드': 'Dashboard',
  '휴면': 'Inactive',
  '통산': 'Total',
  '월평균': 'Monthly avg',
  '활동 기간': 'Active months',
  '피니셔 달성': 'Finisher months',
  '월 최고': 'Best month',
  '피니셔 확률': 'Finisher rate',
  '월별 목표 vs 달성': 'Monthly goal vs actual',
  '목표': 'Goal',
  '달성': 'Achieved',
  '거리 성장 추이': 'Distance growth',
  '평균': 'Avg',
  '월별 기록': 'Monthly records',
  '월': 'Month',
  '달성률': 'Rate',
  '상태': 'Status',
  '미달': 'Missed',
  '일별 러닝 거리': 'Daily running distance',
  '일별 거리': 'Daily distance',
  '누적 거리': 'Cumulative distance',
  '일별 러닝 기록': 'Daily run log',
  '날짜': 'Date',
  '메모': 'Notes',
  // lib/auth.ts 에러 메시지 (ttl 로 조회)
  '로그인이 취소됐어요.': 'Sign-in was cancelled.',
  '예상하지 못한 provider 응답': 'Unexpected provider response',
  '이 이메일은 이미 Google 또는 이메일로 가입되어 있어요. 처음 가입했던 방법으로 다시 시도해주세요.':
    'This email is already registered with Google or email sign-up. Please try again with the method you first used.',
  '이 이메일은 이미 Apple 또는 이메일로 가입되어 있어요. 처음 가입했던 방법으로 다시 시도해주세요.':
    'This email is already registered with Apple or email sign-up. Please try again with the method you first used.',
  '네트워크 연결을 확인하고 다시 시도해주세요.': 'Please check your network connection and try again.',
  'Apple 로그인 실패': 'Apple sign-in failed',
  'Google 로그인 실패': 'Google sign-in failed',
  'Google 로그인 응답 형식이 올바르지 않아요.': "Google's sign-in response looked off. Please try again.",
  'Google 로그인이 취소됐거나 토큰을 받지 못했어요.': "Google sign-in was cancelled or we didn't receive a token.",
  'OAuth URL 을 받지 못했어요.': "We couldn't get the sign-in URL. Please try again.",
  '이 이메일은 이미 다른 방식으로 가입되어 있어요. 처음 가입했던 방법으로 다시 시도해주세요.':
    'This email is already registered another way. Please try again with the method you first used.',
  '이메일 정보를 받지 못했어요. 권한 요청 화면에서 이메일 공유를 허용해주세요.':
    "We didn't receive your email address. Please allow email sharing on the permission screen.",
  'OAuth 프로바이더 에러': 'OAuth provider error',
  'exchangeCode 실패': 'Code exchange failed',
  'setSession 실패': 'Session setup failed',
  '인증 메일을 너무 자주 보내셨어요.\n약 1시간 후 다시 시도해주세요.':
    "We've sent quite a few emails already.\nPlease try again in about an hour.",
  '비밀번호는 6자 이상으로 설정해주세요.': 'Please use a password with at least 6 characters.',
  '현재 회원가입이 일시 중단되었어요. 잠시 후 다시 시도해주세요.': 'Sign-ups are paused for a moment. Please try again soon.',
  '이메일 형식이 올바르지 않아요. 다시 확인해주세요.': "That email address doesn't look right. Please double-check it.",
  '아직 이메일 인증이 완료되지 않았어요.\n가입 시 받으신 메일에서 인증 링크를 눌러주세요.':
    "Your email isn't verified yet.\nPlease tap the verification link in the email we sent when you signed up.",
  '이메일 또는 비밀번호가 일치하지 않아요.': "Your email or password doesn't match. Please try again.",
  '잠시 후 다시 시도해주세요. 너무 자주 시도하셨어요.': 'Please wait a moment and try again — that was a few too many tries.',
  // ── build 291 i18n Phase B1: 클럽 ──
  // 클럽 상세 (social/clubs/detail)
  '정말 클럽을 탈퇴하시겠습니까?': 'Are you sure you want to leave this club?',
  '피드': 'Feed',
  '챌린지·모임': 'Challenges',
  '🌍 월드런': '🌍 World Run',
  '멤버': 'Members',
  '활동': 'Activity',
  '결산': 'Recap',
  '설정': 'Settings',
  '게시글 등록 실패': "Couldn't post — please try again",
  '공지 전환 실패': "Couldn't update the notice",
  '게시글을 삭제할까요?': 'Delete this post?',
  '챌린지 등록 실패': "Couldn't create the challenge",
  '챌린지를 삭제할까요?': 'Delete this challenge?',
  '이벤트 등록 실패': "Couldn't create the meetup",
  'RSVP 실패': "Couldn't save your RSVP",
  '이벤트를 삭제할까요?': 'Delete this meetup?',
  '댓글 등록 실패': "Couldn't post your comment",
  '클럽이 삭제되었습니다.': 'The club has been deleted.',
  '클럽을 찾을 수 없습니다.': "We couldn't find that club.",
  '뒤로가기': 'Go back',
  '클럽 가입': 'Join club',
  '클럽 오너': 'Club owner',
  '복사됨!': 'Copied!',
  '초대 링크': 'Invite link',
  'URL 복사': 'Copy URL',
  'QR 카드': 'QR card',
  '이미지로 공유': 'Share as image',
  '이번 주 MVP': 'MVP of the week',
  '클럽 총 거리': 'Club total distance',
  '인당 평균': 'Avg per member',
  '활동 멤버 기준': 'Among active members',
  '이달 완료': 'Month complete',
  '활동 멤버': 'Active members',
  '통산 누적 랭킹': 'All-time ranking',
  '명예의 전당': 'Hall of Fame',
  '전체 히스토리 보기': 'View full history',
  '클럽에 글을 남겨보세요...': 'Share something with your club...',
  '아직 게시글이 없어요': 'No posts yet',
  '첫 글을 남겨보세요!': 'Be the first to post!',
  '공지': 'Notice',
  '공지 해제': 'Unpin notice',
  '공지로': 'Pin as notice',
  '첫 댓글을 남겨보세요': 'Be the first to comment',
  '댓글 남기기...': 'Write a comment...',
  '새 게시글': 'New post',
  '클럽에 공유할 이야기를 적어보세요...': 'Write something to share with your club...',
  '사진': 'Photo',
  '공지로 등록': 'Post as notice',
  '올리는 중...': 'Posting...',
  '게시하기': 'Post',
  '챌린지': 'Challenges',
  '만들기': 'Create',
  '첫 챌린지를 만들어 보세요 (예: "이번 주 10km")': 'Create your first challenge (e.g. "10km this week")',
  '진행 중인 챌린지가 없어요': 'No active challenges right now',
  '진행중': 'Active',
  '종료': 'Ended',
  '예정': 'Upcoming',
  '모임': 'Meetups',
  '모임 만들기': 'Create meetup',
  '예정된 모임이 없어요. "주말 한강 러닝" 같은 모임을 만들어보세요!': 'No upcoming meetups. Try creating one like "Weekend riverside run"!',
  '참석': 'Going',
  '관심': 'Maybe',
  '불참': "Can't go",
  '새 챌린지': 'New challenge',
  '제목 (예: 이번 주 10km 챌린지)': 'Title (e.g. 10km this week)',
  '설명 (선택)': 'Description (optional)',
  '목표 km': 'Goal km',
  '목표 횟수': 'Goal runs',
  '둘 중 하나 이상 입력. 둘 다 달성해야 완료.': 'Enter at least one. Both must be reached to complete.',
  '챌린지 시작': 'Start challenge',
  '새 모임': 'New meetup',
  '모임 제목 (예: 한강 5km 러닝)': 'Meetup title (e.g. Riverside 5km run)',
  '장소 (예: 반포 한강공원)': 'Location (e.g. Riverside Park)',
  '최대 인원 (비우면 제한 없음)': 'Max attendees (leave blank for no limit)',
  '소개 (선택)': 'Details (optional)',
  '클럽 멤버 추이 비교': 'Member trends compared',
  '이번 주 멤버 비교': 'This week, member by member',
  '이번 달 멤버 비교': 'This month, member by member',
  '이번주': 'Week',
  '이번달': 'Month',
  '불러오는 중…': 'Loading…',
  '모두 보이기': 'Show all',
  '숨기기': 'Hide',
  '숨김': 'Hidden',
  '오너': 'Owner',
  '관리자': 'Admin',
  '관리자 해제': 'Remove admin',
  '관리자 지정': 'Make admin',
  '추방': 'Remove',
  '아직 클럽 활동이 없습니다': 'No club activity yet',
  '+ 응원': '+ Cheer',
  '내 활동은 클럽원의 응원을 받을 수 있어요': 'Clubmates can cheer for your activity',
  '클럽 이름': 'Club name',
  '소개': 'About',
  '공개 클럽': 'Public club',
  '누구나 검색하고 가입할 수 있습니다': 'Anyone can find and join this club',
  '저장 중...': 'Saving...',
  '이 클럽을 삭제합니다.': 'This will delete the club.',
  '앱 관리자 권한으로 이 클럽을 삭제합니다.': 'This will delete the club with app-admin privileges.',
  '되돌릴 수 없습니다.': 'This cannot be undone.',
  '삭제 중...': 'Deleting...',
  '[관리자] 이 클럽 삭제': '[Admin] Delete this club',
  '이 클럽 삭제': 'Delete this club',
  // 클럽 목록 (social/clubs)
  '러닝 클럽': 'Running clubs',
  '클럽 목록을 불러올 수 없습니다': "Couldn't load the club list",
  '다시 시도': 'Try again',
  '아직 클럽이 없습니다': 'No clubs yet',
  '첫 번째 클럽을 만들어보세요!': 'Create the very first club!',
  // ClubWorldRunPanel
  '시작 실패': "Couldn't start — please try again",
  '클럽 함께 도전': 'Club challenge, together',
  '멤버들이 달리는 모든 km 가 자동으로 클럽 합산에 쌓여요. 모이면 함께 완주!': "Every km your members run adds up for the club automatically. Together, you'll finish it!",
  '운영자가 코스를 시작할 수 있어요.': 'Admins can start a course.',
  '운영자가 코스를 시작하면 시작돼요.': 'It begins once an admin starts a course.',
  '아직 시작한 도전이 없어요': 'No challenges started yet',
  '운영자가 새 도전을 시작하면 알림이 와요': "You'll get a notification when an admin starts a new challenge",
  '새 도전 시작': 'Start a new challenge',
  '각자 달리기': 'Run solo',
  '자동 합산': 'Pooled km',
  '남은 거리': 'To go',
  '탭해서 리더보드 →': 'tap for leaderboard →',
  '새 도전 추가': 'Add another challenge',
  '🏆 완주한 도전': '🏆 Finished challenges',
  '새 클럽 도전 시작': 'Start a new club challenge',
  '진행 방식': 'How it works',
  '🏃 각자 달리기': '🏃 Run solo',
  '멤버 각자 본인 진행률': 'Each member tracks their own progress',
  '🤝 자동 합산': '🤝 Pooled km',
  '전 멤버 km 합쳐 1회 완주': "Everyone's km pool into one finish",
  '선택 가능한 코스가 없어요': 'No courses available to pick',
  '시작 중…': 'Starting…',
  '시작 →': 'Start →',
  '참가비는 차감되지 않아요. 클럽 멤버 활동이 자동 합산됩니다.': "No entry fee is charged. Members' activities add up automatically.",
  '완주!': 'Finished!',
  '클럽 합산 진행': 'Club total progress',
  '멤버들이 각자 본인 페이스로 같은 코스를 달려요. 본인 도전이 아직이면 월드런 챌린지 탭에서 시작할 수 있어요.': "Members run the same course at their own pace. If you haven't joined yet, you can start from the World Run tab.",
  '멤버 진행률 순위': 'Member progress ranking',
  '멤버 기여 순위': 'Member contribution ranking',
  '아직 도전한 멤버가 없어요': 'No members have joined yet',
  '아직 기여한 멤버가 없어요': 'No contributions yet',
  // ClubChallengeSection (클럽 마라톤)
  '클럽 마라톤': 'Club marathon',
  '멤버 이메일': 'Member emails',
  '코스 시작': 'Start course',
  '아직 클럽 도전이 없어요': 'No club challenges yet',
  '위 버튼으로 가상 코스를 시작해 멤버 km 를 합쳐보세요': 'Use the button above to start a virtual course and pool member km',
  '운영자가 곧 시작할 거예요': 'An admin will start one soon',
  '완주': 'Finished',
  '✨ 클럽 도전 시작됨': '✨ Club challenge started',
  '클럽 완주': 'Club finish',
  '인증서': 'Certificate',
  '축하해요!': 'Congrats!',
  '조회 실패': "Couldn't load",
  '📋 모든 이메일 복사됨': '📋 All emails copied',
  '멤버 없음': 'No members',
  '전체 복사': 'Copy all',
  '메일 작성': 'Compose email',
  '클럽 완주 인증서': 'Club Finisher Certificate',
  '완주일': 'Finished on',
  '클럽 도전 시작': 'Start a club challenge',
  '모든 클럽 멤버의 활동 km 가 자동으로 합산돼요': "Every member's activity km adds up automatically",
  '이미 모든 코스를 시작했어요': "You've already started every course",
  '시작': 'Start',
  '멤버 기여도': 'Member contributions',
  // ClubChallengesCard
  '클럽 챌린지': 'Club challenge',
  '일 남음': 'Days left',
  '목표 회수': 'Goal runs',
  '멤버 순위': 'Member ranking',
  '아직 활동 기록이 없어요': 'No activity recorded yet',
  // ClubExternalArchive (결산)
  '아직 결산 데이터가 없어요': 'No recap data yet',
  '관리자가 월별 HTML 결산을 import 하면': 'Once an admin imports the monthly recap,',
  '여기에서 회원별 기록을 확인할 수 있어요': "you'll see each member's records here",
  '총 거리': 'Total distance',
  '50km 통과': 'Passed 50km',
  '목표 달성': 'Goal reached',
  '쿠폰': 'Coupon',
  '기록이 없어요': 'No records',
  '이 달은 기록이 없어요': 'No records this month',
  // InviteQRCard
  'QR을 스캔해 클럽 가입하기': 'Scan the QR to join the club',
  '앱이 설치되어 있으면 바로 열립니다': 'Opens right away if the app is installed',
  '초대 QR 카드': 'Invite QR card',
  '공유 중...': 'Sharing...',
  '공유하기': 'Share',
  // ── build 291 i18n Phase B2: 소셜·포토·쪽지 ──
  // (객체 리터럴 조각 — EXTRAS_EN 에 머지용. i18n.ts 기존 키와 dedup 완료:
  //  취소/삭제/닫기/오늘/시간/뒤로/러너/신고/전체/전국/등록/실패/마일리지/이번 주/이번 달/
  //  취소 실패/삭제 실패/등록 실패/사진/뒤로가기/로그인이 필요해요/알 수 없는 오류/프로필 편집/
  //  최장 거리/최장 시간/최빠 페이스/완주/부적절한 콘텐츠/스팸\/광고/괴롭힘\/혐오/프로필 보기 → 는 이미 존재 → 제외)
  // /social 메인 탭
'친구 목록': 'Friends List',
'친구·팔로잉·팔로워': 'Friends · Following · Followers',
'친구 피드': 'Friend Feed',
'최근 친구 활동': 'Recent friend activity',
'친구와 추이 비교': 'Trends vs Friends',
  // /social/user 프로필
'이 사용자를 차단할까요?\n차단하면 이 사용자의 사진·댓글·쪽지가 더 이상 보이지 않아요.': "Block this user?\nTheir photos, comments, and messages will no longer be visible.",
'차단을 해제했어요': 'Unblocked',
'차단했어요. 이 사용자의 콘텐츠가 더 이상 보이지 않아요': 'Blocked. Their content is now hidden',
'처리 실패': 'Something went wrong',
'다시 시도해주세요': 'Please try again',
'친구 신청을 보냈어요': 'Friend request sent',
'친구 신청을 취소할까요?': 'Cancel this friend request?',
'신청을 취소했어요': 'Request cancelled',
'친구에서 해제할까요?': 'Remove this friend?',
'친구에서 해제했어요': 'Friend removed',
'알림 페이지에서 수락 또는 거절해주세요': 'Please accept or decline on the notifications page',
'이미 친구예요': "You're already friends",
'이미 신청을 보냈어요': 'Request already sent',
'존재하지 않는 사용자예요': "That user doesn't exist",
'권한이 없어요': 'No permission',
'잘못된 접근입니다': 'Invalid access',
'유저를 찾을 수 없어요': 'User not found',
'프로필': 'Profile',
'이달 km': 'km this month',
'이달 러닝': 'runs this month',
'통산 km': 'total km',
'응원 보내기': 'Send a cheer',
'매주 한 번씩 이모지로 응원해보세요': 'Cheer with an emoji once a week',
'내 정보 편집': 'Edit my profile',
'친구 신청': 'Add Friend',
'신청 보냄': 'Request Sent',
'신청 받음': 'Request Received',
'친구': 'Friends',
'쪽지를 시작할 수 없어요': "Couldn't start the chat",
'쪽지': 'Messages',
'차단 해제하기': 'Unblock',
'이 사용자 차단하기': 'Block this user',
'배지': 'Badges',
'최근 베스트': 'Recent Bests',
'최근 60일': 'Last 60 days',
'최근 30일 일별 거리': 'Daily distance — last 30 days',
'킬로미터 (합계)': 'kilometers (total)',
'킬로미터': 'kilometers',
'페이스': 'Pace',
'칼로리': 'Calories',
'GPS 경로 데이터가 없는 기록이에요': 'This run has no GPS route data',
'이번 주 · 이번 달': 'This Week · This Month',
'월드런 챌린지 도전': 'World Run Challenges',
'이달 랭킹': 'Monthly Ranking',
'이달 목표': 'Monthly Goal',
'지도 크게 보기': 'View full map',
'30일': '30d',
'활동 그래프': 'Activity Graph',
  // /social/friends
'신청을 취소할까요?': 'Cancel this request?',
'팔로잉': 'Following',
'팔로워': 'Followers',
'신청 중': 'Pending',
'신청 보냄 · 응답 대기 중': 'Request sent · awaiting response',
'취소 중': 'Cancelling',
  // 기존 tt() 호출인데 EXTRAS_EN 에 키가 없던 것들 (같은 파일)
'아직 양방향 친구가 없어요': 'No mutual friends yet',
'서로 친구로 등록한 사용자만 여기 보여요. 친구 신청을 보내거나 받아보세요.': 'Only mutual friends show up here. Send or accept a friend request!',
'한쪽 팔로잉이 없어요': 'No one-way following',
'내가 친구 추가했지만 상대는 아직 안 한 사용자': "People you added who haven't added you back yet",
'한쪽 팔로워가 없어요': 'No one-way followers',
'상대가 나를 추가했지만 나는 아직 안 한 사용자': "People who added you but you haven't added back yet",
'보낸 신청이 없어요': 'No sent requests',
'사용자 프로필에서 친구 신청을 보낼 수 있어요': "You can send friend requests from a user's profile",
'알 수 없음': 'Unknown',
  // /social/feed — 기존 tt() 호출 누락 키
'아직 친구 활동이 없어요': 'No friend activity yet',
'친구를 추가하면 그들의 러닝이 여기 표시돼요': "Add friends and their runs will show up here",
'친구 찾으러 가기 →': 'Go find friends →',
'자세히 보기': 'View details',
  // PhotoCard
'차단 실패': 'Block failed',
'이미 신고하신 사진이에요': "You've already reported this photo",
'신고 실패': 'Report failed',
'사진을 삭제했어요': 'Photo deleted',
'사진 크게 보기': 'View photo',
'좋아요': 'Like',
'댓글 보기': 'View comments',
'댓글 작성': 'Write a comment',
'사진을 삭제할까요?': 'Delete this photo?',
'삭제하면 다른 사람들에게도 즉시 안 보이며 복구할 수 없어요.': "It disappears for everyone immediately and can't be recovered.",
'삭제 중': 'Deleting',
'사진 신고': 'Report Photo',
'신고 사유를 선택해주세요. 검토 후 24시간 안에 조치합니다.': "Choose a reason. We'll review and act within 24 hours.",
'기타': 'Other',
  // PhotoCommentsSheet
'댓글': 'Comments',
'응원 한 마디가 큰 힘이 돼요': 'A word of cheer goes a long way',
'응원의 한 마디를 남겨보세요': 'Leave a word of cheer',
'로그인 후 댓글 작성': 'Log in to comment',
  // PhotoLightbox
'이전': 'Previous',
'다음': 'Next',
'좋아요 취소': 'Unlike',
'쪽지 보내기': 'Send message',
  // CheerButton
'응원 보냄!': 'Cheer sent!',
'이번 주 같은 이모지로 이미 보냈어요': 'Already sent this emoji this week',
'응원 실패 — 다시 시도해주세요': 'Cheer failed — please try again',
'응원 실패 — 네트워크 확인': 'Cheer failed — check your network',
'이번 주 이미 보냄': 'Already sent this week',
  // /messages + /messages/chat
'어제': 'Yesterday',
'아직 쪽지가 없어요': 'No messages yet',
'다른 러너의 프로필에서 쪽지를 보내보세요': "Say hi from another runner's profile",
'러너 찾기': 'Find Runners',
'대화를 시작하세요': 'Start the conversation',
'전송 실패. 네트워크 확인 후 다시 시도해주세요.': 'Send failed. Check your network and try again.',
'대화를 찾을 수 없습니다': 'Conversation not found',
'사용자 차단': 'Block user',
'첫 메시지를 보내보세요!': 'Send the first message!',
'메시지를 입력하세요': 'Type a message',
'보내기': 'Send',
  // /nearby 동네러너
'검색 실패': 'Search failed',
'친구 끊기': 'Unfriend',
'친구 추가됨': 'Friend added',
'친구 추가': 'Add friend',
'같은 읍·면·동': 'Same neighborhood',
'같은 시·군·구': 'Same district',
'같은 시·도': 'Same city/province',
'걸어서 만날 수 있는 거리': 'Within walking distance',
'같은 자치구·시·군': 'Same district or city',
'같은 광역시·도 (서울특별시·경기도 등)': 'Same metro area or province',
'우리 동네부터 설정해주세요': 'Set your neighborhood first',
'지역을 입력하면 같은 동·구·시의 러너를 찾을 수 있어요.': 'Add your region to find runners near you.',
'친구 추가하고 메시지로 함께 달리기 모임을 만들어 보세요.': 'Add friends and message them to set up a group run.',
'범위를 더 넓혀 보거나 친구를 초대해서 함께 달려보세요': 'Try a wider area, or invite a friend to run together',
'최근 비활성': 'Recently inactive',
'친선런 초대': 'Invite to Friendly Run',
'비슷한 페이스의 러너가 아직 없어요': 'No runners at a similar pace yet',
'최근 30일 페이스 데이터가 쌓이면 더 정확하게 추천돼요': 'Recommendations get better as your 30-day pace data builds up',
'비슷한 페이스의 러너': 'Runners at your pace',
'30일 평균 페이스가 ±20초 차이 안 러너입니다. 함께 달리면 페이스 유지에 도움돼요.': 'Runners within ±20s of your 30-day average pace. Running together helps you hold it.',
'페이스 그룹 둘러보기': 'Browse Pace Groups',
'6단계 페이스대 가상 클럽 — 같은 속도의 친구들': '6 pace-tier virtual clubs — friends at your speed',
'지역 미설정': 'No region set',
  // ── build 291 i18n Phase C: 습관 코어 ──
  // EXTRAS_EN 머지용 조각. 파일별 섹션 주석으로 구분.
  // ---- world/MilestoneBoard.tsx ----
'마일스톤 보드': 'Milestone Board',
'남음': 'to go',
  // ---- world/MilestoneDialog.tsx + lib/world-milestones.ts 고정 라벨 (render-site tt) ----
'#월드런챌린지 #루티니스트': '#WorldRunChallenge #Routinist',
'엽서 공유': 'Share postcard',
'엽서 공유하기': 'Share Postcard',
'이 코스는 GPS 좌표가 등록되지 않아 거리뷰를 표시할 수 없어요.': 'This course has no GPS coordinates registered, so Street View is unavailable.',
'출발': 'Start',
'하프': 'Half',
'하프 마라톤': 'Half Marathon',
'풀 마라톤 완주!': 'Full Marathon Finished!',
  // ---- world/CourseCompletionModal.tsx ----
'월드런 챌린지 완주': 'World Run Challenge Complete',
'km 완주': 'km completed',
'축하해요! 메달을 손에 넣었어요': 'Congrats! You earned a medal',
'완주 환급 보상': 'Finisher refund reward',
'참가비의 50%': '50% of the entry fee',
'이미 적립됐어요': 'already credited',
'메달 공유하기': 'Share Medal',
  // ---- profile/AchievementsCard.tsx (achievements-data 배지 이름/설명, 데이터 구조 불변) ----
'달성한 배지': 'Badges Earned',
'첫 발걸음': 'First Steps',
'첫 활동': 'First activity',
'10번 달림': '10 Runs',
'10회 달리기 누적': '10 runs total',
'100런 클럽': '100 Run Club',
'100회 달리기 누적': '100 runs total',
'500 러너': '500 Runner',
'500회 달리기 누적': '500 runs total',
'센추리': 'Century',
'누적 100km': '100 km total',
'500km 러너': '500 km Runner',
'누적 500km': '500 km total',
'밀레니엄': 'Millennium',
'누적 1,000km': '1,000 km total',
'레전드': 'Legend',
'누적 5,000km': '5,000 km total',
'월드런 챌린지 첫 완주': 'First World Run Finish',
'월드런 챌린지 첫 코스 완주': 'First World Run course finished',
'3 코스 완주': '3 Courses Done',
'월드런 챌린지 3개 완주': '3 World Run courses finished',
'10 코스 마스터': '10 Course Master',
'월드런 챌린지 10개 완주': '10 World Run courses finished',
'World Marathon Majors 6개 완주': 'All 6 World Marathon Majors finished',
  // ---- goals/page.tsx ----
'목표 거리 (km)': 'Goal distance (km)',
'직접 입력': 'Enter manually',
'저장됨!': 'Saved!',
'목표 저장': 'Save Goal',
  // ---- mileage/page.tsx + lib/mileage-data.ts txTypeLabel (ttl) ----
'마일리지 가이드': 'Mileage Guide',
'1km = 1P 기본 (어제도 달리면 ×2)': '1 km = 1P base (×2 if you also ran yesterday)',
'선물하기': 'Send Gift',
'클럽 후원': 'Support Club',
'러닝': 'Running',
'보상': 'Reward',
'아직 거래 내역이 없어요': 'No transactions yet',
'달리기로 마일리지를 모아보세요!': 'Earn mileage by running!',
'— 끝 —': '— End —',
'러닝 적립': 'Running earn',
'구매 사용': 'Purchase spend',
'선물 보냄': 'Gift sent',
'선물 받음': 'Gift received',
'관리자 조정': 'Admin adjustment',
'환불': 'Refund',
  // ---- mileage/help/page.tsx ----
'달릴수록 쌓여요 🌱': 'The more you run, the more you earn 🌱',
'루티니스트의 마일리지는 달린 거리 + 연속 일수 + 최초 달성에서 자동으로 모입니다. 모은 포인트는 친구에게 선물하거나 클럽 후원에 써요.': 'Routinist mileage builds up automatically from distance run + streak days + first-time milestones. Spend your points on gifts for friends or supporting your club.',
'어떻게 모이나요?': 'How do I earn?',
'어디에 쓰나요?': 'Where can I spend?',
'러닝 기본 적립': 'Base running earn',
'GPS·Apple Health 어디서든 1km 달릴 때마다 1포인트가 자동으로 쌓여요.': 'Every 1 km you run — via GPS or Apple Health — earns 1 point automatically.',
'어제도 달렸어요 보너스': 'Ran-yesterday bonus',
'×2 배수': '×2 multiplier',
'어제 0.5km 이상 달렸으면 오늘은 1km = 2P. 이틀 연속이 시작이에요!': 'If you ran 0.5 km+ yesterday, today 1 km = 2P. Two days in a row is where it starts!',
'연속 일수 보너스': 'Streak bonus',
'7일 연속 7P 보너스, 30일 연속 30P 보너스가 추가로 들어와요.': 'Get an extra 7P for a 7-day streak and 30P for a 30-day streak.',
'최초 거리 달성 보너스': 'First-distance bonus',
'첫 5km (+5P), 첫 10km (+10P), 첫 하프 (+25P), 첫 마라톤 풀코스 (+50P).': 'First 5 km (+5P), first 10 km (+10P), first half (+25P), first full marathon (+50P).',
'쇼핑 결제': 'Shop checkout',
'1P = 1원': '1P = 1 KRW',
'쇼핑 탭에서 상품 결제할 때 마일리지로 쓸 수 있어요. 일부 또는 전액 사용 가능.': 'Use mileage when paying in the Shop tab. Cover part or all of the price.',
'친구에게 선물': 'Gift to a friend',
'최소 10P부터': 'From 10P',
'내 마일리지를 친구에게 보내요. 받는 사람한테 알림이 가요.': 'Send your mileage to a friend. They get a notification.',
'소속 클럽에게': 'To your club',
'내가 가입한 클럽의 공동 적립금으로 보내요. 이벤트·상품권에 쓰여요.': 'Send points to your club fund. Used for events and gift cards.',
'Q. 적립이 안 보여요': 'Q. I don\'t see my points',
'러닝 저장 직후 자동 적립되지만, Apple Health 동기화는 잠시 시간이 걸릴 수 있어요. 홈에서 새로고침 한 번이면 보통 반영돼요.': 'Points are added right after a run is saved, but Apple Health sync can take a moment. A quick refresh on Home usually does it.',
'Q. 같은 러닝이 2번 잡혔어요': 'Q. The same run was counted twice',
'Routinist GPS 와 Apple Health 양쪽에서 같은 워크아웃이 들어오면 자동으로 1건만 인정해요. 혹시 중복이 보이면 내 정보 → 진단에서 알려주세요.': 'If the same workout comes in from both Routinist GPS and Apple Health, only one is counted automatically. If you spot a duplicate, let us know via Profile → Diagnostics.',
'Q. 마일리지에 유효기간이 있나요?': 'Q. Does mileage expire?',
'현재 만료 없이 누적돼요. 정책이 바뀌면 사전에 알려드릴게요.': 'Currently it never expires. We\'ll let you know in advance if the policy changes.',
'세부 배수·보너스 규칙은 운영 상황에 따라 조정될 수 있어요. 최신 정책은 이 페이지에 항상 반영돼요.': 'Multiplier and bonus rules may be adjusted over time. This page always reflects the latest policy.',
'내 마일리지 보기': 'View My Mileage',
  // ---- coach/page.tsx ----
'러닝 코치': 'Running Coach',
'체중은 20~250kg 사이로 입력해주세요': 'Weight must be between 20 and 250 kg',
'최대 심박수는 100~230 사이로 입력해주세요': 'Max heart rate must be between 100 and 230',
'저장되었어요': 'Saved',
'장기 피트니스': 'Fitness',
'최근 부하': 'Recent Load',
'컨디션': 'Form',
'아직 분석할 활동이 부족해요. 2~3km 가볍게 달려보세요.': 'Not enough activity to analyze yet. Try an easy 2-3 km run.',
'최근 14일 부하 흐름': 'Last 14 Days Load Trend',
'장기 피트니스 (꾸준함)': 'Fitness (consistency)',
'최근 부하 (피로)': 'Recent load (fatigue)',
'코칭은 어떻게 계산되나요?': 'How is coaching calculated?',
'거리 · 시간 기반으로 매일 부하 점수를 매기고, 장기 평균(42일)과 단기 평균(7일)의 차이로 오늘 컨디션을 산출해요. 체중·최대 심박수 입력 시 더 정확해져요.': 'We score your daily load from distance and time, then compare the long-term average (42 days) with the short-term average (7 days) to estimate today\'s form. Adding weight and max HR makes it more accurate.',
'코치 설정': 'Coach Settings',
'본인에게만 보여요. 랭킹·비교에 사용되지 않습니다.': 'Visible only to you. Never used for rankings or comparisons.',
'체중 (kg) — 칼로리 정확도': 'Weight (kg) — calorie accuracy',
'예: 65': 'e.g. 65',
'최대 심박수 — HR Zones 분석용 (220 - 나이 가능)': 'Max heart rate — for HR Zones (220 - age works)',
'예: 185': 'e.g. 185',
  // ---- history/page.tsx (+ lib/stats-data.ts 명예의 전당 라벨, render-site tt) ----
'이달 거리': 'This Month',
'회': 'runs',
'클럽 총 러닝': 'Club Total Runs',
'이달 시간': 'Time This Month',
'운동 시간': 'Workout time',
'러닝 일수': 'Run Days',
'명': 'ppl',
'일': 'days',
'데이터 없음': 'No data',
'피니셔율': 'Finisher rate',
'러닝 캘린더': 'Run Calendar',
'영광의 롱러너': 'Long Runner Glory',
'월간 최장 거리 달성': 'Longest single run this month',
'영광의 피니셔': 'Finisher Glory',
'월 목표 달성 횟수': 'Monthly goals achieved',
'영광의 개근상': 'Perfect Attendance',
'월간 러닝 횟수 1위': 'Most runs this month',
'이 달의 기록이 없습니다.': 'No records this month.',
  // ---- calendar/page.tsx ----
'사진 업로드 중...': 'Uploading photo...',
'사진 추가': 'Add photo',
'이달의 러닝': 'Runs This Month',
'이 날은 러닝 기록이 없습니다': 'No run recorded on this day',
'공유 카드': 'Share Card',
'사진 변경': 'Change Photo',
'사진 넣기': 'Add Photo',
'사진을 어떻게 사용할까요?': 'How should we use this photo?',
'원하는 옵션을 선택하세요': 'Pick the options you want',
'📅 내 캘린더 배경에 반영': '📅 Use as my calendar background',
'이 날짜 셀의 배경으로 표시됩니다': 'Shown as the background of this date cell',
'📸 러닝사진에 등록하기': '📸 Post to Run Photos',
'다른 러너들과 공유되고 좋아요 받을 수 있어요': 'Shared with other runners — you can get likes',
'러닝 기록이 있는 날만 공유할 수 있어요': 'You can only share on days with a run',
'적용 중...': 'Applying...',
  // ---- pace-groups/page.tsx ----
'페이스 그룹': 'Pace Groups',
'내 페이스대 러너 모임': 'Runners at your pace',
'6단계 페이스 그룹 중 하나에 가입해 비슷한 속도의 러너들과 친해지세요.': 'Join one of six pace groups and get to know runners at a similar speed.',
'30일 평균 페이스 기반으로 추천 그룹이 표시돼요.': 'Your recommended group is based on your 30-day average pace.',
'내 페이스': 'My pace',
'가입': 'Join',
'한 사용자 = 한 그룹. 다른 그룹에 가입하면 이전 그룹은 자동 탈퇴됩니다.': 'One runner = one group. Joining another group automatically leaves your current one.',
'아직 멤버가 없어요. 첫 멤버가 되어보세요.': 'No members yet. Be the first!',
'✨ 그룹 친선런 생성됨': '✨ Group friendly run created',
'생성 실패': 'Failed to create',
'그룹 친선런': 'Group Friendly Run',
'만남 장소 (선택)': 'Meetup spot (optional)',
'예) 한강 잠실대교 북단': 'e.g. Riverside park, north gate',
'공개 모집판에도 노출됩니다.': 'Also listed on the public board.',
'만드는 중…': 'Creating…',
'그룹 친선런 만들기': 'Create Group Friendly Run',
  // ---- map/page.tsx ----
'1일': '1d',
'3일': '3d',
'7일': '7d',
'🇰🇷 한국': '🇰🇷 Korea',
'🇯🇵 일본': '🇯🇵 Japan',
'🇨🇳 중국': '🇨🇳 China',
'🇺🇸 미국': '🇺🇸 USA',
'🇪🇺 유럽': '🇪🇺 Europe',
'🌏 동남아': '🌏 SE Asia',
'🇦🇺 호주': '🇦🇺 Australia',
'🌍 그 외': '🌍 Other',
'GPS 경로 가져오는 중...': 'Fetching GPS routes...',
'Apple Watch 러닝이 없어요': 'No Apple Watch runs found',
'지도': 'Map',
'동네 러너 코스 보기': 'See local runners\' routes',
'같은 동네 러너들의 폴리라인을 색별로': 'Neighborhood runners\' routes, color-coded',
'덧칠 횟수': 'Times run',
'GPS 기록': 'GPS runs',
'Google Maps API 키를 설정하면 지도가 표시됩니다': 'Set a Google Maps API key to show the map',
'상세 보기': 'View details',
'아직 GPS 러닝 기록이 없습니다': 'No GPS runs yet',
'Apple Health만 연동하면 거리·시간은 보이지만 GPS 경로는 포함되지 않아요.': 'Apple Health alone syncs distance and time, but not GPS routes.',
'아래 앱에서 달리면 자동으로 이 지도에 경로가 쌓입니다.': 'Run with the apps below and your routes will show up here automatically.',
'Apple Health 연동하기': 'Connect Apple Health',
'런데이': 'RunDay',
  // ---- contest/ContestTab.tsx + lib/contest-data.ts (ttl: 거리/시간/페이스) ----
'✨ 참가 신청됨': '✨ Request sent',
'참가 실패': 'Failed to join',
'모집판': 'Open Board',
'내 동네': 'My area',
'모집': 'hosting',
'참가 완료': 'Joined',
'신청 중…': 'Requesting…',
'참가 신청': 'Request to Join',
'내 친선런': 'My Friendly Runs',
'아직 참여한 친선런이 없어요': 'No friendly runs yet',
'친구와 짧은 친선전을 만들어 보세요': 'Set up a quick friendly run with friends',
'첫 친선런 만들기': 'Create First Friendly Run',
'호스트': 'Host',
'결과 제출 필요': 'Result needed',
'나': 'Me',
'✨ 친선런이 만들어졌어요': '✨ Friendly run created',
'모집중': 'Open',
'마감': 'Closed',
'친선런 만들기': 'Create Friendly Run',
'제목이 너무 짧아요 (2자 이상)': 'Title is too short (2+ characters)',
'예) 토요일 한강 모임': 'e.g. Saturday river run',
'종목': 'Event',
'거리 (멀리)': 'Distance (farthest)',
'시간 (오래)': 'Duration (longest)',
'페이스 (빠르게)': 'Pace (fastest)',
'공개 모집판 (같은 동네 누구나)': 'Public board (anyone nearby)',
'친구 초대만': 'Invite only',
'내 동네 러너들이 모집판에서 보고 참가 신청해요.': 'Local runners can find it on the board and request to join.',
'선택한 친구들만 참가할 수 있어요.': 'Only the friends you pick can join.',
'시간 (선택)': 'Time (optional)',
'정원 (선택)': 'Capacity (optional)',
'제한 없음': 'No limit',
'미리 초대 (선택)': 'Pre-invite (optional)',
'아직 친구가 없어요. 일단 나 혼자 시작할 수 있어요.': 'No friends yet — you can start solo.',
'선택됨': 'Selected',
'✨ 사진이 친선런에 연결됐어요': '✨ Photo attached to the run',
'연결 실패': 'Failed to attach',
'✨ 결과 제출됨': '✨ Result submitted',
'제출 실패': 'Failed to submit',
'친선런을 마감할까요? 이후 결과 변경 불가.': 'Close this friendly run? Results can\'t change afterwards.',
'친선런을 마감했어요': 'Friendly run closed',
'마감 실패': 'Failed to close',
'친선런': 'Friendly Run',
'공개': 'Public',
'채팅': 'Chat',
'해당 날짜 활동이 없어요. 달리고 다시 와주세요.': 'No activity on that date. Go run and come back!',
'이걸로 제출': 'Submit this',
'함께한 사진': 'Photos together',
'연결 중…': 'Attaching…',
'아직 등록된 사진이 없어요': 'No photos yet',
'친선런 마감 (호스트)': 'Close Friendly Run (host)',
  // ---- world/WorldTab.tsx (기존 tt 키 중 EXTRAS_EN 누락분 + 신규 wrap) ----
'🔍 확인': '🔍 Check',
'✅ 완주': '✅ Finished',
'왜 달리고 있나요?': 'Why are you running?',
'선택': 'optional',
'예: 60세 생일 기념으로 / 살을 빼기 위해 / 친구와의 약속': 'e.g. For my 60th birthday / to lose weight / a promise to a friend',
'완주 시 이 문장을 다시 보여드릴게요': 'We\'ll show you this again when you finish',
  // ---- world/CourseDetailSheet.tsx ----
'코스를 찾을 수 없어요': 'Course not found',
'러': 'R',
'내 진행': 'My Progress',
'시작했을 때 마음': 'Why you started',
'왜 달리고 있나요': 'Why are you running',
'해냈어요. 그 마음을 끝까지 지켰네요 🌟': 'You did it. You kept that promise to the end 🌟',
'같은 코스 도전 중': 'On this course',
'아직 도전 중인 사람이 없어요. 첫 번째가 되어보세요.': 'No one is on this course yet. Be the first!',
'대회 소개': 'About the Race',
'코스 이야기': 'Course Story',
'공식 사이트': 'Official site',
'대회 영상 보기': 'Watch race video',
'YouTube 에서 코스 미리보기': 'Preview the course on YouTube',
'고도 프로파일': 'Elevation Profile',
'코스 주요 지점': 'Course Landmarks',
'역대 우승자': 'Past Winners',
'코스 기록:': 'Course record:',
'🎉 완주 축하해요!': '🎉 Congrats on finishing!',
'디지털 인증서를 다운받거나 실물 메달을 신청하세요': 'Download your digital certificate or order a physical medal',
'신청 완료': 'Requested',
'메달 신청': 'Order Medal',
'상태:': 'Status:',
'✨ 메달 신청이 접수됐어요': '✨ Medal request received',
'지도 API 키 없음': 'No map API key',
'지도 로드 실패': 'Map failed to load',
'피니시': 'Finish',
'도착': 'Finish',
'다른 참가자': 'Other runners',
'완주자': 'Finishers',
'최고': 'Max',
'미신청': 'Not requested',
'접수됨 (결제 대기)': 'Received (awaiting payment)',
'결제 완료 (포장 중)': 'Paid (packing)',
'발송됨': 'Shipped',
'배송 완료': 'Delivered',
'취소됨': 'Cancelled',
'받는분 / 연락처 / 주소 모두 입력해주세요': 'Please fill in recipient, phone, and address',
'신청 실패': 'Request failed',
'배송비 포함. 신청 접수 후 결제 안내 메시지를 보내드려요. 결제 확인 후 1~2주 내 발송.': 'Shipping included. After your request we\'ll send payment instructions. Ships 1–2 weeks after payment.',
'받는 분': 'Recipient',
'이름': 'Name',
'우편번호': 'Zip code',
'주소': 'Address',
'도로명 + 상세주소': 'Street address + details',
'접수 중…': 'Submitting…',
'신청하기': 'Submit Request',
'완주 인증서': 'Finisher Certificate',
'님은 다음 가상 코스를 완주하였습니다.': 'has completed the following virtual course.',
'완주일:': 'Completed on:',
'인증서 저장 또는 공유': 'Save or share certificate',
  // ── build 291 i18n Phase D: 공유카드·토스트·홈 ──
  // EXTRAS_EN 머지용 조각. tt()/ttl() 은 키 없으면 ko fallback 이라 머지 전에도 안전.
  // ShareCard — 테마 이름 (canvas 아래 선택 버튼)
  '새벽': 'Dawn',
  '노을': 'Sunset',
  '숲': 'Forest',
  '하양': 'White',
  '밤': 'Night',
  // ShareCard — canvas stats 라벨
  '월 누적': 'Month total',
  // ShareCard — 버튼/토스트/공유 시트
  '영상이 50MB 보다 커요': 'Video is larger than 50MB',
  '영상 로드 실패': 'Failed to load video',
  '공유 실패': 'Share failed',
  '러닝 기록 공유': 'Share your run',
  '이미지 변환 실패': 'Image conversion failed',
  '✨ 공유됨!': '✨ Shared!',
  '✨ 캘린더에 저장됐어요': '✨ Saved to calendar',
  '한 줄 메시지를 입력해보세요': 'Write a one-line message',
  '입력 지우기': 'Clear input',
  '다른 명언': 'Another quote',
  '러너 한 줄에도 저장 (소셜 탭에서 보임)': "Also save to Runner's Lines (shown in Social tab)",
  '배경 사진': 'Add photo',
  '배경 사진 제거': 'Remove background photo',
  '영상': 'Video',
  '영상 배경': 'Add video',
  '영상 제거': 'Remove video',
  '동영상': 'Video',
  '이미지': 'Image',
  '러닝사진에 등록': 'Add to running photos',
  '동영상 만드는 중...': 'Creating video...',
  '공유': 'Share',
  '공유됨!': 'Shared!',
  // health-sync — 사용자 노출 토스트/진행 라벨
  'iOS가 아닙니다': 'Not an iOS device',
  '이 기기에서 Apple Health를 사용할 수 없습니다.': 'Apple Health is not available on this device.',
  '설정 > 개인정보 보호 > 건강 > Routinist 에서 권한을 허용해주세요.': 'Please allow access in Settings > Privacy > Health > Routinist.',
  'Apple Health 연결 완료! 러닝 기록을 가져오는 중...': 'Apple Health connected! Importing your runs...',
  '권한 확인 중...': 'Checking permissions...',
  'Apple Health 러닝 기록 조회 중...': 'Fetching runs from Apple Health...',
  '중복 검사 중...': 'Checking for duplicates...',
  '저장 중': 'Saving',
  '새 기록 없음': 'No new records',
  '최신 상태예요. 오늘도 가볍게 한 바퀴? 👟': "You're all caught up. How about an easy run today? 👟",
  '동기화 결과 확인이 안 됐어요\n잠시 후 다시 시도해주세요': "Couldn't confirm the sync result\nPlease try again in a moment",
  '동기화 중에 문제가 생겼어요': 'Something went wrong while syncing',
  'Apple Health 에 러닝 기록이 아직 없어요 👟': 'No runs in Apple Health yet 👟',
  '거리 합산 중에 문제가 생겼어요': 'Something went wrong while adding up distance',
  '건강 데이터 동기화는 Routinist 앱에서만 사용할 수 있습니다.': 'Health data sync is only available in the Routinist app.',
  '지원하지 않는 플랫폼입니다.': 'Unsupported platform.',
  'GPS 경로 백그라운드 동기화...': 'Syncing GPS routes in background...',
  '동기화가 너무 오래 걸리네요\n잠시 후 다시 시도해주세요': 'Sync is taking too long\nPlease try again in a moment',
  // dashboard — PullToRefresh 토스트
  '아직 새로운 기록은 없어요. 한 바퀴 돌아볼까요? 👟': 'No new records yet. How about a quick loop? 👟',
  // home 컴포넌트 잔여
  '진행 중': 'In progress',
  '30초 초과': 'Timed out after 30s',
  '안내 닫기': 'Dismiss hint',
  // EXTRAS_EN 머지용 조각 — build 290 마일/임페리얼 단위 지원 (할일 #22).
  // 사용처: src/components/profile/UnitToggle.tsx
  // tt()/ttl() 은 키 없으면 ko fallback 이라 머지 전에도 안전.
  // ---- profile/UnitToggle.tsx ----
  '거리 단위': 'Distance unit',
  '킬로미터 또는 마일로 표시해요': 'Show distances in kilometers or miles',
  // EXTRAS_EN 머지용 조각 — P2 클라이언트 3건 (build 291).
  // dedup 확인 완료: '알 수 없음', '차단을 해제했어요' 는 i18n.ts 에 이미 존재 → 제외.
  // tt() 는 키 없으면 ko fallback 이라 머지 전에도 앱은 안전.
  // ---- profile/blocked/page.tsx (신규 — 차단 사용자 관리) ----
'차단한 사용자': 'Blocked users',
'차단한 사용자의 사진·댓글·쪽지가 보이지 않아요. 언제든 다시 해제할 수 있어요.': "You won't see photos, comments, or messages from blocked users. You can unblock anytime.",
'차단한 사용자가 없어요': 'No blocked users',
'모두와 기분 좋게 달리고 있다는 뜻이에요 🏃': "That means you're running happily with everyone 🏃",
'목록을 불러오지 못했어요': "Couldn't load the list",
'차단 해제': 'Unblock',
'해제 중…': 'Unblocking…',
'차단 해제 실패': 'Failed to unblock',
  // ---- profile/push-settings/page.tsx (신규 토글 라벨) ----
'친구 신기록': 'Friend PB',
'월드런 진행': 'World run progress',
'월드런 완주': 'World run finish',
'월드런 추격': 'World run chase',
'클럽 마라톤 시작': 'Club marathon start',
'클럽 마라톤 완주': 'Club marathon finish',
'러닝 리마인더': 'Running reminder',
'월말 결산': 'Month-end recap',
  // build 292 Phase 1 — /track 네이티브 RunSession 전환 신규 사용자 노출 문자열.
  // EXTRAS_EN 머지용 조각 (src/lib/i18n.ts 의 EXTRAS_EN 객체에 그대로 붙여넣기).
  // tt() 는 키 없으면 ko fallback 이라 머지 전에도 안전.
  //
  // 사용처: src/app/(app)/track/page.tsx
  //   - 개발자 게이트 배너 (devMode)
  //   - GPS 신호 배지 (native 'update' 이벤트 gpsSignal)
  // ---- track/page.tsx (build 292 dev 게이트 배너) ----
  '개발자 테스트 모드': 'Developer test mode',
  '네이티브 엔진': 'Native engine',
  '레거시 엔진': 'Legacy engine',
  // ---- track/page.tsx (build 292 GPS 신호 배지) ----
  'GPS 좋음': 'GPS good',
  'GPS 약함': 'GPS weak',
  'GPS 끊김': 'GPS lost',
  // EXTRAS_EN 머지용 조각 — build 292 성장 루프 ① (공유카드 QR 유입 경로).
  // src/lib/i18n.ts 의 EXTRAS_EN 객체에 그대로 붙여넣기. 기존 키와 중복 없음 확인 완료.
  'QR 링크 (카드에 앱 링크 QR 표시)': 'QR link (show app link QR on card)',
  // EXTRAS_EN 머지용 조각 — build 292 친구 초대 (referral) 성장 루프.
  // 사용처: src/lib/referral-data.ts (ttl) / src/components/profile/InviteFriendCard.tsx (tt)
  //        / src/components/home/HomeOnboardingCard.tsx InlineInviteCodeForm (tt)
  // tt()/ttl() 은 키 없으면 ko fallback 이라 머지 전에도 안전.
  // 기존 EXTRAS_EN 과 dedup 완료: '등록 중…', '공유' 는 이미 있음 (추가 불필요).
  // ---- lib/referral-data.ts (claim reason / 성공 토스트 — ttl) ----
  '내 코드는 입력할 수 없어요 😅': "You can't use your own code 😅",
  '이미 초대 코드를 등록했어요': "You've already registered an invite code",
  '초대 코드는 가입 직후에만 입력할 수 있어요': 'Invite codes can only be entered shortly after signing up',
  '코드를 찾지 못했어요. 다시 확인해주세요': "We couldn't find that code. Please double-check it",
  '100P 적립! 🎉 친구와 함께 달려봐요': '+100P earned! 🎉 Run together with your friend',
  // ---- components/profile/InviteFriendCard.tsx ----
  '친구 초대': 'Invite a friend',
  '복사': 'Copy',
  '복사했어요!': 'Copied!',
  // ---- components/home/HomeOnboardingCard.tsx (InlineInviteCodeForm) ----
  '코드 등록하기': 'Register code',
  // EXTRAS_EN 머지용 조각 — 습관 형성 UI (주간 횟수 목표 + 스트릭 보호권 + 배지 축하).
  // src/lib/i18n.ts 의 EXTRAS_EN 객체에 그대로 붙여넣기.
  // 기존 키와 dedup 완료: '닫기' 는 이미 있음 (추가 불필요). 아래 키는 전부 신규.
  // tt()/ttl() 은 키 없으면 ko fallback 이라 머지 전에도 안전.
  // ---- goals/page.tsx (주간 러닝 횟수 목표) ----
  '주간 러닝 횟수': 'Runs per week',
  '거리보다 꾸준함! 일주일에 몇 번 달릴지 정해보세요': 'Consistency beats distance! Pick how many runs a week',
  '추천': 'Best',
  '주간 횟수 목표를 해제했어요': 'Weekly run goal cleared',
  '저장하지 못했어요. 잠시 후 다시 시도해주세요': "Couldn't save — please try again in a moment",
  '처음이라면 주 3회부터 — 습관이 되는 가장 부담 없는 횟수예요': 'New to running? Start with 3 a week — the easiest way to build the habit',
  // ---- home/HomeChallengeCard.tsx (요일 도트 줄) ----
  '주 몇 번 달릴까요? 횟수 목표 정하기': 'How many runs a week? Set a goal',
  // ---- home/StreakWarningCard.tsx (스트릭 보호권) ----
  '보호권 쓰기': 'Use freeze',
  '사용 중...': 'Using...',
  '어제는 이미 지켜져 있어요': 'Yesterday is already covered',
  '남은 보호권이 없어요': 'No streak freezes left',
  '지금은 보호권을 쓸 수 없어요. 잠시 후 다시 시도해주세요': "Can't use a freeze right now — please try again shortly",
  // ---- home/BadgeCelebration.tsx (배지 획득 축하 모달) ----
  '새 배지 획득!': 'New badge unlocked!',
  '내 배지 자랑하러 가기': 'Show off my badges',
  // ---- lib/achievements-data.ts (신규 배지 5종 이름/설명 — AchievementsCard 가 tt() 로 렌더) ----
  '첫 주 3회': 'First 3-run week',
  '한 주에 3번 달리기 달성': 'Ran 3 times in a single week',
  '첫 5K': 'First 5K',
  '한 번에 5km 달리기': 'Ran 5km in one go',
  '3일 연속': '3-day streak',
  '3일 연속 달리기': 'Ran 3 days in a row',
  '첫 인증샷': 'First photo',
  '첫 러닝 사진 올리기': 'Uploaded your first running photo',
  '첫 응원': 'First cheer',
  '친구에게 첫 응원 보내기': 'Sent your first cheer to a friend',
  // EXTRAS_EN 머지용 조각 — build 293 콜드스타트·글로벌 안착.
  // 사용처: src/lib/nearby-data.ts (SCOPE_LABEL/DESC — page 에서 tt 경유)
  //        / src/app/(app)/nearby/page.tsx (초대·글로벌 fallback)
  //        / src/components/home/HomeOnboardingCard.tsx (추천 팔로우 줄)
  //        / src/app/(app)/activity/page.tsx (게스트 read-only CTA)
  // tt()/ttl() 은 키 없으면 ko fallback 이라 머지 전에도 안전.
  // 기존 EXTRAS_EN 과 dedup 완료: '지역 미설정'(2010행), '초대 링크'(1698행) 는 이미 있음.
  // 주의: SCOPE_LABEL national 라벨이 '전국'(기존 키 'All Korea') → '전 세계' 로 변경됨 —
  //       기존 '전국' 키는 다른 화면에서 쓰일 수 있어 제거하지 말 것.
  // ---- lib/nearby-data.ts (SCOPE_LABEL / SCOPE_DESC — nearby page tt) ----
  '같은 나라': 'Same country',
  '전 세계': 'Worldwide',
  '같은 나라에서 달리는 러너': 'Runners in your country',
  '전 세계 러너 모두': 'Every runner worldwide',
  // ---- app/(app)/nearby/page.tsx ----
  '친구 초대하기': 'Invite friends',
  '초대 링크를 복사했어요': 'Invite link copied',
  '전 세계 러너': 'Runners around the world',
  '이번 주에 달린 전 세계 러너들이에요. 먼저 친구를 걸어보세요!': 'These runners were out this week. Say hi and add them first!',
  // ---- components/home/HomeOnboardingCard.tsx (추천 팔로우) ----
  '요즘 달리고 있는 러너들이에요': 'Runners on a roll lately',
  '팔로우': 'Follow',
  '추가됨': 'Added',
  // ---- app/(app)/activity/page.tsx (게스트 read-only) ----
  '지금은 볼 수 없는 기록이에요': "This run isn't available right now",
  '비공개이거나 삭제된 기록일 수 있어요': 'It may be private or deleted',
  'Routinist 시작하기': 'Get started with Routinist',
  '이 러너의 기록이 마음에 드나요?': "Enjoying this runner's story?",
  '가입하면 응원과 댓글을 남길 수 있어요': 'Join to leave cheers and comments',
  // ── build 297: 진행 중 러닝 배너 ──
  '진행 중인 러닝으로 돌아가기': 'Return to your run in progress',
  '일시정지 중': 'Paused',
  '회 러닝': ' runs',
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
