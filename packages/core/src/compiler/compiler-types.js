"use strict";
/**
 * CMP v4.0 — Task Compiler Types
 *
 * Type definitions for the Universal Task Compiler.
 * The compiler auto-detects parallelizable patterns in submitted
 * code and generates execution plans.
 *
 * @module compiler/compiler-types
 * @author Agent Viscro
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_COMPILER_CONFIG = exports.MergeType = exports.ParallelPattern = void 0;
// ─── Parallelization Pattern ───
var ParallelPattern;
(function (ParallelPattern) {
    ParallelPattern["SORT"] = "sort";
    ParallelPattern["MAP"] = "map";
    ParallelPattern["REDUCE"] = "reduce";
    ParallelPattern["FILTER"] = "filter";
    ParallelPattern["SEARCH"] = "search";
    ParallelPattern["MATRIX"] = "matrix";
    ParallelPattern["ML_TRAIN"] = "ml_train";
    ParallelPattern["ML_INFER"] = "ml_infer";
    ParallelPattern["COMPRESS"] = "compress";
    ParallelPattern["HASH"] = "hash";
    ParallelPattern["GENERIC"] = "generic";
})(ParallelPattern || (exports.ParallelPattern = ParallelPattern = {}));
// ─── Merge Strategy ───
var MergeType;
(function (MergeType) {
    MergeType["CONCATENATE"] = "concatenate";
    MergeType["MERGE_SORT"] = "merge_sort";
    MergeType["TREE_REDUCE"] = "tree_reduce";
    MergeType["FILTER_CONCAT"] = "filter_concat";
    MergeType["FIRST_MATCH"] = "first_match";
    MergeType["BLOCK_ASSEMBLE"] = "block_assemble";
    MergeType["GRADIENT_AVERAGE"] = "gradient_average";
    MergeType["RACE_WINNER"] = "race_winner";
})(MergeType || (exports.MergeType = MergeType = {}));
exports.DEFAULT_COMPILER_CONFIG = {
    minInputSizeBytes: 1024, // 1 KB minimum
    maxChunks: 16,
    minConfidence: 0.3,
    defaultElementSize: 4, // float32
};
//# sourceMappingURL=compiler-types.js.map