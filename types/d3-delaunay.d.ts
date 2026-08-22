declare module "d3-delaunay" {
  export class Delaunay {
    static from(points: ArrayLike<[number, number]> | ArrayLike<number>): Delaunay;
    readonly triangles: Uint32Array;
    neighbors(index: number): Iterable<number>;
  }
}
