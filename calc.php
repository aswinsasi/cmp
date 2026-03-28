<?php
function process($data) {
    $nums = json_decode($data, true);
    $sum = array_sum($nums);
    $avg = $sum / count($nums);
    $max = max($nums);
    $min = min($nums);
    return json_encode(["sum" => $sum, "avg" => $avg, "max" => $max, "min" => $min]);
}