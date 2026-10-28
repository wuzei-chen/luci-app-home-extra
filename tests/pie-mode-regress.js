/* pie-mode-regress.js — 设备流量占比「形态抖动抑制」回归护栏
 *
 * 为什么存在：v11 引入的单设备态判据吃瞬时速率，导致卡片高度在 74↔194px 之间
 * 每几秒跳一次（把下方卡片顶 120px，页面总高抖 1491↔1371）。v12 用两道闸修复：
 *   ACTIVE_FLOOR 噪声地板 + 连续 2 轮迟滞。这个文件把那次修复钉住，防止回归。
 *
 * 测试方法：不重写一份等价逻辑去测（那样测绿了也不证明实现对），而是用正则
 * **从 home-extra.js 源码原文里抽出** 常量、filter 判据与迟滞代码块，再在闭包里
 * 用 new Function 跑真代码。测试与实现不可能分叉。
 *
 * 防漂移：开头先断言被测文件的 md5/字节数 == 已部署产物指纹。版本一漂，
 * 这里立刻 FAIL，逼你先确认"线上跑的还是不是这份"，而不是拿旧逻辑测新文件。
 * （教训来源：v11.1→v12 重构后，曾用旧符号名 PIE_NOISE_FLOOR/resolvePieMode
 *   去扫新文件，0 命中险些误判"只有地板没有迟滞"。）
 *
 * 用法：
 *   node tests/pie-mode-regress.js            # 正常跑（校验指纹）
 *   node tests/pie-mode-regress.js --md5=<h>  # 指纹临时覆盖（例如刚部署完新版）
 *   node tests/pie-mode-regress.js --no-pin   # 跳过指纹校验（仅排查用，不用于验收）
 * 退出码：0 全通过 / 1 有失败。
 */
'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

/* 已部署产物指纹 —— 本护栏的防漂移锚点。
 * 来源：2026-10-28 QA 真机复验时，从设备
 *   /www/luci-static/quickstart/home-extra.js 现取 md5sum + wc -c。
 * 有意改动 home-extra.js 之后：先部署，再从设备取新的 md5/bytes 更新这里，
 * 并在 commit message 里写明"已重新部署"。不要为了让它变绿而随手改。 */
var PIN = {
	md5: '7450b5131e0f0010880d9b2deace3ea8',
	bytes: 16827,
	label: "v12 部署产物（main.htm ?v=12，VER='v12'）"
};

var args = process.argv.slice(2);
var argMd5 = (args.filter(function (a) { return /^--md5=/.test(a); })[0] || '').split('=')[1];
var skipPin = args.indexOf('--no-pin') >= 0;

/* 相对本文件定位源码，从仓库根或 tests/ 下运行都一样 */
var SRC = path.resolve(__dirname, '..', 'files', 'www', 'luci-static', 'quickstart', 'home-extra.js');
var src = fs.readFileSync(SRC, 'utf8');
var buf = fs.readFileSync(SRC);
var md5 = crypto.createHash('md5').update(buf).digest('hex');

var pass = 0, fail = 0;
function assert(label, cond, extra) {
	if (cond) { pass++; console.log('PASS | ' + label + (extra ? '  → ' + extra : '')); }
	else { fail++; console.log('FAIL | ' + label + (extra ? '  → ' + extra : '')); }
}

