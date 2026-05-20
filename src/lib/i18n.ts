'use client';

// 가벼운 자체 i18n. 페이지 대부분이 한국어로 하드코딩되어 있어 점진적 이관을 위한 기반만 제공.
// 언어 결정 우선순위: (1) 유저 설정(localStorage) → (2) navigator.language → (3) 기본 'ko'.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, createElement } from 'react';

export type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'es';

export const SUPPORTED_LOCALES: { code: Locale; native: string }[] = [
  { code: 'ko', native: '한국어' },
  { code: 'en', native: 'English' },
  { code: 'ja', native: '日本語' },
  { code: 'zh', native: '中文' },
  { code: 'es', native: 'Español' },
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
  | 'profile.themeTitle'
  | 'profile.themeLight'
  | 'profile.themeDark'
  | 'profile.themeSystem'
  | 'profile.signOut'
  | 'profile.totalSummary'
  | 'settings.language'
  // build 157: 핵심 화면 영어 확장
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
  | 'world.participantsHeader';

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
    'profile.themeTitle': '화면 모드',
    'profile.themeLight': '라이트',
    'profile.themeDark': '다크',
    'profile.themeSystem': '시스템',
    'profile.signOut': '로그아웃',
    'profile.totalSummary': '통산 {km}km · {runs}회 러닝',
    'settings.language': '언어',
    'home.todayKm': '오늘 km',
    'home.todayPace': '오늘 페이스',
    'home.recentPace': '최근 페이스',
    'home.monthKm': '이달 km',
    'home.monthDays': '이달 일수',
    'home.monthGoal': '내 {month}월 목표',
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
    'profile.themeTitle': 'Theme',
    'profile.themeLight': 'Light',
    'profile.themeDark': 'Dark',
    'profile.themeSystem': 'System',
    'profile.signOut': 'Sign out',
    'profile.totalSummary': 'Total {km}km · {runs} runs',
    'settings.language': 'Language',
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
  },
  ja: {
    'common.loading': '読み込み中...',
    'common.save': '保存',
    'common.cancel': 'キャンセル',
    'common.retry': '再試行',
    'common.back': '戻る',
    'nav.home': 'ホーム',
    'nav.map': 'マップ',
    'nav.ranking': 'ランキング',
    'nav.social': 'ソーシャル',
    'nav.shop': 'ショップ',
    'nav.profile': 'プロフィール',
    'home.matchedRank.cta': 'ランキングを見る',
    'home.matchedRank.ctaSub': '地域・年齢・性別を入力すると似たランナーとの順位が表示されます',
    'home.todayTop': '本日のTOP',
    'home.friendsWeek': '今週の友達比較',
    'home.gallery': 'Routinist ギャラリー',
    'home.gallery.empty': 'ランニング写真を共有するとここに表示されます',
    'profile.editTitle': 'プロフィール編集',
    'profile.nickname': 'ニックネーム',
    'profile.region': '地域',
    'profile.detectRegion': '現在地から自動選択',
    'profile.detecting': '検出中...',
    'profile.birthYear': '生年',
    'profile.gender': '性別',
    'profile.male': '男性',
    'profile.female': '女性',
    'profile.other': 'その他',
    'profile.runningSince': 'ランニング開始時期',
    'profile.rankingInfoNote': '似た条件のランナーと比較して順位を表示します',
    'profile.edit': '編集',
    'profile.runner': 'ランナー',
    'profile.totalKm': '総km',
    'profile.totalRuns': '総ランニング',
    'profile.streakDays': '連続日 🔥',
    'profile.badges': 'バッジ',
    'profile.actionConnect': 'ヘルス連携',
    'profile.actionMessages': 'メッセージ',
    'profile.actionMileage': 'マイレージ履歴',
    'profile.actionMileageGift': 'マイレージギフト',
    'profile.menuAudit': 'データ点検',
    'profile.menuAdminMileage': 'マイレージ報酬 (管理者)',
    'profile.menuSupport': 'サポート',
    'profile.menuPrivacy': 'プライバシーポリシー',
    'profile.menuTerms': '利用規約',
    'profile.deleteAccount': 'アカウント削除',
    'profile.themeTitle': '画面モード',
    'profile.themeLight': 'ライト',
    'profile.themeDark': 'ダーク',
    'profile.themeSystem': 'システム',
    'profile.signOut': 'ログアウト',
    'profile.totalSummary': '通算 {km}km · {runs}回',
    'settings.language': '言語',
    'home.todayKm': '本日km',
    'home.todayPace': '本日ペース',
    'home.recentPace': '最近のペース',
    'home.monthKm': '今月km',
    'home.monthDays': '今月の日数',
    'home.monthGoal': '{month}月の目標',
    'home.monthGoalEmpty': '今月の目標がまだありません',
    'home.monthGoalSet': '目標を設定 →',
    'home.weekChallenge': '今週のチャレンジ',
    'home.weekChallengeRun': '今週も走ってみましょうか?',
    'home.weekRunCta': '開始',
    'home.sync': '同期',
    'home.synced': '{ago} 同期',
    'home.tabToday': '今日',
    'home.tabMonth': '今月',
    'home.tabYear': '今年',
    'ranking.title': 'ランキング',
    'ranking.mine': '私のランキング',
    'ranking.mileage': 'マイレージ',
    'ranking.world': 'ワールドマラソン',
    'ranking.today': '🔥 今日',
    'ranking.week': '📆 今週',
    'ranking.month': '📅 今月',
    'ranking.year': '🏆 今年',
    'ranking.rank': '位',
    'ranking.of': '人',
    'ranking.champion': 'チャンピオン!',
    'ranking.keepIt': '位置をキープ',
    'world.inProgress': '進行中',
    'world.medals': '完走メダル',
    'world.series': 'チャレンジシリーズ',
    'world.newCourses': '新しいコース',
    'world.start': 'チャレンジ開始',
    'world.continue': '続ける',
    'world.entryFee': '参加費',
    'world.confirmStart': 'このコースを始めますか?',
    'world.completedAt': '完走: {date}',
    'world.distance': '{km}km',
    'world.participantsHeader': '同じコースのランナー',
  },
  zh: {
    'common.loading': '加载中...',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.retry': '重试',
    'common.back': '返回',
    'nav.home': '主页',
    'nav.map': '地图',
    'nav.ranking': '排行',
    'nav.social': '社交',
    'nav.shop': '商店',
    'nav.profile': '我的',
    'home.matchedRank.cta': '查看我的排名',
    'home.matchedRank.ctaSub': '输入地区、年龄、性别即可看到与相似跑者的排名对比',
    'home.todayTop': '今日TOP',
    'home.friendsWeek': '本周好友对比',
    'home.gallery': 'Routinist 画廊',
    'home.gallery.empty': '分享跑步照片,它们会显示在这里',
    'profile.editTitle': '编辑资料',
    'profile.nickname': '昵称',
    'profile.region': '地区',
    'profile.detectRegion': '根据当前位置自动选择',
    'profile.detecting': '检测中...',
    'profile.birthYear': '出生年份',
    'profile.gender': '性别',
    'profile.male': '男',
    'profile.female': '女',
    'profile.other': '其他',
    'profile.runningSince': '开始跑步时间',
    'profile.rankingInfoNote': '我们会把你和条件相似的跑者对比',
    'profile.edit': '编辑',
    'profile.runner': '跑者',
    'profile.totalKm': '总公里',
    'profile.totalRuns': '总跑步',
    'profile.streakDays': '连续天 🔥',
    'profile.badges': '徽章',
    'profile.actionConnect': '健康连接',
    'profile.actionMessages': '消息',
    'profile.actionMileage': '里程明细',
    'profile.actionMileageGift': '里程礼物',
    'profile.menuAudit': '数据检查',
    'profile.menuAdminMileage': '里程奖励 (管理员)',
    'profile.menuSupport': '客服',
    'profile.menuPrivacy': '隐私政策',
    'profile.menuTerms': '使用条款',
    'profile.deleteAccount': '注销账号',
    'profile.themeTitle': '主题',
    'profile.themeLight': '浅色',
    'profile.themeDark': '深色',
    'profile.themeSystem': '系统',
    'profile.signOut': '退出',
    'profile.totalSummary': '累计 {km}km · {runs}次',
    'settings.language': '语言',
    'home.todayKm': '今日km',
    'home.todayPace': '今日配速',
    'home.recentPace': '最近配速',
    'home.monthKm': '本月km',
    'home.monthDays': '本月天数',
    'home.monthGoal': '{month}月目标',
    'home.monthGoalEmpty': '本月还没有目标',
    'home.monthGoalSet': '设置目标 →',
    'home.weekChallenge': '本周挑战',
    'home.weekChallengeRun': '本周再跑一次吧?',
    'home.weekRunCta': '开始',
    'home.sync': '同步',
    'home.synced': '{ago} 同步',
    'home.tabToday': '今天',
    'home.tabMonth': '本月',
    'home.tabYear': '今年',
    'ranking.title': '排行',
    'ranking.mine': '我的排名',
    'ranking.mileage': '里程',
    'ranking.world': '世界马拉松',
    'ranking.today': '🔥 今天',
    'ranking.week': '📆 本周',
    'ranking.month': '📅 本月',
    'ranking.year': '🏆 今年',
    'ranking.rank': '名',
    'ranking.of': '人',
    'ranking.champion': '冠军!',
    'ranking.keepIt': '保持位置',
    'world.inProgress': '进行中',
    'world.medals': '完赛奖牌',
    'world.series': '挑战系列',
    'world.newCourses': '新课程',
    'world.start': '开始挑战',
    'world.continue': '继续',
    'world.entryFee': '参赛费',
    'world.confirmStart': '开始这个课程吗?',
    'world.completedAt': '完成: {date}',
    'world.distance': '{km}km',
    'world.participantsHeader': '同课程跑者',
  },
  es: {
    'common.loading': 'Cargando...',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.retry': 'Reintentar',
    'common.back': 'Atrás',
    'nav.home': 'Inicio',
    'nav.map': 'Mapa',
    'nav.ranking': 'Ranking',
    'nav.social': 'Social',
    'nav.shop': 'Tienda',
    'nav.profile': 'Mi perfil',
    'home.matchedRank.cta': 'Ver mi ranking',
    'home.matchedRank.ctaSub': 'Añade tu región, edad y género para ver tu posición entre corredores similares',
    'home.todayTop': 'TOP de hoy',
    'home.friendsWeek': 'Amigos esta semana',
    'home.gallery': 'Galería Routinist',
    'home.gallery.empty': 'Comparte fotos de tus carreras y aparecerán aquí',
    'profile.editTitle': 'Editar perfil',
    'profile.nickname': 'Apodo',
    'profile.region': 'Región',
    'profile.detectRegion': 'Detectar ubicación actual',
    'profile.detecting': 'Detectando...',
    'profile.birthYear': 'Año de nacimiento',
    'profile.gender': 'Género',
    'profile.male': 'Hombre',
    'profile.female': 'Mujer',
    'profile.other': 'Otro',
    'profile.runningSince': 'Corriendo desde',
    'profile.rankingInfoNote': 'Te comparamos con corredores de perfil similar para clasificaciones divertidas',
    'profile.edit': 'Editar',
    'profile.runner': 'Corredor',
    'profile.totalKm': 'Total km',
    'profile.totalRuns': 'Total carreras',
    'profile.streakDays': 'Racha 🔥',
    'profile.badges': 'Insignias',
    'profile.actionConnect': 'Conectar salud',
    'profile.actionMessages': 'Mensajes',
    'profile.actionMileage': 'Historial mileage',
    'profile.actionMileageGift': 'Regalar mileage',
    'profile.menuAudit': 'Revisión de datos',
    'profile.menuAdminMileage': 'Configuración mileage (admin)',
    'profile.menuSupport': 'Soporte',
    'profile.menuPrivacy': 'Política de privacidad',
    'profile.menuTerms': 'Términos del servicio',
    'profile.deleteAccount': 'Eliminar cuenta',
    'profile.themeTitle': 'Modo',
    'profile.themeLight': 'Claro',
    'profile.themeDark': 'Oscuro',
    'profile.themeSystem': 'Sistema',
    'profile.signOut': 'Cerrar sesión',
    'profile.totalSummary': 'Total {km}km · {runs} carreras',
    'settings.language': 'Idioma',
    'home.todayKm': 'Km hoy',
    'home.todayPace': 'Ritmo hoy',
    'home.recentPace': 'Ritmo reciente',
    'home.monthKm': 'Km del mes',
    'home.monthDays': 'Días este mes',
    'home.monthGoal': 'Meta de {month}',
    'home.monthGoalEmpty': 'Sin meta este mes',
    'home.monthGoalSet': 'Establecer meta →',
    'home.weekChallenge': 'Reto semanal',
    'home.weekChallengeRun': '¿Listo para correr esta semana?',
    'home.weekRunCta': 'Empezar',
    'home.sync': 'Sincronizar',
    'home.synced': 'Sincronizado {ago}',
    'home.tabToday': 'Hoy',
    'home.tabMonth': 'Mes',
    'home.tabYear': 'Año',
    'ranking.title': 'Ranking',
    'ranking.mine': 'Mi ranking',
    'ranking.mileage': 'Mileage',
    'ranking.world': 'Maratón mundial',
    'ranking.today': '🔥 Hoy',
    'ranking.week': '📆 Semana',
    'ranking.month': '📅 Mes',
    'ranking.year': '🏆 Año',
    'ranking.rank': 'º',
    'ranking.of': 'corredores',
    'ranking.champion': '¡Campeón!',
    'ranking.keepIt': 'Mantén tu lugar',
    'world.inProgress': 'En curso',
    'world.medals': 'Medallas',
    'world.series': 'Series de retos',
    'world.newCourses': 'Nuevos cursos',
    'world.start': 'Empezar curso',
    'world.continue': 'Continuar',
    'world.entryFee': 'Cuota de entrada',
    'world.confirmStart': '¿Empezar este curso?',
    'world.completedAt': 'Completado: {date}',
    'world.distance': '{km}km',
    'world.participantsHeader': 'Mismos cursos',
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
  if (nav.startsWith('ja')) return 'ja';
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('es')) return 'es';
  return 'ko';
}

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nState>({
  locale: 'ko',
  setLocale: () => {},
  t: (k) => k,
});

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
    };
  }, [locale]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}
