// 아이콘 에셋. 이모지 대신 자체 제작 SVG 를 쓴다.
//
// SVG 파일은 tools/make-icons.mjs 로 생성한다 (game/src/assets/icons/).
// Vite 가 URL 로 번들해주므로 base 경로가 어디로 바뀌든 안전하다.

import aquarium from './assets/icons/aquarium.svg';
import back from './assets/icons/back.svg';
import cage from './assets/icons/cage.svg';
import close from './assets/icons/close.svg';
import depthCharge from './assets/icons/depth-charge.svg';
import diver from './assets/icons/diver.svg';
import gift from './assets/icons/gift.svg';
import harpoon from './assets/icons/harpoon.svg';
import heart from './assets/icons/heart.svg';
import ice from './assets/icons/ice.svg';
import lock from './assets/icons/lock.svg';
import net from './assets/icons/net.svg';
import oxygen from './assets/icons/oxygen.svg';
import pearl from './assets/icons/pearl.svg';
import piggy from './assets/icons/piggy.svg';
import plus from './assets/icons/plus.svg';
import preCurrent from './assets/icons/pre-current.svg';
import preMine from './assets/icons/pre-mine.svg';
import prePearl from './assets/icons/pre-pearl.svg';
import rock from './assets/icons/rock.svg';
import settings from './assets/icons/settings.svg';
import shop from './assets/icons/shop.svg';
import star from './assets/icons/star.svg';
import starEmpty from './assets/icons/star-empty.svg';
import starfish from './assets/icons/starfish.svg';
import tide from './assets/icons/tide.svg';
import wheel from './assets/icons/wheel.svg';

export const ICONS = {
  aquarium,
  back,
  cage,
  close,
  depthCharge,
  diver,
  gift,
  harpoon,
  heart,
  ice,
  lock,
  net,
  oxygen,
  pearl,
  piggy,
  plus,
  preCurrent,
  preMine,
  prePearl,
  rock,
  settings,
  shop,
  star,
  starEmpty,
  starfish,
  tide,
  wheel,
} as const;

export type IconName = keyof typeof ICONS;

/** 아이콘 이미지 엘리먼트. size 는 px. */
export function icon(name: IconName, size = 20, className = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.src = ICONS[name];
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  img.draggable = false;
  img.width = size;
  img.height = size;
  // 이름을 클래스로 남긴다. 스타일에서 특정 아이콘만 다르게 다뤄야 할 때
  // (하트는 황동이 아니라 주홍으로 남긴다) src 문자열을 뒤지지 않아도 된다.
  img.className = `icon icon-${name} ${className}`.trim();
  return img;
}

/** 아이콘 + 숫자 (예: 진주 250) */
export function amount(name: IconName, value: number | string, size = 16): HTMLElement {
  const span = document.createElement('span');
  span.className = 'amount';
  span.append(icon(name, size), document.createTextNode(String(value)));
  return span;
}
