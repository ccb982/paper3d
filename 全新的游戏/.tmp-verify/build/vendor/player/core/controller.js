"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FramePlaybackController = void 0;
const time_1 = require("./time");
class FramePlaybackController {
    constructor(asset, frameCount, config = {}, callbacks = {}) {
        this.assetRef = asset;
        this._ts = (0, time_1.createTimeState)(frameCount, config);
        this.callbacks = callbacks;
    }
    get state() { return this._ts.state; }
    get frameIndex() { return this._ts.frameIndex; }
    get frameCount() { return this._ts.frameCount; }
    get localTime() { return this._ts.localTime; }
    get progress() { return (0, time_1.progress)(this._ts); }
    get currentLoop() { return this._ts.loopCount; }
    get fps() { return this._ts.fps; }
    get isHolding() { return this._ts.isHolding; }
    advance(dt) {
        const prev = this._ts._prevFrameIndex;
        const prevState = this._ts._prevState;
        (0, time_1.advance)(this._ts, dt);
        if (this._ts.state !== prevState) {
            this.callbacks.onStateChange?.(this._ts.state, prevState);
        }
        if (this._ts.frameIndex !== prev) {
            this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
        }
        if (this._ts.state === 'done') {
            this.callbacks.onComplete?.();
        }
    }
    goto(frame) {
        const prev = this._ts.frameIndex;
        (0, time_1.goto)(this._ts, frame);
        if (this._ts.frameIndex !== prev) {
            this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
        }
    }
    gotoTime(seconds) {
        const prev = this._ts.frameIndex;
        (0, time_1.gotoTime)(this._ts, seconds);
        if (this._ts.frameIndex !== prev) {
            this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
        }
    }
    stepForward(n = 1) {
        const prev = this._ts.frameIndex;
        (0, time_1.stepForward)(this._ts, n);
        if (this._ts.frameIndex !== prev) {
            this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
        }
    }
    stepBackward(n = 1) {
        const prev = this._ts.frameIndex;
        (0, time_1.stepBackward)(this._ts, n);
        if (this._ts.frameIndex !== prev) {
            this.callbacks.onFrameChange?.(this._ts.frameIndex, prev);
        }
    }
    hold() { (0, time_1.hold)(this._ts); }
    release() { (0, time_1.release)(this._ts); }
    play() { (0, time_1.play)(this._ts); }
    pause() { (0, time_1.pause)(this._ts); }
    resume() { (0, time_1.resume)(this._ts); }
    stop() { (0, time_1.stop)(this._ts); }
    reset(config) { (0, time_1.reset)(this._ts, config); }
    dispose() {
        this.callbacks = {};
    }
}
exports.FramePlaybackController = FramePlaybackController;
