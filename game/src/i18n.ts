// 한국어 / 영어 / 일본어 / 번체 중국어. 저장된 설정을 따라간다.
//
// 사전은 **키 순서를 KO 와 똑같이** 유지한다. 번역이 빠졌을 때 눈으로 바로 찾을 수 있고,
// 새 키를 넣을 때 네 곳에 같은 자리에 넣게 된다.
// 빠진 키는 `t()` 가 KO 로 되돌아가므로 화면이 깨지지는 않는다.

import type { PredatorKind } from './levels.ts';
import { getSave, type SaveLang } from './storage.ts';

export const LANGS = ['ko', 'en', 'ja', 'zh'] as const;
export type Lang = SaveLang;

/** 설정 화면에 그대로 띄우는 이름 — 각 언어를 그 언어로 적는다 */
export const LANG_LABEL: Record<Lang, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '繁體中文',
};

type Dict = Record<string, string>;

const KO: Dict = {
  title: 'Coral Deep',
  subtitle: '심해 수족관 복원',
  play: '플레이',
  levelN: '{n} 단계',
  start: '시작',
  moves: '이동',
  goal: '목표',
  score: '점수',
  quit: '나가기',
  back: '뒤로',
  close: '닫기',
  ok: '확인',
  cancel: '취소',
  free: '무료',
  watchAd: '광고 보기',
  claimTag: '받기',
  adUnavailable: '지금은 볼 수 있는 광고가 없어요',
  adFailed: '광고를 불러오지 못했어요',
  adSkipped: '보상을 받으려면 광고를 끝까지 봐야 해요',
  adCaption: '광고 재생 중…',
  adDevNote: '개발 환경 시뮬레이션 (실제 배포에서는 Verse8 광고가 재생됩니다)',
  adTimerWait: '{n}초 후 닫기',
  adTimerReady: '이제 닫을 수 있어요',
  adCloseAria: '광고 닫기',
  adCooldown: '{n} 후에 다시 가능',
  adDailyDone: '오늘은 다 봤어요',

  hearts: '하트',
  heartFull: '가득 참',
  heartNext: '다음 하트까지 {t}',
  noHearts: '하트가 없어요',
  refillHearts: '하트 가득 채우기',
  refillHeartOne: '광고 보고 하트 {n}개',
  heartsEarned: '하트 +{n}',
  infiniteHearts: '무한 하트 {t}',

  pearls: '진주',
  stars: '불가사리',
  boosters: '부스터',
  shop: '상점',
  buy: '구매',
  notEnoughPearls: '진주가 부족해요',
  removeAdsTitle: '광고 제거',
  removeAdsDesc: '구매하면 모든 광고 지면이 광고 없이 바로 받는 버튼으로 바뀝니다',
  removeAdsOwned: '구매 완료',
  removeAdsComingSoon: '준비 중',

  aquarium: '수족관',
  aquariumProgress: '복원 {n}%',
  repair: '복원하기',
  needStars: '불가사리 {n}개 필요',
  taskDone: '복원 완료!',
  allTasksDone: '모든 구역을 복원했어요! 새 구역은 곧 열려요.',

  levelClear: '클리어!',
  levelFailed: '실패…',
  starsEarned: '불가사리 +{n}',
  rewardPearls: '진주 +{n}',
  doubleReward: '보상 2배 받기',
  retry: '다시 하기',
  nextLevel: '다음 단계',
  toMap: '지도로',
  outOfMoves: '이동이 부족해요',
  noMatchesLeft: '더 이상 맞출 수 있는 짝이 없어요',
  continuePlay: '이어서 하기',
  extraMoves: '이동 +{n}',
  giveUp: '포기',

  preBoostTitle: '시작 부스터',
  preBoostDesc: '보드에 특수 타일을 미리 깔고 시작합니다',
  freeBoosterAd: '광고 보고 무료로 받기',
  inGameFreeBooster: '부스터가 없어요. 광고 보고 한 번 쓸까요?',

  dailyTitle: '일일 보상',
  dailyDay: '{n}일차',
  dailyClaim: '받기',
  dailyDouble: '광고 보고 2배',
  dailyDone: '내일 다시 오세요',
  dailyStreak: '일 연속 출석',

  wheelTitle: '심해 룰렛',
  wheelSpinning: '돌리는 중…',
  wheelSpin: '돌리기',
  wheelFree: '오늘의 무료 스핀',
  wheelAdSpin: '광고 보고 한 번 더',
  wheelResult: '{r} 획득!',

  piggyTitle: '진주 저금통',
  piggyProgress: '{a} / {b}',
  piggyOpen: '열기',
  piggyBoost: '광고 보고 +{n} 채우기',
  piggyNotReady: '아직 덜 찼어요',

  freeCoinTitle: '무료 진주',
  freeCoinDesc: '광고를 보고 진주 {n}개를 받으세요',
  extraStarTitle: '불가사리 받기',
  extraStarDesc: '광고를 보고 불가사리 1개를 받으세요',

  /** 하단 독 전용 짧은 이름 — '진주 저금통'은 6칸 독에서 두 줄로 접힌다 */
  piggyShort: '저금통',
  wheelShort: '룰렛',
  dailyShort: '보상',
  settings: '설정',
  haptics: '진동',
  language: '언어',
  on: '켜기',
  off: '끄기',

  goalColor: '{c}',
  goalRock: '산호암',
  goalIce: '결빙',
  goalNet: '어망',
  goalRescue: '구조',

  // 레벨마다 실제로 다가오는 포식자가 다르다(levels.ts 의 predatorFor — 아귀·
  // 고블린상어·오징어). rescueDesc/oxygenLow/oxygenOut 이 {predator} 로 이 이름을
  // 끼워 넣는다 — i18n.ts 의 predatorLabel() 이 PredatorKind 를 이 키로 바꾼다.
  predAnglerfish: '아귀',
  predGoblinShark: '고블린상어',
  predSquid: '대왕오징어',

  rescueTitle: '탈출',
  // 갇힌 건 연구원이 아니라 잠수부고, 케이지가 아니라 무너진 바위 틈이다.
  // 제한도 산소가 아니라 다가오는 포식자다 — 화면에 나오는 것과 글이 맞아야 한다.
  rescueDesc: '잠수부가 바위 틈에 갇혔다. {predator}가 닿기 전에 길을 뚫어라.',
  oxygen: '남은 시간',
  oxygenLow: '{predator}가 코앞이다!',
  oxygenOut: '{predator}에게 잡혔어요',
  oxygenRefill: '시간 +{n}초',
  rescued: '잠수부 탈출 성공!',
  stageLoading: '수심 준비 중…',
  rescueBonus: '구조 보너스',
  color0: '산호',
  color1: '물방울',
  color2: '해초',
  color3: '조개',
  color4: '해파리',
  color5: '진주알',

  boosterHarpoon: '작살',
  boosterDepthCharge: '폭뢰',
  boosterTide: '조류',
  boosterPreCurrent: '해류',
  boosterPreMine: '기뢰',
  boosterPrePearl: '심연의 진주',
  boosterHarpoonDesc: '타일 하나를 제거합니다',
  boosterDepthChargeDesc: '고른 지점 3x3을 터뜨립니다',
  boosterTideDesc: '보드를 다시 섞습니다',
  // 시작 부스터 설명은 **타일이 뭘 하는지**만 적는다.
  //
  // 이 문장은 상점과 레벨 시작 화면 두 곳에서 같이 쓰인다. '깔고 시작' 이라고 쓰면
  // 상점에서는 틀린 말이 된다 — 사면 인벤토리에 들어갈 뿐이고, 깔지 말지는
  // 레벨 시작 화면에서 고른다. 그 맥락은 화면이 이미 설명하고 있으니 여기선 빼야 한다.
  boosterPreCurrentDesc: '터뜨리면 그 줄 전체가 쓸려나가는 타일',
  boosterPreMineDesc: '터뜨리면 주변 3×3이 한 번에 사라지는 타일',
  boosterPrePearlDesc: '맞바꾼 색 타일이 보드에서 전부 사라지는 타일',
  owned: '보유 {n}',
  bgmVolume: '배경음',
  sfxVolume: '효과음',
  tapTarget: '사용할 칸을 고르세요',

  houseAdLabel: '추천',
  houseAdText: '수족관을 복원하고 새 친구를 맞이하세요',
};

