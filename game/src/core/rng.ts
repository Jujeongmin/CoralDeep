// 시드 기반 난수. 테스트에서 보드를 재현하려면 반드시 이걸 써야 한다.
// (Math.random 을 코어에서 직접 부르지 말 것)

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [0, n) 정수 */
  int(n: number): number;
  pick<T>(arr: readonly T[]): T;
}

/** mulberry32 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
  };
}

/** 브라우저 런타임용 랜덤 시드 */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
