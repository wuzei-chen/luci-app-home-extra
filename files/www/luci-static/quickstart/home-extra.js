/* home-extra.js — quickstart 首页增强 V2（2026-10-27, v9）
 * 1) 第一排卡片行整行隐藏（网络向导/NPU 卡不放首页，NPU 信息在状态页）
 * 2) 剔除：官网外链 / 测速 / 商店卡 / NAS 面板 / 网络接口状态
 * 3) 网络流量面板：v11 起恢复原生高度（移除 canvas 钳制，仅保留标题间距微调）
 * 4) 设备流量占比饼图：legend 显示 类型图标 + 品牌 + 主机名；活跃设备 <=1 时退化为单行文本
 *    （v11.1：1KB/s 噪声地板 + 2 次轮询迟滞，抑制单设备态/饼图态来回抖动）
 * 5) 网络连接和IP地址卡片：注入 运营商 / 出口 IP 行（数据 home_extra/status，ip.sb geoip 10min 缓存）
 * 注入通道：main.htm <script src="/luci-static/quickstart/home-extra.js?v=N">
 */
(function () {
	'use strict';
	if (window.__homeExtraInjected) return;
	window.__homeExtraInjected = true;

	var VER = 'v11.1';

	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}
	function copyAttrs(dst, src) {
		for (var i = 0; i < src.attributes.length; i++) {
			var a = src.attributes[i];
			if (/^data-v-/.test(a.name)) dst.setAttribute(a.name, a.value);
		}
	}

	/* ---------- CSS ---------- */
	function injectCss() {
		if (document.getElementById('home-extra-css')) return;
		var s = el('style'); s.id = 'home-extra-css';
		s.textContent = ''
			+ '/* 剔除项 */'
			+ 'a[href*="istoreos.com"]{display:none !important;}'
			+ '.card-container{display:none !important;}'
			+ '/* 网络流量面板：仅微调标题间距，不再压缩图表高度（v11）*/'
			+ '.he-flow-clamp .title_box{margin-bottom:6px !important;}'
			+ '/* 饼图面板 */'
			+ '.he-pie-panel{background:#fff;border-radius:12px;padding:16px 20px;box-sizing:border-box;}'
			+ '.he-pie-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:#333;margin-bottom:12px;}'
			+ '.he-pie-wrap{display:flex;align-items:center;gap:18px;}'
			+ '.he-pie-legend{flex:1;min-width:0;}'
			+ '.he-pie-legend .he-row{display:flex;align-items:center;justify-content:space-between;font-size:13px;'
			+ 'padding:5px 0;border-bottom:1px solid #f2f4f6;}'
			+ '.he-pie-legend .he-row:last-child{border-bottom:0;}'
			+ '.he-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;}'
			+ '.he-host{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;display:inline-block;vertical-align:middle;}'
			+ '.he-vendor{color:#8aa0aa;font-size:12px;margin-right:6px;}'
			+ '/* 饼图单设备/空态：压缩内边距，卡片高度收敛到 100px 以内 */'
			+ '.he-pie-single{padding:10px 16px !important;}'
			+ '.he-pie-single .he-pie-title{margin-bottom:6px !important;}'
			+ '.he-pie-line{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}'
			+ '.he-pie-empty{color:#8aa0aa !important;}'
			+ '/* IP 卡注入行 */'
			+ '.he-wan-row{color:inherit;}';
		document.head.appendChild(s);
	}

	/* ---------- 数据 ---------- */
	function fetchStatus(cb) {
		fetch('/cgi-bin/luci/admin/home_extra/status', { credentials: 'include' })
			.then(function (r) { return r.json(); }).then(cb).catch(function () {});
	}
	function fetchDevices(cb) {
		fetch('/cgi-bin/luci/istore/lanctrl/listDevices/', { credentials: 'include' })
			.then(function (r) { return r.json(); }).then(function (d) {
				cb((d && d.result && d.result.devices) || []);
			}).catch(function () {});
	}

	/* ---------- 品牌精简与类型推断 ---------- */
	var BRAND_MAP = {
		'Intel Corporate': 'Intel',
		'Hui Zhou Gaoshengda Technology Co.,LTD': '兆华电子(ODM)',
		'Apple, Inc.': 'Apple',
		'Xiaomi Communications Co., Ltd': '小米',
		'Huawei Device Co., Ltd': '华为',
		'Huawei Technologies Co.,Ltd': '华为'
	};
	function brand(v) {
		if (!v) return '';
		if (BRAND_MAP[v]) return BRAND_MAP[v];
		var s = v.replace(/(Co\.,?\s?LTD|Inc\.?|Corp(oration)?|Ltd\.?|Technolog(y|ies)|Electronics?|Communications?.*|Networks?|Semiconductor.*|Electronic.*)/gi, ' ')
			.replace(/\s+/g, ' ').trim();
		return s || v;
	}
	function devType(d) {
		var s = ((d.hostname || '') + ' ' + (d.vendor || '')).toLowerCase();
		if (/iphone|android|mi ?phone|phone|mobile|红米|k60|k70/.test(s)) return ['📱', '手机'];
		if (/ipad|pad|tablet/.test(s)) return ['📖', '平板'];
		if (/macbook|notebook|pc|desktop|thinkpad|windows/.test(s)) return ['💻', '电脑'];
		if (/tv|box|投影/.test(s)) return ['📺', '电视'];
		if (/watch|band/.test(s)) return ['⌚', '穿戴'];
		return ['🌐', '设备'];
	}

	/* ---------- 剔除面板 ---------- */
	var HIDE_PANELS = ['磁盘信息', '存储服务', 'Docker', '下载服务', '远程域名', '网络接口状态'];
	function hidePanels() {
		/* 单次全文遍历匹配全部待隐藏标题（v11 性能优化）。等价性：
		 * 旧实现按标题逐个遍历文档，每个标题取"文档序第一个叶子文本匹配项"，
		 * 命中即停止该标题的搜索（即使 closest 取不到卡片也算已命中）。
		 * 这里用 pending 集合在单次遍历中按文档序消费各标题的第一个匹配项，
		 * 命中后同样立即从 pending 移除，故最终隐藏的面板集合与旧实现一致。 */
		var pending = HIDE_PANELS.slice();
		[...document.querySelectorAll('*')].some(function (e) {
			if (pending.length === 0) return true;
			if (e.children.length !== 0) return false;
			var idx = pending.indexOf(e.textContent.trim());
			if (idx === -1) return false;
			pending.splice(idx, 1);
			var card = e.closest('.reusable-card, .network_container, .card, section');
			if (card && !card.classList.contains('he-pie-panel')) {
				card.style.display = 'none';
				card.dataset.heHidden = '1';
			}
			return pending.length === 0;
		});
		document.querySelectorAll('.grid-container').forEach(function (g) {
			var items = [...g.children];
			if (items.length && items.every(function (i) { return getComputedStyle(i).display === 'none' || i.offsetHeight === 0; })) {
				var t = g.closest('.other-container') || g;
				t.style.display = 'none';
				t.dataset.heHidden = '1';
			}
		});
	}

	/* ---------- 网络流量面板：标题间距微调 ----------
	 * v11：删除 canvas 位图钳制。原先直接改 cv.height = 180 会让 echarts 内部坐标系
	 * （实测 749x342）与位图高度不一致，折线被压成多个漂浮尖峰。
	 * 图表高度必须交给 echarts 原生控制；.echart 是 flex:1，CSS 也控不住。
	 * 本函数只负责打 he-flow-clamp 标记，供 .title_box 间距微调使用。
	 */
	function clampFlowChart() {
		var flow = null;
		document.querySelectorAll('.network_container').forEach(function (p) {
			if (!flow && /网络流量/.test(p.textContent)) flow = p;
		});
		if (flow && !flow.classList.contains('he-flow-clamp')) flow.classList.add('he-flow-clamp');
	}

	/* ---------- 设备流量占比饼图 ---------- */
	var PIE_COLORS = ['#0b8fa8', '#3fb8c9', '#7fd3de', '#f2a35e', '#e05c68', '#c9ced4'];
	var pieState = { canvas: null, legend: null };

	function buildPiePanel() {
		if (document.querySelector('.he-pie-panel')) return;
		var ref = null;
		document.querySelectorAll('.network_container').forEach(function (p) {
			if (!ref && /网络流量/.test(p.textContent)) ref = p;
		});
		if (!ref) return;
		var panel = el('div', 'he-pie-panel');
		copyAttrs(panel, ref);
		var title = el('div', 'he-pie-title');
		var ticon = el('span');
		ticon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#0b8fa8" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 3"/></svg>';
		title.appendChild(ticon);
		title.appendChild(el('span', null, '设备流量占比'));
		panel.appendChild(title);
		var wrap = el('div', 'he-pie-wrap');
		var canvas = el('canvas');
		canvas.width = 130; canvas.height = 130;
		canvas.style.cssText = 'width:130px;height:130px;flex:none;';
		var legend = el('div', 'he-pie-legend', '采集设备速率中…');
		wrap.appendChild(canvas); wrap.appendChild(legend);
		panel.appendChild(wrap);
		/* 插到整个左右两栏行之后（不干扰 网络流量 echarts 盒子链）。
		 * 父链任一层取不到就静默放弃，并清掉半成品引用，避免后续在游离节点上绘制。 */
		var host = ref.closest('.left-box') || ref.parentElement;
		var row = host ? host.parentElement : null;
		var cont = row ? row.parentElement : null;
		if (!cont) return;
		pieState.canvas = canvas; pieState.legend = legend;
		cont.insertBefore(panel, row.nextSibling);
		refreshPie();
	}

	/* 单设备态压缩内边距（卡片高度 <= 100px），多设备态还原 */
	function markPieSingle(on) {
		var panel = document.querySelector('.he-pie-panel');
		if (!panel) return;
		if (on) {
			if (!panel.classList.contains('he-pie-single')) panel.classList.add('he-pie-single');
		} else if (panel.classList.contains('he-pie-single')) {
			panel.classList.remove('he-pie-single');
		}
	}

	/* 单设备/空态渲染：隐藏 canvas（无饼图可画），legend 显示一行摘要。
	 * 与 drawPie 成对：drawPie 入口恢复 canvas 显示，本函数隐藏 canvas。 */
	function drawSingle(items) {
		var canvas = pieState.canvas, legend = pieState.legend;
		if (!canvas || !legend) return;
		canvas.style.display = 'none';
		legend.innerHTML = '';
		if (!items.length) {
			legend.appendChild(el('div', 'he-row he-pie-empty', '当前无设备流量'));
			return;
		}
		var it = items[0];
		var parts = [it.speedStr];
		if (it.vendor) parts.push(it.vendor);
		if (it.name) parts.push(it.name);
		var row = el('div', 'he-row');
		var left = el('span', 'he-pie-line');
		left.appendChild(el('span', null, it.icon + ' '));
		left.appendChild(el('span', null, parts.join(' · ')));
		row.appendChild(left);
		legend.appendChild(row);
	}

	function drawPie(items) {
		var canvas = pieState.canvas, legend = pieState.legend;
		if (!canvas || !legend) return;
		var ctx = canvas.getContext ? canvas.getContext('2d') : null;
		if (!ctx) return;
		canvas.style.display = ''; /* 与 drawSingle 的隐藏成对切换 */
		var total = 0;
		items.forEach(function (i) { total += i.rate; });
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (total <= 0) {
			ctx.beginPath();
			ctx.arc(65, 65, 50, 0, Math.PI * 2);
			ctx.strokeStyle = '#e8edf0'; ctx.lineWidth = 16; ctx.stroke();
			legend.innerHTML = '';
			legend.appendChild(el('div', 'he-row', '当前无设备流量'));
			return;
		}
		var ang = -Math.PI / 2;
		items.forEach(function (it, idx) {
			var frac = it.rate / total;
			var a2 = ang + frac * Math.PI * 2;
			ctx.beginPath();
			ctx.moveTo(65, 65);
			ctx.arc(65, 65, 50, ang, a2);
			ctx.closePath();
			ctx.fillStyle = PIE_COLORS[idx % PIE_COLORS.length];
			ctx.fill();
			ang = a2;
		});
		legend.innerHTML = '';
		items.forEach(function (it, idx) {
			var row = el('div', 'he-row');
			var left = el('span');
			var dot = el('span', 'he-dot');
			dot.style.background = PIE_COLORS[idx % PIE_COLORS.length];
			left.appendChild(dot);
			left.appendChild(el('span', null, it.icon + ' '));
			left.appendChild(el('span', 'he-vendor', it.vendor));
			left.appendChild(el('span', 'he-host', it.name));
			row.appendChild(left);
			row.appendChild(el('span', null, it.pct + '% · ' + it.speedStr));
			legend.appendChild(row);
		});
	}

	/* ---------- 形态抖动抑制（v11.1）----------
	 * 瞬时速率会让"有速率的设备数"在 1 <-> 2 之间来回跳（某台设备每隔几秒冒
	 * 100~600 B/s 的后台流量）。如果直接拿瞬时值决定 单设备态 / 饼图态，
	 * 卡片高度会在 74px <-> 194px 之间反复弹（实测 21 秒切 4 次），
	 * 把下面的系统信息卡每几秒顶下去又弹回来。两道闸：
	 *   1) 噪声地板：合计速率低于 1 KB/s 的设备视为噪声，不计入活跃设备；
	 *   2) 迟滞：连续 PIE_SWITCH_HOLD 次轮询都指向新形态才真正切换（3s 轮询 => 约 6s）。
	 */
	var PIE_NOISE_FLOOR = 1024;   /* B/s */
	var PIE_SWITCH_HOLD = 2;      /* 连续命中次数 */
	var pieMode = null;           /* 已生效形态：'single' | 'pie'，null = 尚未确定 */
	var piePendingMode = null;    /* 待确认形态 */
	var piePendingCount = 0;      /* 待确认形态连续命中次数 */

	/* 返回"已生效"形态（可能因迟滞而暂不跟随瞬时值） */
	function resolvePieMode(want) {
		if (pieMode === null || want === pieMode) {
			pieMode = want; piePendingMode = null; piePendingCount = 0;
			return pieMode;
		}
		if (piePendingMode === want) {
			piePendingCount++;
		} else {
			piePendingMode = want; piePendingCount = 1;
		}
		if (piePendingCount >= PIE_SWITCH_HOLD) {
			pieMode = want; piePendingMode = null; piePendingCount = 0;
		}
		return pieMode;
	}

	function refreshPie() {
		if (!document.querySelector('.he-pie-panel') || !document.querySelector('.he-pie-panel').isConnected) {
			pieState.canvas = pieState.legend = null;
			/* 面板重建后形态重新判定，不要带着旧面板的迟滞状态 */
			pieMode = piePendingMode = null; piePendingCount = 0;
			return;
		}
		fetchDevices(function (devices) {
			if (!pieState.canvas) return;
			var items = devices.map(function (d) {
				var ty = devType(d);
				return {
					icon: ty[0],
					vendor: brand(d.vendor),
					name: d.hostname || d.ip || d.mac || '未知设备',
					rate: (Number(d.downloadSpeed) || 0) + (Number(d.uploadSpeed) || 0),
					speedStr: '↓' + (d.downloadSpeedStr || '0') + ' ↑' + (d.uploadSpeedStr || '0')
				};
			}).filter(function (i) { return i.rate >= PIE_NOISE_FLOOR; })
			  .sort(function (a, b) { return b.rate - a.rate; });
			/* 活跃设备 <= 1（含 0）时饼图无意义：退化为单行文本。
			 * 判据是"有速率的设备数"：listDevices 恒返回 5 台（含上游主路由与跨网段
			 * 旧租约），用 devices.length 会让分支永不命中；但也不能直接用瞬时值
			 * （速率会瞬时归零、也会瞬时冒尖），必须过 resolvePieMode 的噪声地板+迟滞。 */
			if (resolvePieMode(items.length <= 1 ? 'single' : 'pie') === 'single') {
				markPieSingle(true);
				drawSingle(items);
				return;
			}
			markPieSingle(false);
			var top = items.slice(0, 5);
			var rest = 0;
			items.slice(5).forEach(function (i) { rest += i.rate; });
			var total = 0; items.forEach(function (i) { total += i.rate; });
			if (rest > 0) top.push({ icon: '🌐', vendor: '', name: '其他设备', rate: rest, pct: Math.max(1, Math.round(rest / total * 100)), speedStr: '' });
			top.forEach(function (i) { i.pct = Math.max(1, Math.round(i.rate / total * 100)); });
			drawPie(top);
		});
	}

	/* ---------- 网络连接和IP地址卡片：注入 运营商/出口IP 行 ---------- */
	var wanDone = false;
	function injectWanRows() {
		if (wanDone) return;
		var titleEl = null;
		[...document.querySelectorAll('*')].some(function (e) {
			if (e.children.length === 0 && e.textContent.trim() === '网络连接和IP地址') { titleEl = e; return true; }
			return false;
		});
		if (!titleEl) return;
		var card = titleEl.closest('.reusable-card, .network_container, .card') || titleEl.parentElement.parentElement;
		var row4 = null;
		[...card.querySelectorAll('*')].some(function (e) {
			if (e.children.length === 0 && /^IPv4/.test(e.textContent.trim())) { row4 = e.closest('div'); return true; }
			return false;
		});
		if (!row4) return;
		var target = row4.parentElement;
		var r1 = el('div', 'he-wan-row');
		r1.style.cssText = 'display:flex;justify-content:space-between;padding:6px 0;font-size:14px;';
		var l1 = el('span', null, '运营商'); l1.style.color = '#666';
		var v1 = el('span', null, '检测中…');
		r1.appendChild(l1); r1.appendChild(v1);
		var r2 = el('div', 'he-wan-row');
		r2.style.cssText = 'display:flex;justify-content:space-between;padding:6px 0;font-size:14px;';
		var l2 = el('span', null, '出口 IP'); l2.style.color = '#666';
		var v2 = el('span', null, '…');
		r2.appendChild(l2); r2.appendChild(v2);
		/* 追加到卡片末尾（DNS 行之后），避免挤进 IPv4 行容器 */
		card.appendChild(r1);
		card.appendChild(r2);
		wanDone = true;
		fetchStatus(function (d) {
			if (d && d.wan && d.wan.ip) {
				v1.textContent = d.wan.isp + (d.wan.city ? '（' + d.wan.city + '）' : '');
				v2.textContent = d.wan.ip;
			} else {
				v1.textContent = '未获取';
				v2.textContent = '未获取';
			}
		});
	}

	/* ---------- 主循环 ---------- */
	function mount() {
		injectCss();
		clampFlowChart();
		hidePanels();
		buildPiePanel();
		injectWanRows();
	}
	function boot() {
		mount();
		setInterval(mount, 2000);
		setInterval(function () {
			if (document.querySelector('.he-pie-panel')) refreshPie();
		}, 3000);
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
