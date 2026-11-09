// Defensive actions (implemented in M2).
export class StealAction {
  constructor(a) {
    this.a = a;
    this.type = 'steal';
  }
  update() {
    return false;
  }
}
export class JumpAction {
  constructor(a) {
    this.a = a;
    this.type = 'jump';
  }
  update() {
    return false;
  }
}
export class StumbleAction {
  constructor(a) {
    this.a = a;
    this.type = 'stumble';
  }
  update() {
    return false;
  }
}
export function tryBlock() {
  return false;
}
