// glb 원본 바이트 캐시.
//
// 잠수부·포식자 모델은 판에 들어갈 때마다 새 Stage3D 가 만들어지고, 그때마다 같은
// 파일을 다시 fetch 했다. 브라우저 HTTP 캐시가 대개 막아 주지만 **첫 판에서는 그
// 대기가 그대로 보인다** — 판을 열고 "3D 를 기다리는 중" 화면을 몇 초 보게 된다.
//
// 앱을 켤 때 한 번 받아 두고(boot.ts), 이후에는 여기서 그대로 꺼내 쓴다. 파싱 결과가
// 아니라 **원본 ArrayBuffer** 를 들고 있는 이유는 파싱된 메시가 three 객체(정점 버퍼,
// 재질)라 여러 무대가 나눠 쓰면 하나가 dispose 될 때 나머지가 같이 죽기 때문이다.
// 바이트는 불변이라 그 문제가 없고, 다시 파싱하는 비용은 밀리초 단위다.

const buffers = new Map<string, Promise<ArrayBuffer>>();

/**
 * 이 URL 의 바이트를 준다. 같은 URL 은 한 번만 내려받는다.
 *
 * 실패는 캐시하지 않는다 — 오프라인이었다가 회선이 살아나면 다음 호출이 다시 받아야
 * 한다. 실패한 프로미스를 그대로 두면 그 세션 내내 그 모델이 죽는다.
 */
export function glbBuffer(url: string): Promise<ArrayBuffer> {
  const hit = buffers.get(url);
  if (hit) return hit;
  const p = fetch(url)
    .then((res) => res.arrayBuffer())
    .catch((e) => {
      buffers.delete(url);
      throw e;
    });
  buffers.set(url, p);
  return p;
}