const EN: Dict = {
  title: 'Coral Deep',
  subtitle: 'Restore the deep-sea aquarium',
  play: 'Play',
  levelN: 'Level {n}',
  start: 'Start',
  moves: 'Moves',
  goal: 'Goal',
  score: 'Score',
  quit: 'Quit',
  back: 'Back',
  close: 'Close',
  ok: 'OK',
  cancel: 'Cancel',
  free: 'Free',
  watchAd: 'Watch ad',
  claimTag: 'CLAIM',
  adUnavailable: 'No ad available right now',
  adFailed: 'Could not load the ad',
  adSkipped: 'Watch the full ad to earn the reward',
  adCaption: 'Playing ad…',
  adDevNote: 'Dev simulation (real Verse8 ads play in production)',
  adTimerWait: 'Close in {n}s',
  adTimerReady: 'You can close now',
  adCloseAria: 'Close ad',
  adCooldown: 'Available in {n}',
  adDailyDone: 'Daily limit reached',

  hearts: 'Hearts',
  heartFull: 'Full',
  heartNext: 'Next heart in {t}',
  noHearts: 'Out of hearts',
  refillHearts: 'Fill hearts to full',
  refillHeartOne: 'Watch an ad for {n} heart',
  heartsEarned: 'Hearts +{n}',
  infiniteHearts: 'Unlimited hearts {t}',

  pearls: 'Pearls',
  stars: 'Starfish',
  boosters: 'Boosters',
  shop: 'Shop',
  buy: 'Buy',
  notEnoughPearls: 'Not enough pearls',
  removeAdsTitle: 'Remove Ads',
  removeAdsDesc: 'Every rewarded-ad button turns into an instant claim button - no more ads',
  removeAdsOwned: 'Purchased',
  removeAdsComingSoon: 'Coming soon',

  aquarium: 'Aquarium',
  aquariumProgress: '{n}% restored',
  repair: 'Restore',
  needStars: 'Needs {n} starfish',
  taskDone: 'Restored!',
  allTasksDone: 'Every wing is restored! New wings coming soon.',

  levelClear: 'Cleared!',
  levelFailed: 'Failed…',
  starsEarned: 'Starfish +{n}',
  rewardPearls: 'Pearls +{n}',
  doubleReward: 'Double the reward',
  retry: 'Retry',
  nextLevel: 'Next level',
  toMap: 'Map',
  outOfMoves: 'Out of moves',
  noMatchesLeft: 'No matches left on the board',
  continuePlay: 'Keep playing',
  extraMoves: '+{n} moves',
  giveUp: 'Give up',

  preBoostTitle: 'Starting boosters',
  preBoostDesc: 'Begin with special tiles already on the board',
  freeBoosterAd: 'Watch an ad to get it free',
  inGameFreeBooster: 'No boosters left. Watch an ad to use one?',

  dailyTitle: 'Daily reward',
  dailyDay: 'Day {n}',
  dailyClaim: 'Claim',
  dailyDouble: 'Watch ad to double',
  dailyDone: 'Come back tomorrow',
  dailyStreak: 'day streak',

  wheelTitle: 'Deep Wheel',
  wheelSpinning: 'Spinning…',
  wheelSpin: 'Spin',
  wheelFree: 'Free spin today',
  wheelAdSpin: 'Watch ad for one more',
  wheelResult: 'You got {r}!',

  piggyTitle: 'Pearl piggy bank',
  piggyProgress: '{a} / {b}',
  piggyOpen: 'Open',
  piggyBoost: 'Watch ad for +{n}',
  piggyNotReady: 'Not full yet',

  freeCoinTitle: 'Free pearls',
  freeCoinDesc: 'Watch an ad for {n} pearls',
  extraStarTitle: 'Extra starfish',
  extraStarDesc: 'Watch an ad for 1 starfish',

  piggyShort: 'Piggy',
  wheelShort: 'Wheel',
  dailyShort: 'Daily',
  settings: 'Settings',
  haptics: 'Haptics',
  language: 'Language',
  on: 'On',
  off: 'Off',

  goalColor: '{c}',
  goalRock: 'Coral rock',
  goalIce: 'Ice',
  goalNet: 'Net',
  goalRescue: 'Rescue',

  predAnglerfish: 'anglerfish',
  predGoblinShark: 'goblin shark',
  predSquid: 'giant squid',

  rescueTitle: 'Escape',
  rescueDesc: 'The diver is pinned in a rock crevice. Clear a path before the {predator} reaches him.',
  oxygen: 'Time',
  oxygenLow: 'The {predator} is closing in!',
  oxygenOut: 'The {predator} got you',
  oxygenRefill: '+{n}s time',
  rescued: 'Diver escaped!',
  stageLoading: 'Preparing the depths…',
  rescueBonus: 'Rescue bonus',
  color0: 'Coral',
  color1: 'Bubble',
  color2: 'Kelp',
  color3: 'Shell',
  color4: 'Jelly',
  color5: 'Pearl',

  boosterHarpoon: 'Harpoon',
  boosterDepthCharge: 'Depth charge',
  boosterTide: 'Tide',
  boosterPreCurrent: 'Current',
  boosterPreMine: 'Mine',
  boosterPrePearl: 'Void pearl',
  boosterHarpoonDesc: 'Removes one tile',
  boosterDepthChargeDesc: 'Blows up a 3x3 area',
  boosterTideDesc: 'Reshuffles the board',
  boosterPreCurrentDesc: 'A tile that clears its whole line when popped',
  boosterPreMineDesc: 'A tile that clears the 3×3 around it when popped',
  boosterPrePearlDesc: 'A tile that clears every tile of the colour you swap it with',
  owned: 'Owned {n}',
  bgmVolume: 'Music',
  sfxVolume: 'Sound effects',
  tapTarget: 'Pick a tile',

  houseAdLabel: 'Featured',
  houseAdText: 'Restore the aquarium and meet new friends',
};

