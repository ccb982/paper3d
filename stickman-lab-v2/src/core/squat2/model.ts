import type { World } from '../world';

export class SquatModel {
  constructor(private readonly w: World) {}

  massMatrix(axes: number[], out: Float64Array): void {
    this.w.body.massMatrixBlock(axes, out);
  }

  bias(out: Float64Array): void {
    this.w.body.biasForce(out);
  }

  pointJacobian(x: number, y: number, z: number, out: Float64Array): void {
    this.w.body.pointJacobian(x, y, z, out);
  }

  comJacobian(out: Float64Array): void {
    this.w.body.comJacobianComplement(out);
  }
}
