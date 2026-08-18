// 화면 px <-> z=0 월드 좌표 변환.
//
// 카메라는 원근이지만 자갈 평면은 화면과 나란한 z=0 에 놓는다. 기울이면 보드
// 사각형이 그 평면에서 사다리꼴이 되어 2D 보드와 정합이 안 맞는다. 평면이 나란하면
// 화면 px 와 월드 좌표가 상수배로 대응하므로 구멍을 정확히 팔 수 있다.
//
// 깊이는 이 평면을 기울여서가 아니라 그 앞뒤에 놓인 물체와 안개가 만든다.

export interface PlaneView {
  /** z=0 평면에서 화면 가로가 덮는 월드 길이 */
  worldW: number;
  /** 세로가 덮는 월드 길이 */
  worldH: number;
  /** 월드 1 이 화면 몇 px 인가 */
  pxPerWorld: number;
}

/**
 * @param fovDeg 카메라 세로 화각(도)
 * @param camZ 카메라와 평면 사이 거리
 */
export function planeView(
  screenW: number,
  screenH: number,
  fovDeg: number,
  camZ: number,
): PlaneView {
  const worldH = 2 * Math.tan(((fovDeg * Math.PI) / 180) / 2) * camZ;
  const worldW = worldH * (screenW / screenH);
  return { worldW, worldH, pxPerWorld: screenH / worldH };
}

/** 화면 좌표(왼쪽 위 원점, px)를 z=0 평면의 월드 좌표(가운데 원점, y 위쪽)로 */
export function screenToPlane(
  sx: number,
  sy: number,
  screenW: number,
  screenH: number,
  view: PlaneView,
): { x: number; y: number } {
  return {
    x: (sx / screenW - 0.5) * view.worldW,
    y: (0.5 - sy / screenH) * view.worldH,
  };
}

/** 화면 px 길이를 z=0 평면의 월드 길이로 */
export function pxToWorld(px: number, view: PlaneView): number {
  return px / view.pxPerWorld;
}
