/* home-extra.js — quickstart 首页增强（2026-10-26, v1）
 * 1) 剔除：iStoreOS官网外链、网络测速卡、应用商店卡（CSS/JS 隐藏，uci 官方开关负责模块行）
 * 2) 新增 NPU 加速卡（克隆官方 feature-card，数据 /cgi-bin/luci/admin/home_extra/status）
 * 3) 新增 设备流量占比 饼图面板（克隆 网络流量 面板，数据 lanctrl/listDevices）
 * 4) 设备管理页：在主机名后追加厂商标签（后端 listDevices 自带 vendor 字段）
 * 注入通道：main.htm 补丁 <script src="/luci-static/quickstart/home-extra.js?v=N">
 */
(function () {
	'use strict';
	if (window.__homeExtraInjected) return;
	window.__homeExtraInjected = true;

	var VER = 'v6';

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
			+ '.card-container .feature-card.skyblue,.card-container .feature-card.orange{display:none !important;}'
			+ '/* NPU 卡 */'
			+ '.he-npu .icon-wrapper{background:linear-gradient(135deg,#0b8fa8,#14b8c4) !important;}'
			+ '.he-npu-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;'
			+ 'background:#e6f6f8;color:#0b8fa8;margin-top:6px;}'
			+ '/* 饼图面板 */'
			+ '.he-pie-panel{background:#fff;border-radius:12px;padding:20px;box-sizing:border-box;}'
			+ '.he-pie-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:#333;margin-bottom:14px;}'
			+ '.he-pie-wrap{display:flex;align-items:center;gap:18px;}'
			+ '.he-pie-legend{flex:1;min-width:0;}'
			+ '.he-pie-legend .he-row{display:flex;justify-content:space-between;font-size:13px;'
			+ 'padding:4px 0;border-bottom:1px solid #f2f4f6;}'
			+ '.he-pie-legend .he-row:last-child{border-bottom:0;}'
			+ '.he-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;}'
			+ '.he-host{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;display:inline-block;vertical-align:middle;}'
			+ '/* 设备页厂商标签 */'
			+ '.he-vendor{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:8px;font-size:11px;'
			+ 'background:#eef4f6;color:#5a7a86;vertical-align:middle;}';
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

	/* ---------- NPU 卡 ---------- */
	var NPU_SVG = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round">'
		+ '<rect x="6" y="6" width="12" height="12" rx="2"/>'
		+ '<rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="#fff" stroke="none"/>'
		+ '<path d="M9 6V3M12 6V3M15 6V3M9 21v-3M12 21v-3M15 21v-3M6 9H3M6 12H3M6 15H3M21 9h-3M21 12h-3M21 15h-3"/>'
		+ '</svg>';

	function buildNpuCard() {
		var ref = document.querySelector('.card-container .feature-card.blue');
		if (!ref || document.querySelector('.feature-card.he-npu')) return;
		var card = ref.cloneNode(true);
		copyAttrs(card, ref);
		card.classList.add('he-npu');
		card.classList.remove('blue');
		card.addEventListener('click', function () {
			location.href = '/cgi-bin/luci/admin/status';
		});
		var t = card.querySelector('.title');
		if (t) t.textContent = 'NPU 加速';
		var sub = card.querySelector('.subtitle');
		if (sub) sub.textContent = 'AI 算力引擎 · 硬件流量卸载';
		var icon = card.querySelector('.icon-wrapper');
		if (icon) icon.innerHTML = NPU_SVG;
		var badge = card.querySelector('.footer .extra.badge');
		if (badge) { badge.innerHTML = ''; badge.appendChild(el('span', 'he-npu-badge', '读取中…')); card.__heBadge = badge.firstChild; }
		ref.parentElement.insertBefore(card, ref.nextSibling);
		updateNpuBadge();
	}
	function updateNpuBadge() {
		var card = document.querySelector('.feature-card.he-npu');
		if (!card || !card.__heBadge) return;
		fetchStatus(function (d) {
			var t = 'NPU 未激活';
			if (d && d.ok && d.npu) {
				t = d.npu.cores + ' 核 · ' + (d.npu.clock ? Math.round(d.npu.clock / 1000000) + 'MHz · ' : '');
				t += d.clients ? d.clients + ' 台在线' : '待机';
			}
			card.__heBadge.textContent = t;
		});
	}

	/* ---------- 剔除 NAS 类面板（后端 module-settings 不认 uci 清单，前端按标题隐藏；可逆） ---------- */
	var HIDE_PANELS = ['磁盘信息', '存储服务', 'Docker', '下载服务', '远程域名'];
	function hidePanels() {
		HIDE_PANELS.forEach(function (t) {
			[...document.querySelectorAll('*')].some(function (e) {
				if (e.children.length !== 0 || e.textContent.trim() !== t) return false;
				var card = e.closest('.reusable-card, .network_container, .card, section');
				if (card && !card.classList.contains('he-pie-panel')) {
					card.style.display = 'none';
					card.dataset.heHidden = '1';
				}
				return true;
			});
		});
		// 格子容器全空则整组隐藏（如 远程域名 独占一格）
		document.querySelectorAll('.grid-container').forEach(function (g) {
			var items = [...g.children];
			if (items.length && items.every(function (i) { return getComputedStyle(i).display === 'none' || i.offsetHeight === 0; })) {
				var t = g.closest('.other-container') || g;
				t.style.display = 'none';
				t.dataset.heHidden = '1';
			}
		});
	}

	/* ---------- 流量饼图 ---------- */
	var PIE_COLORS = ['#0b8fa8', '#3fb8c9', '#7fd3de', '#f2a35e', '#e05c68', '#c9ced4'];
	var pieState = { canvas: null, legend: null };

	function buildPiePanel() {
		if (document.querySelector('.he-pie-panel')) return;
		// 以 网络流量 面板为锚点，取其父容器与 data-v 属性，新建面板（不做克隆手术）
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
		canvas.width = 150; canvas.height = 150;
		canvas.style.cssText = 'width:150px;height:150px;flex:none;';
		var legend = el('div', 'he-pie-legend', '采集设备速率中…');
		wrap.appendChild(canvas); wrap.appendChild(legend);
		panel.appendChild(wrap);
		pieState.canvas = canvas; pieState.legend = legend;
		/* 插到整个左右两栏行之后，避免干扰 网络流量 echarts 的盒子链
		   （echarts resize 正反馈曾把画布撑到数百万 px） */
		var host = ref.closest('.left-box') || ref.parentElement;
		var row = host.parentElement;
		row.parentElement.insertBefore(panel, row.nextSibling);
		refreshPie();
	}

	/* 钳制 网络流量 echarts 画布高度 runaway（resize 正反馈自愈） */
	function clampFlowChart() {
		document.querySelectorAll('.echart canvas').forEach(function (cv) {
			var styleH = parseFloat(cv.style.height) || 0;
			if (cv.height > 1500 || styleH > 1500) {
				var box = cv.parentElement;
				cv.style.height = '300px';
				cv.height = 300;
				if (box) box.style.height = '300px';
				window.dispatchEvent(new Event('resize'));
			}
		});
	}

	function drawPie(items) {
		var canvas = pieState.canvas, legend = pieState.legend;
		if (!canvas || !legend) return;
		var ctx = canvas.getContext('2d');
		var total = 0;
		items.forEach(function (i) { total += i.rate; });
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (total <= 0) {
			ctx.beginPath();
			ctx.arc(75, 75, 60, 0, Math.PI * 2);
			ctx.strokeStyle = '#e8edf0'; ctx.lineWidth = 18; ctx.stroke();
			legend.innerHTML = '';
			legend.appendChild(el('div', 'he-row', '当前无设备流量'));
			return;
		}
		var ang = -Math.PI / 2;
		items.forEach(function (it, idx) {
			var frac = it.rate / total;
			var a2 = ang + frac * Math.PI * 2;
			ctx.beginPath();
			ctx.moveTo(75, 75);
			ctx.arc(75, 75, 60, ang, a2);
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
			left.appendChild(el('span', 'he-host', it.name));
			row.appendChild(left);
			row.appendChild(el('span', null, it.pct + '% · ' + it.speedStr));
			legend.appendChild(row);
		});
	}

	function refreshPie() {
		if (!document.querySelector('.he-pie-panel') || !document.querySelector('.he-pie-panel').isConnected) {
			pieState.canvas = pieState.legend = null;
			return;
		}
		fetchDevices(function (devices) {
			if (!pieState.canvas) return;
			var items = devices.map(function (d) {
				return {
					name: d.hostname || d.ip || d.mac || '未知设备',
					rate: (Number(d.downloadSpeed) || 0) + (Number(d.uploadSpeed) || 0),
					speedStr: '↓' + (d.downloadSpeedStr || '0') + ' ↑' + (d.uploadSpeedStr || '0')
				};
			}).filter(function (i) { return i.rate > 0; })
			  .sort(function (a, b) { return b.rate - a.rate; });
			var top = items.slice(0, 5);
			var rest = 0;
			items.slice(5).forEach(function (i) { rest += i.rate; });
			if (rest > 0) {
				var t = 0; items.forEach(function (i) { t += i.rate; });
				top.push({ name: '其他设备', rate: rest, pct: Math.round(rest / t * 100), speedStr: '' });
			}
			var total = 0; items.forEach(function (i) { total += i.rate; });
			top.forEach(function (i) { i.pct = Math.max(1, Math.round(i.rate / total * 100)); });
			drawPie(top);
		});
	}

	/* ---------- 设备管理页厂商标签 ---------- */
	function tagVendors() {
		if (!/\/devicemanagement/.test(location.pathname)) return;
		fetchDevices(function (devices) {
			var byMac = {};
			devices.forEach(function (d) {
				if (d.mac && d.vendor) byMac[d.mac.toLowerCase()] = d.vendor;
			});
			document.querySelectorAll('td, .el-table__cell').forEach(function (td) {
				if (td.querySelector('.he-vendor') || td.__heTagged) return;
				var m = td.textContent.match(/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/);
				if (!m) return;
				var v = byMac[m[0].toLowerCase()];
				if (!v) return;
				// 品牌精简：取首词，去掉 Corp/Ltd/Technology 等后缀噪音
				var brand = v.replace(/,? (Co\.,?LTD|Inc\.?|Corp(oration)?|Ltd\.?|Technology Co\.,?LTD|Electronics?).*/i, '').trim() || v;
				var chip = el('span', 'he-vendor', brand);
				td.__heTagged = true;
				td.appendChild(chip);
			});
		});
	}

	/* ---------- 主循环 ---------- */
	function mount() {
		injectCss();
		clampFlowChart();
		hidePanels();
		buildNpuCard();
		buildPiePanel();
		tagVendors();
	}
	function boot() {
		mount();
		setInterval(mount, 2000);        // Vue 重建 DOM 后自动补插
		setInterval(function () {        // 饼图 3s 刷新
			if (document.querySelector('.he-pie-panel')) refreshPie();
		}, 3000);
		setInterval(updateNpuBadge, 10000);
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
