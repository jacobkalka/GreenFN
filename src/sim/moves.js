// Dribble moves (implemented in M2).
export const MOVES = {};
export function canStartMove() {
  return false;
}
export class MoveAction {
  constructor(a) {
    this.a = a;
    this.type = 'move';
    this.locks = false;
  }
  update() {
    return false;
  }
}
