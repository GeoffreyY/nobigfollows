var __spreadArrays = (this && this.__spreadArrays) || function () {
    for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
    for (var r = Array(s), k = 0, i = 0; i < il; i++)
        for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
            r[k] = a[j];
    return r;
};
function substring_distance(needle, haystack) {
    var distances = __spreadArrays(Array(needle.length + 2)).map(function (x) { return Array(haystack.length + 2).fill(0); });
    var da = {};
    for (var c = 97; c <= 122; c++) {
        da[String.fromCharCode(c)] = 0;
    }
    var max_dist = needle.length + haystack.length;
    distances[0][0] = max_dist;
    for (var i = 0; i <= needle.length; i++) {
        distances[i + 1][0] = max_dist;
        distances[i + 1][1] = i;
    }
    for (var j = 0; j <= haystack.length; j++) {
        distances[0][j + 1] = max_dist;
        //distances[1][j + 1] = j;
        distances[1][j + 1] = 0;
    }
    for (var i = 1; i <= needle.length; i++) {
        var db = 0;
        for (var j = 1; j <= haystack.length; j++) {
            var k = da[haystack[j - 1]];
            var l = db;
            var cost = 0;
            if (needle[i - 1] == haystack[j - 1]) {
                db = j;
            }
            else {
                cost = 1;
            }
            distances[i + 1][j + 1] = Math.min(distances[i][j] + cost, distances[i + 1][j] + 1, distances[i][j + 1] + 1, distances[k][l] + (i - k - 1) + 1 + (j - l - 1));
        }
        da[needle[i - 1]] = 1;
    }
    //console.log(distances);
    //console.log(distances[needle.length + 1]);
    var distance = needle.length;
    for (var j = 1; j <= haystack.length + 1; j++) {
        distance = Math.min(distance, distances[needle.length + 1][j]);
    }
    return distance;
}
var tests = [
    ["string", "verylongstringwithsomethinginit"],
    ["gifts", "profit"],
    ["aaaaa", "bbbbbbaabaabbbb"],
    ["abaaa", "bbbbbbaabaabbbb"],
];
for (var _i = 0, tests_1 = tests; _i < tests_1.length; _i++) {
    var test = tests_1[_i];
    console.log(test[0], test[1], substring_distance(test[0], test[1]));
}
