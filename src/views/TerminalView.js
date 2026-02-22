const blessed = require('blessed');
const contrib = require('blessed-contrib');

/**
 * 📺 TerminalView - 純粹的 Terminal UI 渲染層
 */
class TerminalView {
    constructor(options = {}) {
        this.screen = blessed.screen({
            smartCSR: true,
            title: options.title || '🦞 Golem Control Console',
            fullUnicode: true
        });

        // 建立網格 (12x12)
        this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });
        this._initWidgets();

        this.screen.key(['escape', 'q', 'C-c'], () => {
            if (options.onExit) options.onExit();
        });
    }

    // --- 介面元件佈局 ---
    _initWidgets() {
        // [左上] 系統心跳 (CPU/RAM)
        this.cpuLine = this.grid.set(0, 0, 4, 8, contrib.line, {
            style: { line: "yellow", text: "green", baseline: "black" },
            label: '⚡ 系統核心 (System Core)',
            showLegend: true
        });

        // [右上] 狀態概覽 (Status)
        this.statusBox = this.grid.set(0, 8, 4, 4, contrib.markdown, {
            label: '📊 狀態 (Status)',
            tags: true,
            style: { border: { fg: 'cyan' } }
        });

        // [中層] 時序雷達 (Chronos Log) - 專門顯示排程與時間相關資訊
        this.chronosLog = this.grid.set(4, 0, 3, 6, contrib.log, {
            fg: "green",
            selectedFg: "green",
            label: '⏰ 時序雷達 (Chronos Radar)'
        });

        // [中層] 隊列監控 (Queue Log) - 顯示對話進出與 Agent 會議
        this.queueLog = this.grid.set(4, 6, 3, 6, contrib.log, {
            fg: "magenta",
            selectedFg: "magenta",
            label: '🚦 隊列交通 (Traffic & Agents)'
        });

        // [底層] 全域日誌 (Global Log)
        this.logBox = this.grid.set(7, 0, 5, 12, contrib.log, {
            fg: "white",
            selectedFg: "white",
            label: '📝 核心日誌 (Neuro-Link Stream)'
        });
    }

    render() {
        this.screen.render();
    }

    destroy() {
        this.screen.destroy();
    }

    /**
     * 向指定區域發送日誌
     * @param {string} type - 日誌類型 (chronos|queue|agent|general)
     * @param {string} message - 格式化後的訊息
     */
    log(type, message) {
        switch (type) {
            case 'chronos':
                if (this.chronosLog) this.chronosLog.log(message);
                break;
            case 'queue':
            case 'agent':
                if (this.queueLog) this.queueLog.log(message);
                break;
            default:
                if (this.logBox) this.logBox.log(message);
        }
        this.render();
    }

    updateStatus(markdown) {
        this.statusBox.setMarkdown(markdown);
        this.render();
    }

    updateMetrics(data) {
        this.cpuLine.setData(data);
        this.render();
    }
}

module.exports = TerminalView;
