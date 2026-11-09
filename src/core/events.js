// Minimal synchronous event bus used to decouple simulation from audio, VFX, UI and progression.
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, data) {
    const list = this.handlers.get(type);
    if (list) for (let i = 0; i < list.length; i++) list[i](data);
    const any = this.handlers.get('*');
    if (any) for (let i = 0; i < any.length; i++) any[i](type, data);
  }
  clear() {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
