"use strict";
/**
 * localStore.js
 * Async IndexedDB key-value store.
 *
 * SLR drop-in replacement for the former "better-localstorage" dependency.
 * The on-disk layout is unchanged (database + object store "keyValuePairs",
 * records shaped { id: key, value: value }) so previously saved user data
 * (options, formIO schemas, editor settings) keeps reading and writing as-is.
 */

function LocalStore(dbName, tableName) {
	this.dbName = dbName || "commonDB";
	this.tableName = tableName || "keyValuePairs";
	this.isInitialized = false;

	var self = this;
	var db = null;
	var ready = null;
	var listeners = {};

	var indexedDB = (typeof window !== "undefined") &&
		(window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB);

	function emit(event) {
		var fns = listeners[event];
		if (!fns) return;
		var args = Array.prototype.slice.call(arguments, 1);
		for (var i = 0; i < fns.length; i++) {
			try { fns[i].apply(self, args); } catch (e) { console.warn(e); }
		}
	}

	function store() {
		return db.transaction(self.tableName, "readwrite").objectStore(self.tableName);
	}

	function init() {
		if (ready) return ready;
		ready = new Promise(function (resolve, reject) {
			function markReady(database) {
				db = database;
				database.onclose = function () { emit("closed"); };
				self.isInitialized = true;
				resolve(self);
			}
			var req = indexedDB.open(self.dbName);
			req.onerror = function () { reject(new Error("Cannot connect to database")); };
			req.onsuccess = function () {
				var opened = req.result;
				if (opened.objectStoreNames.contains(self.tableName)) {
					markReady(opened);
				} else {
					var next = opened.version + 1;
					opened.close();
					var req2 = indexedDB.open(self.dbName, next);
					req2.onerror = function () { reject(new Error("Cannot connect to database")); };
					req2.onupgradeneeded = function (ev) {
						ev.target.result.createObjectStore(self.tableName, { keyPath: "id" });
					};
					req2.onsuccess = function () { markReady(req2.result); };
				}
			};
		});
		return ready;
	}

	this.untilReady = function () {
		if (this.isInitialized) return Promise.resolve(this);
		return init();
	};

	this.set = function (key, value) {
		if (typeof key !== "string") return Promise.reject(new Error("Invalid key. Key must be a string!"));
		return this.untilReady().then(function () {
			emit("beforeSet", key, value);
			return new Promise(function (resolve, reject) {
				var req = store().put({ id: key, value: value });
				req.onsuccess = function (e) { emit("set", key, value); resolve(e); };
				req.onerror = function (e) { reject(e); };
			});
		});
	};
	this.setItem = this.set;

	this.get = function (key) {
		if (typeof key !== "string") return Promise.reject(new Error("Invalid key. Key must be a string!"));
		return this.untilReady().then(function () {
			return new Promise(function (resolve, reject) {
				var req = store().get(key);
				req.onsuccess = function () { resolve(req.result ? req.result.value : undefined); };
				req.onerror = function (e) { reject(e); };
			});
		});
	};
	this.getItem = this.get;

	this.getAll = function () {
		return this.untilReady().then(function () {
			return new Promise(function (resolve, reject) {
				var req = store().getAll();
				req.onsuccess = function () {
					var out = {};
					var rows = req.result || [];
					for (var i = 0; i < rows.length; i++) out[rows[i].id] = rows[i].value;
					resolve(out);
				};
				req.onerror = function (e) { reject(e); };
			});
		});
	};

	this.delete = function (key) {
		if (typeof key !== "string") return Promise.reject(new Error("Invalid key. Key must be a string!"));
		return this.untilReady().then(function () {
			emit("beforeDelete", key);
			return new Promise(function (resolve, reject) {
				var req = store().delete(key);
				req.onsuccess = function (e) { emit("delete", key); resolve(e); };
				req.onerror = function (e) { reject(e); };
			});
		});
	};
	this.removeItem = this.delete;

	this.clear = function () {
		return this.untilReady().then(function () {
			emit("beforeClear");
			return new Promise(function (resolve, reject) {
				var req = store().clear();
				req.onsuccess = function (e) { emit("clear"); resolve(e); };
				req.onerror = function (e) { reject(e); };
			});
		});
	};

	this.on = function (event, fn) {
		if (typeof fn !== "function") return;
		(listeners[event] || (listeners[event] = [])).push(fn);
	};

	this.one = function (event, fn) {
		if (typeof fn !== "function") return;
		var wrap = function () {
			self.off(event, wrap);
			fn.apply(self, arguments);
		};
		this.on(event, wrap);
	};

	this.off = function (event) {
		delete listeners[event];
	};

	this.trigger = emit;
}

module.exports = LocalStore;
