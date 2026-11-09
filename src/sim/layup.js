// Layups (implemented in M2).
export function wantsLayup() {
  return false;
}
export class LayupAction {
  constructor(a) {
    this.a = a;
    this.type = 'layup';
  }
  update() {
    return false;
  }
}
