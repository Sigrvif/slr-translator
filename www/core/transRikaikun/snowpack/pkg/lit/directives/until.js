import { x } from "../../common/lit-html-259ed873.js";
/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t = (o2) => o2 === null || typeof o2 != "object" && typeof o2 != "function", e = (o2) => o2.strings === void 0;
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$1 = { ATTRIBUTE: 1, CHILD: 2, PROPERTY: 3, BOOLEAN_ATTRIBUTE: 4, EVENT: 5, ELEMENT: 6 }, e$1 = (t2) => (...e2) => ({ _$litDirective$: t2, values: e2 });
class i {
  constructor(t2) {
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t2, e2, i2) {
    this._$Ct = t2, this._$AM = e2, this._$Ci = i2;
  }
  _$AS(t2, e2) {
    return this.update(t2, e2);
  }
  update(t2, e2) {
    return this.render(...e2);
  }
}
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const s = (i2, t2) => {
  var e2, o2;
  const r2 = i2._$AN;
  if (r2 === void 0)
    return false;
  for (const i3 of r2)
    (o2 = (e2 = i3)._$AO) === null || o2 === void 0 || o2.call(e2, t2, false), s(i3, t2);
  return true;
}, o = (i2) => {
  let t2, e2;
  do {
    if ((t2 = i2._$AM) === void 0)
      break;
    e2 = t2._$AN, e2.delete(i2), i2 = t2;
  } while ((e2 == null ? void 0 : e2.size) === 0);
}, r = (i2) => {
  for (let t2; t2 = i2._$AM; i2 = t2) {
    let e2 = t2._$AN;
    if (e2 === void 0)
      t2._$AN = e2 = /* @__PURE__ */ new Set();
    else if (e2.has(i2))
      break;
    e2.add(i2), l(t2);
  }
};
function n(i2) {
  this._$AN !== void 0 ? (o(this), this._$AM = i2, r(this)) : this._$AM = i2;
}
function h(i2, t2 = false, e2 = 0) {
  const r2 = this._$AH, n2 = this._$AN;
  if (n2 !== void 0 && n2.size !== 0)
    if (t2)
      if (Array.isArray(r2))
        for (let i3 = e2; i3 < r2.length; i3++)
          s(r2[i3], false), o(r2[i3]);
      else
        r2 != null && (s(r2, false), o(r2));
    else
      s(this, i2);
}
const l = (i2) => {
  var t2, s2, o2, r2;
  i2.type == t$1.CHILD && ((t2 = (o2 = i2)._$AP) !== null && t2 !== void 0 || (o2._$AP = h), (s2 = (r2 = i2)._$AQ) !== null && s2 !== void 0 || (r2._$AQ = n));
};
class c extends i {
  constructor() {
    super(...arguments), this._$AN = void 0;
  }
  _$AT(i2, t2, e2) {
    super._$AT(i2, t2, e2), r(this), this.isConnected = i2._$AU;
  }
  _$AO(i2, t2 = true) {
    var e2, r2;
    i2 !== this.isConnected && (this.isConnected = i2, i2 ? (e2 = this.reconnected) === null || e2 === void 0 || e2.call(this) : (r2 = this.disconnected) === null || r2 === void 0 || r2.call(this)), t2 && (s(this, i2), o(this));
  }
  setValue(t2) {
    if (e(this._$Ct))
      this._$Ct._$AI(t2, this);
    else {
      const i2 = [...this._$Ct._$AH];
      i2[this._$Ci] = t2, this._$Ct._$AI(i2, this, 0);
    }
  }
  disconnected() {
  }
  reconnected() {
  }
}
/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
class s$1 {
  constructor(t2) {
    this.Y = t2;
  }
  disconnect() {
    this.Y = void 0;
  }
  reconnect(t2) {
    this.Y = t2;
  }
  deref() {
    return this.Y;
  }
}
class i$1 {
  constructor() {
    this.Z = void 0, this.q = void 0;
  }
  get() {
    return this.Z;
  }
  pause() {
    var t2;
    (t2 = this.Z) !== null && t2 !== void 0 || (this.Z = new Promise((t3) => this.q = t3));
  }
  resume() {
    var t2;
    (t2 = this.q) === null || t2 === void 0 || t2.call(this), this.Z = this.q = void 0;
  }
}
/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const n$1 = (t$12) => !t(t$12) && typeof t$12.then == "function";
class h$1 extends c {
  constructor() {
    super(...arguments), this._$Cwt = 1073741823, this._$Cyt = [], this._$CK = new s$1(this), this._$CX = new i$1();
  }
  render(...s2) {
    var i2;
    return (i2 = s2.find((t2) => !n$1(t2))) !== null && i2 !== void 0 ? i2 : x;
  }
  update(s2, i2) {
    const r2 = this._$Cyt;
    let e2 = r2.length;
    this._$Cyt = i2;
    const o2 = this._$CK, h2 = this._$CX;
    this.isConnected || this.disconnected();
    for (let t2 = 0; t2 < i2.length && !(t2 > this._$Cwt); t2++) {
      const s3 = i2[t2];
      if (!n$1(s3))
        return this._$Cwt = t2, s3;
      t2 < e2 && s3 === r2[t2] || (this._$Cwt = 1073741823, e2 = 0, Promise.resolve(s3).then(async (t3) => {
        for (; h2.get(); )
          await h2.get();
        const i3 = o2.deref();
        if (i3 !== void 0) {
          const r3 = i3._$Cyt.indexOf(s3);
          r3 > -1 && r3 < i3._$Cwt && (i3._$Cwt = r3, i3.setValue(t3));
        }
      }));
    }
    return x;
  }
  disconnected() {
    this._$CK.disconnect(), this._$CX.pause();
  }
  reconnected() {
    this._$CK.reconnect(this), this._$CX.resume();
  }
}
const c$1 = e$1(h$1);
export { c$1 as until };
