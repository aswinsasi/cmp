<?php
function process($data) {
    $nums = json_decode($data, true);
    $sum = array_sum($nums);
    $avg = $sum / count($nums);
    return json_encode(["sum" => $sum, "avg" => $avg, "count" => count($nums)]);
}