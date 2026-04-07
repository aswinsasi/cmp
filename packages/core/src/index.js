"use strict";
/**
 * CMP Core - Barrel Export
 *
 * Compute Mesh Protocol v1.0
 * Decentralized proximity-based distributed computation.
 *
 * @author Agent Viscro
 * @license MIT
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CMPNode = exports.IncentiveLedger = exports.BidHandler = exports.NegotiationEngine = exports.CapabilityExchange = exports.CapabilityMap = exports.DeviceProfiler = exports.DiscoveryLayer = exports.verifyCRC32C = exports.crc32c = exports.FRAME_MAX_PAYLOAD = exports.FRAME_HEADER_SIZE = exports.getFrameSequence = exports.resetFrameSequence = exports.decodeJSON = exports.encodeJSON = exports.decodeCapability = exports.encodeCapability = exports.decodeMessage = exports.encodeMessage = exports.isValidBeacon = exports.createBeacon = exports.decodeBeacon = exports.encodeBeacon = exports.PeerTable = exports.EventBus = exports.resolveConfig = exports.DEFAULT_CONFIG = exports.LogLevel = exports.Logger = void 0;
// Types
__exportStar(require("./types"), exports);
// Crypto
__exportStar(require("./crypto"), exports);
// Utilities
__exportStar(require("./utils/helpers"), exports);
var logger_1 = require("./utils/logger");
Object.defineProperty(exports, "Logger", { enumerable: true, get: function () { return logger_1.Logger; } });
Object.defineProperty(exports, "LogLevel", { enumerable: true, get: function () { return logger_1.LogLevel; } });
var config_1 = require("./utils/config");
Object.defineProperty(exports, "DEFAULT_CONFIG", { enumerable: true, get: function () { return config_1.DEFAULT_CONFIG; } });
Object.defineProperty(exports, "resolveConfig", { enumerable: true, get: function () { return config_1.resolveConfig; } });
// Mesh
var event_bus_1 = require("./mesh/event-bus");
Object.defineProperty(exports, "EventBus", { enumerable: true, get: function () { return event_bus_1.EventBus; } });
var peer_table_1 = require("./mesh/peer-table");
Object.defineProperty(exports, "PeerTable", { enumerable: true, get: function () { return peer_table_1.PeerTable; } });
// Layers
var beacon_codec_1 = require("./layers/beacon-codec");
Object.defineProperty(exports, "encodeBeacon", { enumerable: true, get: function () { return beacon_codec_1.encodeBeacon; } });
Object.defineProperty(exports, "decodeBeacon", { enumerable: true, get: function () { return beacon_codec_1.decodeBeacon; } });
Object.defineProperty(exports, "createBeacon", { enumerable: true, get: function () { return beacon_codec_1.createBeacon; } });
Object.defineProperty(exports, "isValidBeacon", { enumerable: true, get: function () { return beacon_codec_1.isValidBeacon; } });
var serializer_1 = require("./layers/serializer");
Object.defineProperty(exports, "encodeMessage", { enumerable: true, get: function () { return serializer_1.encodeMessage; } });
Object.defineProperty(exports, "decodeMessage", { enumerable: true, get: function () { return serializer_1.decodeMessage; } });
Object.defineProperty(exports, "encodeCapability", { enumerable: true, get: function () { return serializer_1.encodeCapability; } });
Object.defineProperty(exports, "decodeCapability", { enumerable: true, get: function () { return serializer_1.decodeCapability; } });
Object.defineProperty(exports, "encodeJSON", { enumerable: true, get: function () { return serializer_1.encodeJSON; } });
Object.defineProperty(exports, "decodeJSON", { enumerable: true, get: function () { return serializer_1.decodeJSON; } });
Object.defineProperty(exports, "resetFrameSequence", { enumerable: true, get: function () { return serializer_1.resetFrameSequence; } });
Object.defineProperty(exports, "getFrameSequence", { enumerable: true, get: function () { return serializer_1.getFrameSequence; } });
Object.defineProperty(exports, "FRAME_HEADER_SIZE", { enumerable: true, get: function () { return serializer_1.FRAME_HEADER_SIZE; } });
Object.defineProperty(exports, "FRAME_MAX_PAYLOAD", { enumerable: true, get: function () { return serializer_1.FRAME_MAX_PAYLOAD; } });
var crc32c_1 = require("./utils/crc32c");
Object.defineProperty(exports, "crc32c", { enumerable: true, get: function () { return crc32c_1.crc32c; } });
Object.defineProperty(exports, "verifyCRC32C", { enumerable: true, get: function () { return crc32c_1.verifyCRC32C; } });
var discovery_1 = require("./layers/discovery");
Object.defineProperty(exports, "DiscoveryLayer", { enumerable: true, get: function () { return discovery_1.DiscoveryLayer; } });
var profiler_1 = require("./layers/profiler");
Object.defineProperty(exports, "DeviceProfiler", { enumerable: true, get: function () { return profiler_1.DeviceProfiler; } });
var capability_map_1 = require("./layers/capability-map");
Object.defineProperty(exports, "CapabilityMap", { enumerable: true, get: function () { return capability_map_1.CapabilityMap; } });
var capability_exchange_1 = require("./layers/capability-exchange");
Object.defineProperty(exports, "CapabilityExchange", { enumerable: true, get: function () { return capability_exchange_1.CapabilityExchange; } });
var negotiation_engine_1 = require("./layers/negotiation-engine");
Object.defineProperty(exports, "NegotiationEngine", { enumerable: true, get: function () { return negotiation_engine_1.NegotiationEngine; } });
var bid_handler_1 = require("./layers/bid-handler");
Object.defineProperty(exports, "BidHandler", { enumerable: true, get: function () { return bid_handler_1.BidHandler; } });
// Incentive
var incentive_1 = require("./incentive");
Object.defineProperty(exports, "IncentiveLedger", { enumerable: true, get: function () { return incentive_1.IncentiveLedger; } });
// Mesh Cognition Layer (v1.2)
__exportStar(require("./mcl"), exports);
// Node
var cmp_node_1 = require("./cmp-node");
Object.defineProperty(exports, "CMPNode", { enumerable: true, get: function () { return cmp_node_1.CMPNode; } });
//# sourceMappingURL=index.js.map