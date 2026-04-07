"use strict";
/**
 * CMP Mesh Cognition Layer - Barrel Export
 * Layer 8: Distributed learning through device mobility.
 *
 * @module mcl
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQLiteMERPersistence = exports.MCLEngine = exports.hintFromWire = exports.hintToWire = exports.applyHint = exports.generateHint = exports.efficiencyEMA = exports.didOutperform = exports.evolveParams = exports.Pollinator = exports.DEFAULT_MER_STORE_CONFIG = exports.MERStore = exports.DHT_REPLICATION = exports.createDHTNode = exports.replicationTargets = exports.closestNodes = exports.compareDistance = exports.xorDistance = exports.profileFromWire = exports.profileToWire = exports.profileHasExperience = exports.buildMCLProfile = exports.merFromWire = exports.merToWire = exports.merDHTKey = exports.isMERExpired = exports.verifyMER = exports.createMER = exports.BLOOM_BYTES = exports.BloomFilter = void 0;
var bloom_1 = require("./bloom");
Object.defineProperty(exports, "BloomFilter", { enumerable: true, get: function () { return bloom_1.BloomFilter; } });
Object.defineProperty(exports, "BLOOM_BYTES", { enumerable: true, get: function () { return bloom_1.BLOOM_BYTES; } });
var mer_1 = require("./mer");
Object.defineProperty(exports, "createMER", { enumerable: true, get: function () { return mer_1.createMER; } });
Object.defineProperty(exports, "verifyMER", { enumerable: true, get: function () { return mer_1.verifyMER; } });
Object.defineProperty(exports, "isMERExpired", { enumerable: true, get: function () { return mer_1.isMERExpired; } });
Object.defineProperty(exports, "merDHTKey", { enumerable: true, get: function () { return mer_1.merDHTKey; } });
Object.defineProperty(exports, "merToWire", { enumerable: true, get: function () { return mer_1.merToWire; } });
Object.defineProperty(exports, "merFromWire", { enumerable: true, get: function () { return mer_1.merFromWire; } });
var profile_1 = require("./profile");
Object.defineProperty(exports, "buildMCLProfile", { enumerable: true, get: function () { return profile_1.buildMCLProfile; } });
Object.defineProperty(exports, "profileHasExperience", { enumerable: true, get: function () { return profile_1.profileHasExperience; } });
Object.defineProperty(exports, "profileToWire", { enumerable: true, get: function () { return profile_1.profileToWire; } });
Object.defineProperty(exports, "profileFromWire", { enumerable: true, get: function () { return profile_1.profileFromWire; } });
var dht_1 = require("./dht");
Object.defineProperty(exports, "xorDistance", { enumerable: true, get: function () { return dht_1.xorDistance; } });
Object.defineProperty(exports, "compareDistance", { enumerable: true, get: function () { return dht_1.compareDistance; } });
Object.defineProperty(exports, "closestNodes", { enumerable: true, get: function () { return dht_1.closestNodes; } });
Object.defineProperty(exports, "replicationTargets", { enumerable: true, get: function () { return dht_1.replicationTargets; } });
Object.defineProperty(exports, "createDHTNode", { enumerable: true, get: function () { return dht_1.createDHTNode; } });
Object.defineProperty(exports, "DHT_REPLICATION", { enumerable: true, get: function () { return dht_1.DHT_REPLICATION; } });
var dmm_1 = require("./dmm");
Object.defineProperty(exports, "MERStore", { enumerable: true, get: function () { return dmm_1.MERStore; } });
Object.defineProperty(exports, "DEFAULT_MER_STORE_CONFIG", { enumerable: true, get: function () { return dmm_1.DEFAULT_MER_STORE_CONFIG; } });
var pollinator_1 = require("./pollinator");
Object.defineProperty(exports, "Pollinator", { enumerable: true, get: function () { return pollinator_1.Pollinator; } });
var evolution_1 = require("./evolution");
Object.defineProperty(exports, "evolveParams", { enumerable: true, get: function () { return evolution_1.evolveParams; } });
Object.defineProperty(exports, "didOutperform", { enumerable: true, get: function () { return evolution_1.didOutperform; } });
Object.defineProperty(exports, "efficiencyEMA", { enumerable: true, get: function () { return evolution_1.efficiencyEMA; } });
var hints_1 = require("./hints");
Object.defineProperty(exports, "generateHint", { enumerable: true, get: function () { return hints_1.generateHint; } });
Object.defineProperty(exports, "applyHint", { enumerable: true, get: function () { return hints_1.applyHint; } });
Object.defineProperty(exports, "hintToWire", { enumerable: true, get: function () { return hints_1.hintToWire; } });
Object.defineProperty(exports, "hintFromWire", { enumerable: true, get: function () { return hints_1.hintFromWire; } });
var engine_1 = require("./engine");
Object.defineProperty(exports, "MCLEngine", { enumerable: true, get: function () { return engine_1.MCLEngine; } });
var persistence_1 = require("./persistence");
Object.defineProperty(exports, "SQLiteMERPersistence", { enumerable: true, get: function () { return persistence_1.SQLiteMERPersistence; } });
//# sourceMappingURL=index.js.map