const JA: Dict = {
  title: 'Coral Deep',
  subtitle: '深海水族館の復元',
  play: 'プレイ',
  levelN: 'レベル {n}',
  start: 'スタート',
  moves: '手数',
  goal: '目標',
  score: 'スコア',
  quit: 'やめる',
  back: '戻る',
  close: '閉じる',
  ok: 'OK',
  cancel: 'キャンセル',
  free: '無料',
  watchAd: '広告を見る',
  claimTag: '受取',
  adUnavailable: '今は見られる広告がありません',
  adFailed: '広告を読み込めませんでした',
  adSkipped: '報酬を受け取るには広告を最後まで見てください',
  adCaption: '広告を再生中…',
  adDevNote: '開発環境のシミュレーション（本番では Verse8 の広告が再生されます）',
  adTimerWait: '{n}秒後に閉じる',
  adTimerReady: '閉じられます',
  adCloseAria: '広告を閉じる',
  adCooldown: '{n} 後に再挑戦',
  adDailyDone: '今日はもう見ました',

  hearts: 'ハート',
  heartFull: '満タン',
  heartNext: '次のハートまで {t}',
  noHearts: 'ハートがありません',
  refillHearts: 'ハートを全回復',
  refillHeartOne: '広告を見てハート {n} 個',
  heartsEarned: 'ハート +{n}',
  infiniteHearts: '無限ハート {t}',

  pearls: '真珠',
  stars: 'ヒトデ',
  boosters: 'ブースター',
  shop: 'ショップ',
  buy: '購入',
  notEnoughPearls: '真珠が足りません',
  removeAdsTitle: '広告非表示',
  removeAdsDesc: '購入すると、すべての広告ボタンが広告なしで受け取れるボタンに変わります',
  removeAdsOwned: '購入済み',
  removeAdsComingSoon: '準備中',

  aquarium: '水族館',
  aquariumProgress: '復元 {n}%',
  repair: '復元する',
  needStars: 'ヒトデ {n} 個必要',
  taskDone: '復元完了！',
  allTasksDone: 'すべての区画を復元しました！新しい区画は近日公開。',

  levelClear: 'クリア！',
  levelFailed: '失敗…',
  starsEarned: 'ヒトデ +{n}',
  rewardPearls: '真珠 +{n}',
  doubleReward: '報酬を2倍にする',
  retry: 'もう一度',
  nextLevel: '次のレベル',
  toMap: 'マップへ',
  outOfMoves: '手数が足りません',
  noMatchesLeft: 'そろえられる組み合わせがありません',
  continuePlay: '続ける',
  extraMoves: '手数 +{n}',
  giveUp: 'あきらめる',

  preBoostTitle: 'スタートブースター',
  preBoostDesc: '特殊タイルを盤面に置いて始めます',
  freeBoosterAd: '広告を見て無料で入手',
  inGameFreeBooster: 'ブースターがありません。広告を見て1回使いますか？',

  dailyTitle: 'デイリー報酬',
  dailyDay: '{n}日目',
  dailyClaim: '受け取る',
  dailyDouble: '広告を見て2倍',
  dailyDone: 'また明日',
  dailyStreak: '日連続ログイン',

  wheelTitle: '深海ルーレット',
  wheelSpinning: '回転中…',
  wheelSpin: '回す',
  wheelFree: '今日の無料スピン',
  wheelAdSpin: '広告を見てもう一回',
  wheelResult: '{r} を獲得！',

  piggyTitle: '真珠の貯金箱',
  piggyProgress: '{a} / {b}',
  piggyOpen: '開ける',
  piggyBoost: '広告を見て +{n}',
  piggyNotReady: 'まだ貯まっていません',

  freeCoinTitle: '無料の真珠',
  freeCoinDesc: '広告を見て真珠 {n} 個を受け取る',
  extraStarTitle: 'ヒトデを受け取る',
  extraStarDesc: '広告を見てヒトデを1個受け取る',

  piggyShort: '貯金箱',
  wheelShort: 'ルーレット',
  dailyShort: '報酬',
  settings: '設定',
  haptics: '振動',
  language: '言語',
  on: 'オン',
  off: 'オフ',

  goalColor: '{c}',
  goalRock: 'サンゴ岩',
  goalIce: '氷結',
  goalNet: '網',
  goalRescue: '救助',

  predAnglerfish: 'アンコウ',
  predGoblinShark: 'ミツクリザメ',
  predSquid: 'ダイオウイカ',

  rescueTitle: '脱出',
  rescueDesc: 'ダイバーが岩の隙間に閉じ込められた。{predator}が届く前に道を開け。',
  oxygen: '残り時間',
  oxygenLow: '{predator}がすぐそこだ！',
  oxygenOut: '{predator}に捕まった',
  oxygenRefill: '時間 +{n}秒',
  rescued: 'ダイバー脱出成功！',
  stageLoading: '深海を準備中…',
  rescueBonus: '救助ボーナス',
  color0: 'サンゴ',
  color1: '水泡',
  color2: '海藻',
  color3: '貝',
  color4: 'クラゲ',
  color5: '真珠玉',

  boosterHarpoon: 'モリ',
  boosterDepthCharge: '爆雷',
  boosterTide: '潮流',
  boosterPreCurrent: '海流',
  boosterPreMine: '機雷',
  boosterPrePearl: '深淵の真珠',
  boosterHarpoonDesc: 'タイルを1つ消します',
  boosterDepthChargeDesc: '選んだ地点の3x3を爆破します',
  boosterTideDesc: '盤面をシャッフルします',
  boosterPreCurrentDesc: '消すと列全体が消えるタイル',
  boosterPreMineDesc: '消すと周囲3×3が一度に消えるタイル',
  boosterPrePearlDesc: '入れ替えた色のタイルが盤面から全て消えるタイル',
  owned: '所持 {n}',
  bgmVolume: 'BGM',
  sfxVolume: '効果音',
  tapTarget: '使うマスを選んでください',

  houseAdLabel: 'おすすめ',
  houseAdText: '水族館を復元して新しい仲間を迎えよう',
};

