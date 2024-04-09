
// @ts-check

class MyEventEmitter {
  constructor() {
    this.events = {};
  }
  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }

    this.events[event].push(listener);
  }
  removeListener(event, listener) {
    if (this.events[event]) {
      const idx = this.events[event].indexOf(listener);

      if (idx > -1) {
        this.events[event].splice(idx, 1);
      }
    }
  }
  removeAllListeners(event) {
    if (this.events[event]) {
      this.events[event] = [];
    }
  }
  emit(event, ...args) {
    if (this.events[event]) {
      const listeners = this.events[event].slice();
      for (const listener of listeners) {
        listener.apply(this, args);
      }
    }
  }
  once(event, listener) {
    const tmp = (...args) => {
      this.removeListener(event, tmp);
      listener.apply(this, args);
    };
    this.on(event, tmp);
  }
}
