/**
 * BasicEventHandler — base class providing:
 *  - jQuery-style events (on/off/one/trigger) when constructed with a $elm,
 *    otherwise Node EventEmitter-based events.
 *  - Promise-based one-shot states (until/resolveState/rejectState/unresolveState).
 *  - Value processors (processWith/defineProcess/removeProcess).
 *  - An onReady hook.
 * Subclasses extend this.
 */
class BasicEventHandler {
	constructor($elm) {
		this.__switches = [];

		var waitForStates = {};

		// Wait until a state is resolved (resolves immediately if already resolved).
		this.until = async function (state) {
			if (waitForStates[state]) return waitForStates[state].promise;
			var prom = new Promise((resolve, reject) => {
				waitForStates[state] = {
					resolve: resolve,
					reject: reject,
					state: "waiting"
				};
			});
			waitForStates[state].promise = prom;
			return prom;
		};

		this.resolveState = function (state, arg) {
			if (!waitForStates[state]) {
				var prom = new Promise((resolve, reject) => {
					waitForStates[state] = {
						resolve: resolve,
						reject: reject,
						state: "resolved"
					};
				});
				waitForStates[state].promise = prom;
			}
			waitForStates[state].resolve(arg);
		};

		this.unresolveState = function (state) {
			delete waitForStates[state];
		};

		this.rejectState = function (state, error = "") {
			if (!waitForStates[state]) {
				var prom = new Promise((resolve, reject) => {
					waitForStates[state] = {
						resolve: resolve,
						reject: reject,
						state: "rejected"
					};
				});
				waitForStates[state].promise = prom;
			}
			if (error) {
				waitForStates[state].reject();
			} else {
				waitForStates[state].reject(new Error(error));
			}
		};

		var processors = {};

		this.processWith = function (processName, value, ...args) {
			if (typeof processors[processName] !== "function") return value;
			return processors[processName].apply(this, [].concat(value, args));
		};

		this.defineProcess = function (processName, process) {
			if (typeof process !== "function") return console.warn("Invalid process");
			if (typeof processName !== "string") return console.warn("Invalid processName");
			processors[processName] = process;
		};

		this.removeProcess = function (processName) {
			if (processors[processName]) delete processors[processName];
		};

		if ($elm && typeof window !== "undefined") {
			this.$elm = $elm || $("<div></div>");

			this.on = function (evt, fn) {
				this.$elm.on(evt, fn);
			};

			this.off = function (evt) {
				this.$elm.off(evt);
			};

			this.one = function (evt, fn) {
				this.$elm.one(evt, fn);
			};

			this.trigger = function (evt, param) {
				this.$elm.trigger(evt, param);
			};
		} else {
			var EventEmitter = require("events");
			var eventEmitter = new EventEmitter();
			this.on = (evt, fn) => {
				eventEmitter.on(evt, fn.bind(this));
			};
			this.off = (evt) => {
				eventEmitter.off(evt);
			};
			this.one = (evt, fn) => {
				eventEmitter.one(evt, fn.bind(this));
			};
			this.trigger = (evt, ...param) => {
				param.unshift(eventEmitter);
				eventEmitter.emit(evt, param);
			};
		}

		BasicEventHandler.prototype.onReady = function (onReadyEvent) {
			if (typeof onReadyEvent !== "function") return console.error("Error triggering onReady : parameter must be a function");
			this.__onReadyPool = this.__onReadyPool || [];

			if (Boolean(this.isInitialized) == false) {
				this.__onReadyPool.push(onReadyEvent);
			} else {
				for (var i = 0; i < this.__onReadyPool.length; i++) {
					this.__onReadyPool[i].apply(this, arguments);
				}
				this.__onReadyPool = [];

				onReadyEvent.apply(this, arguments);
			}
		};
	}
}

module.exports = BasicEventHandler;