const ZH: Dict = {
  title: 'Coral Deep',
  subtitle: '深海水族館修復',
  play: '開始遊戲',
  levelN: '第 {n} 關',
  start: '開始',
  moves: '步數',
  goal: '目標',
  score: '分數',
  quit: '離開',
  back: '返回',
  close: '關閉',
  ok: '確定',
  cancel: '取消',
  free: '免費',
  watchAd: '觀看廣告',
  claimTag: '領取',
  adUnavailable: '目前沒有可觀看的廣告',
  adFailed: '廣告載入失敗',
  adSkipped: '要領取獎勵必須看完廣告',
  adCaption: '廣告播放中…',
  adDevNote: '開發環境模擬（正式版會播放 Verse8 廣告）',
  adTimerWait: '{n} 秒後可關閉',
  adTimerReady: '現在可以關閉',
  adCloseAria: '關閉廣告',
  adCooldown: '{n} 後可再次使用',
  adDailyDone: '今天已看完',

  hearts: '愛心',
  heartFull: '已滿',
  heartNext: '距離下一顆愛心 {t}',
  noHearts: '沒有愛心了',
  refillHearts: '補滿愛心',
  refillHeartOne: '看廣告獲得 {n} 顆愛心',
  heartsEarned: '愛心 +{n}',
  infiniteHearts: '無限愛心 {t}',

  pearls: '珍珠',
  stars: '海星',
  boosters: '道具',
  shop: '商店',
  buy: '購買',
  notEnoughPearls: '珍珠不足',
  removeAdsTitle: '移除廣告',
  removeAdsDesc: '購買後,所有廣告按鈕都會變成免廣告直接領取的按鈕',
  removeAdsOwned: '已購買',
  removeAdsComingSoon: '準備中',

  aquarium: '水族館',
  aquariumProgress: '修復 {n}%',
  repair: '修復',
  needStars: '需要 {n} 顆海星',
  taskDone: '修復完成！',
  allTasksDone: '所有區域都修復好了！新區域即將開放。',

  levelClear: '過關！',
  levelFailed: '失敗…',
  starsEarned: '海星 +{n}',
  rewardPearls: '珍珠 +{n}',
  doubleReward: '獎勵加倍',
  retry: '再玩一次',
  nextLevel: '下一關',
  toMap: '回地圖',
  outOfMoves: '步數不足',
  noMatchesLeft: '沒有可以配對的組合了',
  continuePlay: '繼續遊戲',
  extraMoves: '步數 +{n}',
  giveUp: '放棄',

  preBoostTitle: '起始道具',
  preBoostDesc: '開始時先在盤面放置特殊磚塊',
  freeBoosterAd: '看廣告免費獲得',
  inGameFreeBooster: '沒有道具了。要看廣告使用一次嗎？',

  dailyTitle: '每日獎勵',
  dailyDay: '第 {n} 天',
  dailyClaim: '領取',
  dailyDouble: '看廣告加倍',
  dailyDone: '明天再來',
  dailyStreak: '天連續登入',

  wheelTitle: '深海轉盤',
  wheelSpinning: '轉動中…',
  wheelSpin: '轉動',
  wheelFree: '今日免費轉動',
  wheelAdSpin: '看廣告再轉一次',
  wheelResult: '獲得 {r}！',

  piggyTitle: '珍珠存錢筒',
  piggyProgress: '{a} / {b}',
  piggyOpen: '打開',
  piggyBoost: '看廣告 +{n}',
  piggyNotReady: '還沒存滿',

  freeCoinTitle: '免費珍珠',
  freeCoinDesc: '看廣告領取 {n} 顆珍珠',
  extraStarTitle: '領取海星',
  extraStarDesc: '看廣告領取 1 顆海星',

  piggyShort: '存錢筒',
  wheelShort: '轉盤',
  dailyShort: '獎勵',
  settings: '設定',
  haptics: '震動',
  language: '語言',
  on: '開',
  off: '關',

  goalColor: '{c}',
  goalRock: '珊瑚岩',
  goalIce: '冰封',
  goalNet: '漁網',
  goalRescue: '救援',

  predAnglerfish: '鮟鱇魚',
  predGoblinShark: '哥布林鯊魚',
  predSquid: '大王烏賊',

  rescueTitle: '逃脫',
  rescueDesc: '潛水員被困在岩縫中。在{predator}碰到他之前開出通路。',
  oxygen: '剩餘時間',
  oxygenLow: '{predator}就在眼前！',
  oxygenOut: '被{predator}抓住了',
  oxygenRefill: '時間 +{n} 秒',
  rescued: '潛水員成功脫困！',
  stageLoading: '深海準備中…',
  rescueBonus: '救援獎勵',
  color0: '珊瑚',
  color1: '水泡',
  color2: '海藻',
  color3: '貝殼',
  color4: '水母',
  color5: '珍珠',

  boosterHarpoon: '魚叉',
  boosterDepthCharge: '深水炸彈',
  boosterTide: '潮流',
  boosterPreCurrent: '海流',
  boosterPreMine: '水雷',
  boosterPrePearl: '深淵珍珠',
  boosterHarpoonDesc: '消除一個磚塊',
  boosterDepthChargeDesc: '炸開選定位置的 3x3 範圍',
  boosterTideDesc: '重新洗牌盤面',
  boosterPreCurrentDesc: '消除時會清空整條線的磚塊',
  boosterPreMineDesc: '消除時會一次清空周圍 3×3 的磚塊',
  boosterPrePearlDesc: '與它交換的顏色磚塊會全部從盤面消失',
  owned: '持有 {n}',
  bgmVolume: '背景音樂',
  sfxVolume: '音效',
  tapTarget: '請選擇要使用的格子',

  houseAdLabel: '推薦',
  houseAdText: '修復水族館，迎接新夥伴',
};

