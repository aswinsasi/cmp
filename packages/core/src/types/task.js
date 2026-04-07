"use strict";
/**
 * CMP Task Types
 * Layer 3-4: Task requests, chunks, and decomposition.
 *
 * @module types/task
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutputFormat = exports.Priority = exports.EncryptionAlgo = exports.VerifyMode = exports.SecurityLevel = exports.TaskType = void 0;
var TaskType;
(function (TaskType) {
    TaskType[TaskType["INFERENCE"] = 0] = "INFERENCE";
    TaskType[TaskType["MAP_REDUCE"] = 1] = "MAP_REDUCE";
    TaskType[TaskType["PIPELINE"] = 2] = "PIPELINE";
    TaskType[TaskType["SCATTER_GATHER"] = 3] = "SCATTER_GATHER";
    TaskType[TaskType["CUSTOM"] = 4] = "CUSTOM";
})(TaskType || (exports.TaskType = TaskType = {}));
var SecurityLevel;
(function (SecurityLevel) {
    SecurityLevel[SecurityLevel["PUBLIC"] = 0] = "PUBLIC";
    SecurityLevel[SecurityLevel["PRIVATE"] = 1] = "PRIVATE";
    SecurityLevel[SecurityLevel["CONFIDENTIAL"] = 2] = "CONFIDENTIAL";
})(SecurityLevel || (exports.SecurityLevel = SecurityLevel = {}));
var VerifyMode;
(function (VerifyMode) {
    VerifyMode[VerifyMode["NONE"] = 0] = "NONE";
    VerifyMode[VerifyMode["CHECKSUM"] = 1] = "CHECKSUM";
    VerifyMode[VerifyMode["REDUNDANT"] = 2] = "REDUNDANT";
    VerifyMode[VerifyMode["ZK_PROOF"] = 3] = "ZK_PROOF";
})(VerifyMode || (exports.VerifyMode = VerifyMode = {}));
var EncryptionAlgo;
(function (EncryptionAlgo) {
    EncryptionAlgo[EncryptionAlgo["AES_256_GCM"] = 0] = "AES_256_GCM";
    EncryptionAlgo[EncryptionAlgo["CHACHA20_POLY1305"] = 1] = "CHACHA20_POLY1305";
})(EncryptionAlgo || (exports.EncryptionAlgo = EncryptionAlgo = {}));
var Priority;
(function (Priority) {
    Priority[Priority["LOW"] = 0] = "LOW";
    Priority[Priority["NORMAL"] = 1] = "NORMAL";
    Priority[Priority["HIGH"] = 2] = "HIGH";
    Priority[Priority["CRITICAL"] = 3] = "CRITICAL";
})(Priority || (exports.Priority = Priority = {}));
var OutputFormat;
(function (OutputFormat) {
    OutputFormat[OutputFormat["RAW_BYTES"] = 0] = "RAW_BYTES";
    OutputFormat[OutputFormat["JSON"] = 1] = "JSON";
    OutputFormat[OutputFormat["TENSOR"] = 2] = "TENSOR";
    OutputFormat[OutputFormat["PROTOBUF"] = 3] = "PROTOBUF";
})(OutputFormat || (exports.OutputFormat = OutputFormat = {}));
//# sourceMappingURL=task.js.map