/* ---------- 0. 防漂移：被测文件必须就是已部署的那一份 ---------- */
console.log('===== 0. 防漂移断言（被测源码 == 已部署产物）=====');
console.log('  被测文件: ' + SRC);
assert('字节数 == ' + PIN.bytes, buf.length === PIN.bytes, '实际 ' + buf.length);
if (skipPin) {
	console.log('SKIP | md5 校验（--no-pin，仅排查用，不得用于验收）');
} else {
	var want = argMd5 || PIN.md5;
	assert('md5 == ' + want, md5 === want, '实际 ' + md5);
	if (md5 !== want) {
		console.log('\n>>> 指纹不匹配，先别急着改 PIN。请依次确认：');
		console.log('    1) 这份文件是否已经部署到设备？(设备侧 md5sum 取真值)');
		console.log('    2) 若已部署：用 --md5=<设备真值> 复跑，通过后再更新本文件 PIN 常量；');
		console.log('    3) 若未部署：当前测试结果不能代表线上行为，不能用于验收。');
		console.log('    4) 若符号名已改（如 ACTIVE_FLOOR 改名），抽取环节会报"抽取失败"，需同步本文件。');
	}
}
assert("VER 为 v12 系列（'v12' 或 'v12.x'）", /var VER = 'v12(\.\d+)?';/.test(src),
	(src.match(/var VER = '[^']*';/) || ['未找到'])[0]);
assert('无 v11.1 遗留符号（PIE_NOISE_FLOOR/PIE_SWITCH_HOLD/resolvePieMode）',
	!/PIE_NOISE_FLOOR|PIE_SWITCH_HOLD|resolvePieMode/.test(src));

/* ---------- 抽取：常量 / filter 判据 / 迟滞代码块 ---------- */
var floorLine = (src.match(/var ACTIVE_FLOOR = \d+;/) || [''])[0];
var filterLine = (src.match(/\.filter\(function \(i\) \{ return i\.rate [^\n]*/) || [''])[0];
var hStart = src.indexOf('var want = items.length');
var hEnd = src.indexOf("if (pieMode === 'single')", hStart);
if (!floorLine || !filterLine || hStart < 0 || hEnd < 0) {
	console.log('\nFAIL | 代码块抽取失败 —— 源码结构已变，本护栏必须同步更新后再用于验收');
	console.log('       floorLine=' + JSON.stringify(floorLine) + ' filterLine=' + JSON.stringify(filterLine)
		+ ' hStart=' + hStart + ' hEnd=' + hEnd);
	process.exit(1);
}
var floorVal = Number((floorLine.match(/= (\d+)/) || [])[1]);
var filterExpr = filterLine.replace(/^.*return /, '').split(';')[0];
var block = src.slice(hStart, hEnd).replace(/\s+$/, '');

console.log('\n--- 抽取自部署产物的代码 ---');
console.log('  ' + floorLine);
console.log('  ' + filterLine.trim());
console.log(block.split('\n').map(function (l) { return '  ' + l.replace(/^\t+/, ''); }).join('\n'));
console.log('--- 抽取结束 ---\n');

assert('ACTIVE_FLOOR = 1024（1KB/s 噪声地板）', floorVal === 1024, '实际 ' + floorVal);
assert('filter 用 >= ACTIVE_FLOOR（含等号边界）', /i\.rate >= ACTIVE_FLOOR/.test(filterLine));
assert('迟滞阈值 piePending >= 2（连续 2 轮，约 6s）', /piePending >= 2/.test(block));
assert('pieMode/piePending 在模块作用域', /var pieMode = null;/.test(src) && /var piePending = 0;/.test(src));
assert('面板重建时复位迟滞状态', /pieMode = null; piePending = 0;/.test(src));

/* ---------- 用真代码构造状态机 ---------- */
var filterFn = new Function('i', 'ACTIVE_FLOOR', 'return ' + filterExpr);
function activeCount(rates) {
	return rates.filter(function (r) { return filterFn({ rate: r }, floorVal); }).length;
}

var sim = new Function('counts', [
	'var pieMode = null;',
	'var piePending = 0;',
	'var out = [];',
	'counts.forEach(function (n) {',
	'  var items = new Array(n);',
	'  ' + block.replace(/\n/g, '\n  '),
	'  out.push(pieMode);',
	'});',
	'return out;'
].join('\n'));

var H = { single: 74, multi: 194 };   /* 真机实测卡片高度 */
function heights(modes) { return modes.map(function (m) { return H[m]; }); }
function switches(modes) { var c = 0; for (var i = 1; i < modes.length; i++) if (modes[i] !== modes[i - 1]) c++; return c; }
function spread(hs) { return Math.max.apply(null, hs) - Math.min.apply(null, hs); }

function scenario(title, counts, expectModes, maxSwitch) {
	var modes = sim(counts), hs = heights(modes), sw = switches(modes);
	console.log('\n【' + title + '】');
	console.log('  活跃设备数: [' + counts.join(',') + ']');
	console.log('  形态序列  : [' + modes.join(',') + ']');
	console.log('  卡片高度  : [' + hs.join(',') + ']px');
	console.log('  形态切换  : ' + sw + ' 次   高度跨度: ' + spread(hs) + 'px');
	assert(title + ' 形态序列符合预期', JSON.stringify(modes) === JSON.stringify(expectModes),
		'实际=[' + modes.join(',') + '] 期望=[' + expectModes.join(',') + ']');
	assert(title + ' 切换次数 <= ' + maxSwitch, sw <= maxSwitch, '实际 ' + sw);
	return { modes: modes, switches: sw, spread: spread(hs) };
}

/* ---------- 1. 三态 ---------- */
console.log('===== 1. 三态（1 台 / 2 台 / 0 台）=====');
scenario('A 稳态 1 台（单行，74px）', [1, 1, 1, 1],
	['single', 'single', 'single', 'single'], 0);
scenario('B 稳态 2 台（饼图，194px；pieMode=null 首帧即定型）', [2, 2, 2, 2],
	['multi', 'multi', 'multi', 'multi'], 0);
scenario('C 稳态 0 台（空态，74px）', [0, 0, 0, 0],
	['single', 'single', 'single', 'single'], 0);

/* ---------- 2. 抖动序列（v11 回归的原始现场）---------- */
console.log('\n===== 2. 抖动序列（QA 真机实测的 1↔2 台横跳）=====');
var d = scenario('D 1→2→1→2…（输入变化 7 次）', [1, 2, 1, 2, 1, 2, 1, 2],
	['single', 'single', 'single', 'single', 'single', 'single', 'single', 'single'], 0);
assert('D 高度变化(0) 显著少于输入变化(7)', d.switches === 0 && d.spread === 0,
	'输入变化=7 高度变化=' + d.switches + ' 跨度=' + d.spread + 'px');

/* ---------- 3. 正向能力：迟滞不能把真多设备也挡住 ---------- */
console.log('\n===== 3. 正向能力（迟滞允许的时延）=====');
scenario('E 连续 2 轮 2 台（真多设备，第 2 轮切换）', [1, 2, 2, 2, 2],
	['single', 'single', 'multi', 'multi', 'multi'], 1);
scenario('F 2 台 → 突变 1 台（第 2 轮回落）', [2, 2, 2, 1, 1, 1],
	['multi', 'multi', 'multi', 'multi', 'single', 'single'], 1);

/* ---------- 4. 噪声地板边界（QA 真机口径）---------- */
console.log('\n===== 4. 噪声地板边界（B 设备 0~1536 B/s，A 恒 12KB/s）=====');
[[0, 1], [167, 1], [800, 1], [900, 1], [1023, 1], [1024, 2], [1300, 2], [1536, 2]].forEach(function (c) {
	var n = activeCount([12000, c[0]]);
	assert('B=' + c[0] + ' B/s → 活跃设备数 ' + n, n === c[1], '期望 ' + c[1]);
});

/* ---------- 5. 真实数据组合（现网那台 IoT 心跳）---------- */
console.log('\n===== 5. 真实数据组合（A=12KB/s + B 在 0/167 B/s 抖）=====');
var realCounts = [0, 167, 0, 166, 0, 168, 0, 167].map(function (b) { return activeCount([12000, b]); });
var realModes = sim(realCounts);
console.log('  活跃设备数: [' + realCounts.join(',') + ']');
console.log('  形态序列  : [' + realModes.join(',') + ']');
assert('心跳被地板挡住：0 切换、0 跨度',
	switches(realModes) === 0 && spread(heights(realModes)) === 0,
	'切换=' + switches(realModes) + ' 跨度=' + spread(heights(realModes)) + 'px');

/* ---------- 6. 已知局限（记录用，不是缺陷）---------- */
console.log('\n===== 6. 已知局限：边界设备摆动（900↔1300 B/s，周期 4s）=====');
/* 建模：速率方波 4s 高 / 4s 低，采集每 3s，观察 48s。
 * 4s 的高窗口有时能覆盖 2 个 3s 采集点，"连续 2 轮"成立 → 会切换。
 * QA 真机 mock 同样条件下 48s 内切 3 次，与此模型一致。 */
var beatCounts = [], t;
for (t = 3; t <= 48; t += 3) beatCounts.push((t % 8) >= 4 ? 2 : 1);
var beatModes = sim(beatCounts), beatSw = switches(beatModes);
console.log('  采集点序列: [' + beatCounts.join(',') + ']');
console.log('  形态序列  : [' + beatModes.join(',') + ']');
console.log('  切换次数  : ' + beatSw + '（QA 真机 48s 实测 3 次）');
assert('可复现"边界摆动会切换"这一局限（>=1 次）', beatSw >= 1, '实际 ' + beatSw);
assert('与真机实测同量级（1~6 次）', beatSw >= 1 && beatSw <= 6, '实际 ' + beatSw);
console.log('  → 性质：采样率(3s)与迟滞窗口(2×3s)对 4s 摆动周期的拍频，属设计局限而非实现缺陷。');
console.log('  → 处置：v12 不修（现网该设备稳定 167 B/s，90 秒 0 切换）；v13 面板整块替换，');
console.log('         由二期 conntrack 窗口累计方案根治，此处仅作回归记录。');

/* ---------- 汇总 ---------- */
console.log('\n===== 汇总: PASS=' + pass + ' FAIL=' + fail + ' =====');
if (fail > 0) {
	console.log('HAS_FAILURE');
	process.exit(1);
}
console.log('ALL_PASS');
