// 선형(linear) RGB -> sRGB 감마 변환 - 굽기 도구들이 공유한다.
//
// glTF 의 baseColorFactor 와 FBX 의 Material DiffuseColor 는 둘 다 물리 기반
// 렌더러가 조명 계산에 쓰는 리니어 색이다(Blender 가 이 파이프라인으로 익스포트한다
// - 색상 피커에 sRGB 값을 입력해도 저장되는 부동소수점은 리니어다). 화면에 그대로
// 찍으면 실제보다 어둡고 탁하게 보인다 - bake-predators-glb.mjs 가 poly.pizza glb
// 소스의 baseColorFactor 에 먼저 이 변환을 썼고(그 파일에 로컬 사본이 남아 있다),
// bake-diver-glb.mjs 가 SpaceSuit FBX 의 DiffuseColor 를 읽을 때도 같은 변환이
// 필요해 공유 라이브러리로 옮겼다.
export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}
