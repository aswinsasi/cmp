"use strict";
/**
 * CMP v1.3 — Mesh Immune System
 * Adaptive defense: threat detection, antibody generation,
 * quarantine management, and cross-mesh immune sharing.
 *
 * @module immune
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuarantineManager = exports.AntibodyGenerator = exports.ThreatDetector = void 0;
var threat_detector_1 = require("./threat-detector");
Object.defineProperty(exports, "ThreatDetector", { enumerable: true, get: function () { return threat_detector_1.ThreatDetector; } });
var antibody_generator_1 = require("./antibody-generator");
Object.defineProperty(exports, "AntibodyGenerator", { enumerable: true, get: function () { return antibody_generator_1.AntibodyGenerator; } });
var quarantine_manager_1 = require("./quarantine-manager");
Object.defineProperty(exports, "QuarantineManager", { enumerable: true, get: function () { return quarantine_manager_1.QuarantineManager; } });
//# sourceMappingURL=index.js.map