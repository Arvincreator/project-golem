const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class DebouncedWriter {
  static _instances = new Set();

  constructor(filepath, delayMs = 2000) {
    this.filepath = path.resolve(filepath);
    this.delayMs = delayMs;
    this._pendingData = null;
    this._timer = null;
    DebouncedWriter._instances.add(this);
  }

  markDirty(data) {
    this._pendingData = data;
    this._scheduleSave();
  }

  _scheduleSave() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flush();
    }, this.delayMs);
  }

  async _flush() {
    if (this._pendingData === null) return;
    const data = this._pendingData;
    this._pendingData = null;
    const tmpPath = this.filepath + '.tmp';
    try {
      // Ensure directory exists
      const dir = path.dirname(this.filepath);
      if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
      }
      await fs.writeFile(tmpPath, data);
      await fs.rename(tmpPath, this.filepath);
    } catch (err) {
      console.warn(`[DebouncedWriter] Failed to flush ${this.filepath}: ${err.message}`);
    }
  }

  async forceFlush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    await this._flush();
  }

  destroy() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    DebouncedWriter._instances.delete(this);
  }

  static async flushAll() {
    const promises = [];
    for (const instance of DebouncedWriter._instances) {
      promises.push(instance.forceFlush());
    }
    await Promise.all(promises);
  }
}

module.exports = DebouncedWriter;
