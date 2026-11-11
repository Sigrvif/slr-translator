"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedPerformance = void 0;
class RedPerformance {
    constructor() {
        this.perfStart = Date.now();
        this.perfEnd = 0;
    }
    end() {
        this.perfEnd = Date.now();
        return this;
    }
    getSeconds() {
        let timeTaken = this.perfEnd - this.perfStart;
        return Math.round(timeTaken / 100) / 10;
    }
}
exports.RedPerformance = RedPerformance;
