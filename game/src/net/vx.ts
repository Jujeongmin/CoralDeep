// Verse8 VXShop 연동 — 이 게임이 파는 유료 상품은 광고제거 하나뿐이라 TowerWar
// `game/src/net/vx.ts` 를 본으로 따르되 단일 상품용으로 줄였다.
//
// **가격·구매 가능 여부의 진실은 대시보드다.** 이 파일은 `VXShop` 이 대시보드에서
// 읽어 온 값을 그대로 돌려주는 얇은 창구일 뿐이다 — 로컬 폴백 가격(REMOVE_ADS_PRICE)은
// 대시보드가 아직 안 실렸을 때(로딩 중) 화면이 빈 값을 보여주지 않게 하는 자리끼우기다.
//
// **실제 지급은 여기서 하지 않는다.** `VXShop.buyItem()` 은 결제 대화상자를 열 뿐이고,
// 결제가 끝나면 Verse8 플랫폼이 서버(`server.js` 의 `$onItemPurchased`)에 직접
// 알린다 — 클라이언트가 "샀다"고 부르는 것으로는 아무것도 안 켜진다. 이 파일과
// `net/serverAccount.ts` 의 관계는 딱 그만큼이다: 여기는 결제창을 열고 대시보드 상태를
// 읽을 뿐이고, 실제로 `noAds` 가 켜졌는지는 서버 계정을 다시 읽어야(`refreshAccountRemote`)
// 알 수 있다.
//
// **검증 범위**: 이 파일이 실제 VXShop 대시보드와 주고받는 것은 이 환경에서 확인할 수
// 없다(배포된 상품이 없다) — typecheck/build 로만 확인했다. server.js 쪽 지급·중복
// 방지 로직은 tools/server-harness.mjs 로 실행해 검증했다.

import { VXShop, type VXShopItem } from '@verse8/platform/vanilla';

/**
 * 광고제거 상품 ID. **Verse8 대시보드에 등록된 상품 ID와 정확히 같아야 한다.**
 * `server.js` 의 `REMOVE_ADS_PRODUCT` 와도 같아야 한다 — 셋(대시보드·이 값·서버 값)
 * 중 하나라도 어긋나면 결제는 되는데 `$onItemPurchased` 가 상품을 못 알아봐서
 * `noAds` 가 조용히 안 켜진다.
 */
export const REMOVE_ADS_PRODUCT = 'remove_ads';

/** 대시보드가 아직 안 실렸을 때 화면에 보일 자리끼우기 가격. 실제 가격은 대시보드가 정한다. */
const REMOVE_ADS_PRICE = 2900;

export function initVxShop(): void {
  VXShop.init();
}

function removeAdsItem(): VXShopItem | undefined {
  return VXShop.getItem(REMOVE_ADS_PRODUCT);
}

/** 대시보드 가격이 실리면 그 값이 진짜다. 로딩 전에는 폴백을 보여준다. */
export function vxRemoveAdsPrice(): number {
  const live = removeAdsItem()?.price;
  return typeof live === 'number' && live >= 0 ? live : REMOVE_ADS_PRICE;
}

/**
 * 지금 살 수 있는가. 상품이 대시보드에 아직 안 올라왔으면(배포 전) 일단 살 수 있다고
 * 본다 — `isPurchasable`/`purchaseLimitReached` 를 판정할 대상 자체가 없기 때문이다.
 * 이 경우 상점 화면은 가격 대신 "준비 중"을 보여줘 실제로는 누르나 마나가 되게 한다
 * (TowerWar `net/vx.ts` 의 `isPurchasable` 과 같은 판정 순서 — `vxRemoveAdsPrice`
 * 만으로 "준비 중"을 판정하면 폴백 가격이 항상 값을 채워서 영영 안 뜬다).
 */
export function isRemoveAdsPurchasable(): boolean {
  const live = removeAdsItem();
  return live ? live.purchasable && !live.purchaseLimitReached : true;
}

/** Verse8 가 호스팅하는 결제 대화상자를 연다. 지급은 결제가 끝난 뒤 서버가 한다. */
export function buyRemoveAds(): boolean {
  try {
    VXShop.buyItem(REMOVE_ADS_PRODUCT);
    return true;
  } catch (error) {
    console.warn('[vx] VXShop 결제창을 열지 못했다:', error);
    return false;
  }
}

/**
 * 대시보드 값이 바뀌거나(가격·구매 가능 여부) 결제창이 닫히면 onChange 를 부른다.
 * 결제창이 닫힌 것(`onClose`)과 값 자체가 바뀐 것(`subscribe`)을 구분한다 —
 * 전자만 `purchased` 를 안다. 두 창구 모두 `initVxShop()` 이 먼저 불려 있어야 값이
 * 채워지므로 여기서 한 번 더 부른다(중복 호출은 안전하다).
 */
export function watchVxShop(onChange: (purchased: boolean) => void): () => void {
  initVxShop();
  const offState = VXShop.subscribe(() => onChange(false));
  const offClose = VXShop.onClose((payload) => {
    void VXShop.refresh().finally(() => onChange(payload.purchased));
  });
  return () => {
    offState();
    offClose();
  };
}