const DICTS: Record<Lang, Dict> = { ko: KO, en: EN, ja: JA, zh: ZH };

export function lang(): Lang {
  const saved = getSave().settings.lang;
  return (LANGS as readonly string[]).includes(saved) ? saved : 'ko';
}

export function t(key: string): string {
  // 번역이 빠진 키는 한국어로 되돌아간다 — 빈 화면보다는 읽히는 글자가 낫다
  return DICTS[lang()][key] ?? KO[key] ?? key;
}

export function tf(key: string, vars: Record<string, string | number>): string {
  let out = t(key);
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** PredatorKind -> 그 생물의 현재 언어 이름(predAnglerfish 등). rescueDesc/oxygenLow/
 * oxygenOut 의 {predator} 자리에 끼워 넣는다 — modals.ts 참고. */
const PREDATOR_KEY: Record<PredatorKind, string> = {
  anglerfish: 'predAnglerfish',
  goblinShark: 'predGoblinShark',
  squid: 'predSquid',
};

export function predatorLabel(kind: PredatorKind): string {
  return t(PREDATOR_KEY[kind]);
}

/** ms 를 mm:ss 로 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${`${m % 60}`.padStart(2, '0')}:${`${s}`.padStart(2, '0')}`;
  }
  return `${m}:${`${s}`.padStart(2, '0')}`;
}
