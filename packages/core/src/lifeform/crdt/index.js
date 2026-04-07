"use strict";
/**
 * CMP v1.4 — CRDT Module
 * @module lifeform/crdt
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRDTState = exports.deserializeCRDT = exports.createCRDT = exports.MVRegister = exports.ORSet = exports.LWWRegister = exports.PNCounter = exports.GCounter = exports.CRDTType = void 0;
var crdts_1 = require("./crdts");
Object.defineProperty(exports, "CRDTType", { enumerable: true, get: function () { return crdts_1.CRDTType; } });
Object.defineProperty(exports, "GCounter", { enumerable: true, get: function () { return crdts_1.GCounter; } });
Object.defineProperty(exports, "PNCounter", { enumerable: true, get: function () { return crdts_1.PNCounter; } });
Object.defineProperty(exports, "LWWRegister", { enumerable: true, get: function () { return crdts_1.LWWRegister; } });
Object.defineProperty(exports, "ORSet", { enumerable: true, get: function () { return crdts_1.ORSet; } });
Object.defineProperty(exports, "MVRegister", { enumerable: true, get: function () { return crdts_1.MVRegister; } });
Object.defineProperty(exports, "createCRDT", { enumerable: true, get: function () { return crdts_1.createCRDT; } });
Object.defineProperty(exports, "deserializeCRDT", { enumerable: true, get: function () { return crdts_1.deserializeCRDT; } });
var crdt_state_1 = require("./crdt-state");
Object.defineProperty(exports, "CRDTState", { enumerable: true, get: function () { return crdt_state_1.CRDTState; } });
//# sourceMappingURL=index.js.map