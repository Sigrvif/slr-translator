"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheHandler = void 0;
class CacheHandler {
    constructor(wrapper) {
        this.fs = require('fs');
        this.cache = {};
        this.changed = false;
        this.busy = false;
        this.maximumCacheHitsOnLoad = 10;
        this.cacheDegradationLevel = 1;
        this.loaded = false;
        this.wrapper = wrapper;
    }
    // "Clean Cache" is a DSLR-only option. Engines using the base wrapper (e.g. SLR /
    // RedSugoi) do not define optionCleanCachePersistent, and reading it unguarded
    // threw a TypeError out of loadCache() - killing the whole batch translate() call
    // (no insertion, no PostBatch fixes) whenever Persistent Cache was disabled.
    // Safe read: missing option simply counts as "off".
    _cleanCachePersistentOn() {
        const opt = this.wrapper.optionCleanCachePersistent;
        return !!opt && typeof opt.getValue === 'function' && opt.getValue() == true;
    }
    addCache(key, translation) {
        if (translation != "" && translation != null && translation != undefined  && translation.match(/SHISAYE.TRANSLATIONFAIL/g) == null) {
            this.cache[key] = [translation, 1];
            this.changed = true;
        } else {
            console.error('[SLRPersistentCacheHandler] Not saving cache because there was no usable translation.');
        }
    }
    resetCache() {
        this.cache = {};
        this.changed = true;
    }
    hasCache(key) {
        return typeof this.cache[key] != 'undefined';
    }
    getCache(key) {
        this.cache[key][1] += 1;
        return this.cache[key][0];
    }
    getFilename() {
        // Dirname is now THIS FILE'S folder!!!!
        if (this.wrapper.getId() == 'dslr' && this.wrapper.optionCleanCachePersistent.getValue() == true && !this.wrapper.optionCachePersistent.getValue() && this.wrapper.optionSystemPromptaddition.getValue() == "" && (this.wrapper.optionModel.getValue() == undefined || this.wrapper.optionModel.getValue() == null)) {
            return `${__dirname}/../../CleanCacheDSLR_ERROR.json`;
        } else if (this.wrapper.getId() == 'dslr' && this.wrapper.optionCachePersistent.getValue() && (this.wrapper.optionModel.getValue() == undefined || this.wrapper.optionModel.getValue() == null)) {
            return `${__dirname}/../../CacheDSLR_ERROR.json`;
        } else if (this.wrapper.getId() == 'dslr' && this.wrapper.optionCleanCachePersistent.getValue() == true && !this.wrapper.optionCachePersistent.getValue() && this.wrapper.optionSystemPromptaddition.getValue() == "") {
            let usablemodelname = this.wrapper.optionModel.getValue().replaceAll(/^.*[\\\/]+/g, "");
            usablemodelname = usablemodelname.replaceAll(/:.*$/g, "");
            usablemodelname = usablemodelname.replaceAll(/[\?\"\<\>|]/g, "");
            if (usablemodelname == "" && this.wrapper.optionModel.getValue() != "") {
                console.error("Weird model name, trimming less.");
                usablemodelname = this.wrapper.optionModel.getValue().replaceAll(/[\?\"\<\>|\\\/]/g, "-");
                if (usablemodelname == "" || usablemodelname.match(/[^\-]/g) == null) {
                    console.error("Unusable model name. using 'ERROR'.");
                    usablemodelname = "ERROR";
                }
            } else if (usablemodelname == "" && this.wrapper.optionModel.getValue() == "") {
                console.error("No model name found. Using 'UNKNOWN'.");
                usablemodelname = "UNKNOWN";
            }
            return `${__dirname}/../../CleanCacheDSLR_${usablemodelname}.json`;
        } else if (this.wrapper.getId() == 'dslr' && this.wrapper.optionCachePersistent.getValue()) {
            let usablemodelname = this.wrapper.optionModel.getValue().replaceAll(/^.*[\\\/]+/g, "");
            usablemodelname = usablemodelname.replaceAll(/\:.*$/g, "");
            usablemodelname = usablemodelname.replaceAll(/[\?\"\<\>|]/g, "");
            if (usablemodelname == "" && this.wrapper.optionModel.getValue() != "") {
                console.error("Weird model name, trimming less.");
                usablemodelname = this.wrapper.optionModel.getValue().replaceAll(/[\?\"\<\>|\\\/]/g, "-");
                if (usablemodelname == "" || usablemodelname.match(/[^\-]/g) == null) {
                    console.error("Unusable model name. using 'ERROR'.");
                    usablemodelname = "ERROR";
                }
            } else if (usablemodelname == "" && this.wrapper.optionModel.getValue() == "") {
                console.error("No model name found. Using 'UNKNOWN'.");
                usablemodelname = "UNKNOWN";
            }
            return `${__dirname}/../../CacheDSLR_${usablemodelname}.json`;
        } else {
            return `${__dirname}/../../Cache${this.wrapper.getId()}.json`;
        }
    }
    loadCache() {
        if ((this.loaded) || (!this.wrapper.optionCachePersistent.getValue() && !this._cleanCachePersistentOn())) {
            return;
        }
        if (this.fs.existsSync(this.getFilename())) {
            try {
                let rawdata = this.fs.readFileSync(this.getFilename());
                this.cache = {};
                let arr = JSON.parse(rawdata);
                if (Array.isArray(arr)) {
                    for (let i = 0; i < arr.length; i++) {
                        let aggregateHits = arr[i][2];
                        if (aggregateHits > this.maximumCacheHitsOnLoad) {
                            aggregateHits = this.maximumCacheHitsOnLoad;
                        }
                        else {
                            aggregateHits -= this.cacheDegradationLevel;
                            // We don't want to continually decrease it until it can no longer raise, we just want it to lose priority over time.
                            if (aggregateHits < 0) {
                                aggregateHits = 0;
                            }
                        }
                        this.cache[arr[i][0]] = [arr[i][1], aggregateHits];
                    }
                    this.loaded = true;
                }
                else if (typeof arr == 'object') {
                    // old version, code adapt
                    for (let key in arr) {
                        this.cache[key] = [arr[key], 1];
                    }
                    this.loaded = true;
                }
                this.changed = false;
            }
            catch (e) {
                this.loaded = false;
                this.cache = {};
                console.error('[SLRPersistentCacheHandler] Load error for cache ' +
                    this.wrapper.getId() +
                    '. Resetting.', e);
            }
        }
        else {
            console.warn('[SLRPersistentCacheHandler] No cache found for ' + this.wrapper.getId() + '.');
        }
    }
    saveCache() {
        if (!this.wrapper.optionCachePersistent.getValue() && !this._cleanCachePersistentOn()) {
            return;
        }
        if (!this.changed) {
            console.warn('[SLRPersistentCacheHandler] Not saving cache as there have been no changes.');
            return;
        }
        let arr = [];
        let maxSize = this.wrapper.optionCachePersistentSize.getValue() * 1024 * 1024;
        let size = 0;
        for (let key in this.cache) {
            arr.push([key, this.cache[key][0], this.cache[key][1]]);
            size += this.getSize(`"${key}":["${this.cache[key][0]}", ${this.cache[key][1]}`);
        }
        arr.sort((a, b) => {
            return b[2] - a[2];
        });
        while (size > maxSize && arr.length > 0) {
            let pop = arr.pop();
            size -= this.getSize(`"${pop[0]}":["${pop[1]}", ${pop[2]}`);
        }
        try {
            let write = () => {
                this.fs.writeFile(this.getFilename(), JSON.stringify(arr, undefined, 1), (err) => {
                    this.busy = false;
                    if (err) {
                        console.error(err);
                    }
                    else {
                        console.log('[SLRPersistentCacheHandler] Successfully saved cache.');
                    }
                    let next = this.next;
                    if (typeof next == 'function') {
                        this.next = undefined;
                        next();
                    }
                    else {
                        this.busy = false;
                    }
                });
            };
            if (this.busy) {
                this.next = write;
            }
            else {
                this.busy = true;
                write();
            }
        }
        catch (e) {
            console.error('[SLRPersistentCacheHandler] Failed saving cache for ' +
                this.wrapper.getId() +
                '.', e);
        }
    }
    getSize(cache) {
        //return (new TextEncoder().encode(cache)).length;
        return cache.length * 2; // it was too slow, we will assume: HALF IS JAPANESE HALF IS ENGLISH SO 2 BYTES PER CHARACTER, probably still a bit pessimistic, which is good enough of an approximation
    }
}
exports.CacheHandler = CacheHandler;
