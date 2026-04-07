"use strict";
/**
 * CMP v1.3 — Mesh Morphogenesis
 * Self-organizing sub-meshes ("organs") based on workload affinity.
 *
 * @module morphogenesis
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MorphogenSignaler = exports.OrganRouter = exports.OrganManager = exports.AffinityTracker = void 0;
var affinity_tracker_1 = require("./affinity-tracker");
Object.defineProperty(exports, "AffinityTracker", { enumerable: true, get: function () { return affinity_tracker_1.AffinityTracker; } });
var organ_manager_1 = require("./organ-manager");
Object.defineProperty(exports, "OrganManager", { enumerable: true, get: function () { return organ_manager_1.OrganManager; } });
var organ_router_1 = require("./organ-router");
Object.defineProperty(exports, "OrganRouter", { enumerable: true, get: function () { return organ_router_1.OrganRouter; } });
var morphogen_signaler_1 = require("./morphogen-signaler");
Object.defineProperty(exports, "MorphogenSignaler", { enumerable: true, get: function () { return morphogen_signaler_1.MorphogenSignaler; } });
//# sourceMappingURL=index.js.map