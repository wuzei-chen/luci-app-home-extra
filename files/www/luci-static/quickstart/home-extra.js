/* home-extra.js — quickstart 首页增强 V3（2026-10-28, v13）
 * ---------------------------------------------------------------------------
 * v12 既有行为（默认路径，一个像素都不动）：
 * 1) 第一排卡片行整行隐藏（网络向导/NPU 卡不放首页，NPU 信息在状态页）
 * 2) 剔除：官网外链 / 测速 / 商店卡 / NAS 面板 / 网络接口状态
 * 3) 网络流量面板：v11 起恢复原生高度（移除 canvas 钳制，仅保留标题间距微调）
 * 4) 设备流量占比饼图：legend 显示 类型图标 + 品牌 + 主机名；活跃设备 <=1 时退化为单行文本
 *    （v12：1KB/s 噪声地板 + 2 次轮询迟滞，抑制单设备态/饼图态来回抖动）
 * 5) 网络连接和IP地址卡片：注入 运营商 / 出口 IP 行（数据 home_extra/status，ip.sb geoip 10min 缓存）
 *
 * v13 新增（**全部挂在 ?he13=1 开关下，不带该参数时下面的代码一行都不会执行**）：
 * 6) 「爱快骨架」：隐藏原生首排/流量卡/IP 卡/饼图面板/快捷行/系统信息卡（只 display:none，
 *    不 remove 节点 —— 原生 Vue 仍在这些节点上轮询，删节点会让它抛错），
 *    在最前面插入 #he13-root，用 CSS Grid 排 5 个区块：
 *    KPI 行（运行时间 / ARP 可达·租约 / 连接数 / CPU·温度·内存）、左 WAN 卡、右监控占位、
 *    快捷图标网格、底部型号·固件·系统时间。
 * 7) 口径红线：终端数只写「ARP 可达 N · 租约 M」；流量标签一律带「本机」；数字全部来自
 *    home_extra/status 真实字段，不估算。
 *
 * 注入通道：main.htm <script src="/luci-static/quickstart/home-extra.js?v=N">
 */
(function () {
	'use strict';
	if (window.__homeExtraInjected) return;
	window.__homeExtraInjected = true;

	var VER = 'v13';

	/* v13 骨架开关：验收期每次显式带 ?he13=1，不做 cookie/localStorage 持久化 */
	var HE13 = location.search.indexOf('he13=1') >= 0;

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
	/* B/s，低于此视为无实质流量（滤掉 IoT 心跳的百字节级抖动）。
	 * 注意：这道地板同时决定饼图的分母与百分比，低速率设备不再占份额——这是期望行为。 */
	var ACTIVE_FLOOR = 1024;
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

	/* ---------- 形态抖动抑制（v12）----------
	 * 瞬时速率会让"有实质流量的设备数"在 1 <-> 2 之间来回跳（某台 IoT 设备每隔
	 * 几秒冒 100~600 B/s 的心跳流量）。若直接拿瞬时值决定 单设备态 / 饼图态，
	 * 卡片高度会在 74px <-> 194px 之间反复弹（实测 21 秒切 4 次），
	 * 把下面的系统信息卡每几秒顶下去又弹回来。两道闸缺一还会抖：
	 *   1) ACTIVE_FLOOR 噪声地板：低于此速率视为无实质流量，不计入活跃设备；
	 *   2) 形态迟滞：连续 2 轮轮询都指向新形态才真正切换（3s 轮询 => 约 6s）。
	 */
	var pieMode = null;   /* 当前已渲染形态：'single' | 'multi' */
	var piePending = 0;   /* 连续"想做另一种形态"的轮数 */

	function refreshPie() {
		if (!document.querySelector('.he-pie-panel') || !document.querySelector('.he-pie-panel').isConnected) {
			pieState.canvas = pieState.legend = null;
			/* 面板重建后形态重新判定，不要带着旧面板的迟滞状态 */
			pieMode = null; piePending = 0;
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
			}).filter(function (i) { return i.rate >= ACTIVE_FLOOR; })
			  .sort(function (a, b) { return b.rate - a.rate; });
			/* 活跃设备 <= 1（含 0）时饼图无意义：退化为单行文本。
			 * 判据是"有实质流量的设备数"：listDevices 恒返回 5 台（含上游主路由与跨网段
			 * 旧租约），用 devices.length 会让分支永不命中；但也不能直接用瞬时值决定形态，
			 * 速率会瞬时归零、也会瞬时冒尖，所以要走 ACTIVE_FLOOR + 迟滞两道闸。 */
			var want = items.length <= 1 ? 'single' : 'multi';
			if (pieMode === null) {
				pieMode = want; piePending = 0;
			} else if (want !== pieMode) {
				piePending++;
				if (piePending >= 2) { pieMode = want; piePending = 0; }   /* 连续 2 轮才切（约 6s） */
			} else {
				piePending = 0;
			}
			if (pieMode === 'single') {
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

	/* =======================================================================
	 * v13「爱快骨架」—— 仅 ?he13=1 启用（HE13 === false 时以下函数永不调用）
	 * ======================================================================= */

	var HE13_CYAN = '#0b8fa8';

	/* 骨架 CSS：全部规则都以 html.he13 或 #he13-root 限定，不带参数时不注入，
	 * 因此默认路径的样式表与 v12 逐字节一致。 */
	function injectCss13() {
		if (document.documentElement.classList) document.documentElement.classList.add('he13');
		if (document.getElementById('he13-css')) return;
		var s = el('style'); s.id = 'he13-css';
		s.textContent = ''
			/* 隐藏原生块：只 display:none，不 remove（原生 Vue 仍在跑） */
			+ 'html.he13 .card-container,'
			+ 'html.he13 .network-container.align-c,'
			+ 'html.he13 .system,'
			+ 'html.he13 .he-pie-panel{display:none !important;}'
			/* 骨架栅格 */
			+ '#he13-root{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 12px;}'
			+ '#he13-root .he13-card{background:#fff;border-radius:12px;box-sizing:border-box;padding:12px 16px;}'
			+ '#he13-root .he13-kpi{grid-column:1 / -1;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}'
			+ '#he13-root .he13-k{display:flex;flex-direction:column;justify-content:center;height:88px;padding:10px 14px;}'
			+ '#he13-root .he13-k-lab{font-size:12px;color:#8aa0aa;line-height:16px;}'
			+ '#he13-root .he13-k-val{font-size:18px;font-weight:600;color:#1f2d33;line-height:26px;'
			+ 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
			+ '#he13-root .he13-k-sub{font-size:12px;color:#8aa0aa;line-height:16px;'
			+ 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
			/* 卡片标题 */
			+ '#he13-root .he13-t{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600;'
			+ 'color:#1f2d33;margin-bottom:8px;}'
			+ '#he13-root .he13-bar{width:3px;height:14px;border-radius:2px;background:' + HE13_CYAN + ';}'
			+ '#he13-root .he13-tag{font-size:11px;font-weight:500;color:' + HE13_CYAN + ';'
			+ 'background:#e6f4f7;border-radius:8px;padding:1px 7px;}'
			/* 键值行 */
			+ '#he13-root .he13-row{display:flex;align-items:center;justify-content:space-between;'
			+ 'font-size:13px;line-height:26px;}'
			+ '#he13-root .he13-lb{color:#8aa0aa;flex:none;}'
			+ '#he13-root .he13-vl{color:#1f2d33;font-weight:500;max-width:62%;overflow:hidden;'
			+ 'text-overflow:ellipsis;white-space:nowrap;text-align:right;}'
			/* 监控占位（S1 不画图，S2 换 canvas） */
			+ '#he13-root .he13-ph{height:150px;border-radius:10px;border:1px dashed #cfdde4;'
			+ 'background:#f8fbfc;display:flex;align-items:center;justify-content:center;'
			+ 'color:#a8bcc6;font-size:13px;}'
			/* 快捷入口网格 */
			+ '#he13-root .he13-quick{grid-column:1 / -1;padding:10px 16px 12px;}'
			+ '#he13-root .he13-qgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;}'
			+ '#he13-root .he13-q{display:flex;flex-direction:column;align-items:center;justify-content:center;'
			+ 'gap:4px;height:62px;border-radius:10px;background:#f3f7fd;border:1px solid #e8eef4;'
			+ 'cursor:pointer;font-size:12px;color:#33505c;user-select:none;}'
			+ '#he13-root .he13-q:hover{border-color:' + HE13_CYAN + ';color:' + HE13_CYAN + ';}'
			+ '#he13-root .he13-q-ic{display:flex;align-items:center;justify-content:center;height:22px;}'
			+ '#he13-root .he13-q-ic svg{width:22px;height:22px;}'
			+ '#he13-root .he13-q-tx{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
			/* 底部一行 */
			+ '#he13-root .he13-foot{grid-column:1 / -1;display:flex;align-items:center;'
			+ 'justify-content:space-between;font-size:12px;color:#8aa0aa;padding:0 4px;line-height:40px;}'
			+ '#he13-root .he13-foot span{max-width:34%;overflow:hidden;text-overflow:ellipsis;'
			+ 'white-space:nowrap;}'
			/* 窄屏：KPI 两列 */
			+ '@media screen and (max-width:768px){'
			+ '#he13-root{grid-template-columns:1fr;}'
			+ '#he13-root .he13-kpi{grid-template-columns:1fr 1fr;}'
			+ '#he13-root .he13-qgrid{grid-template-columns:repeat(3,1fr);}'
			+ '}';
		document.head.appendChild(s);
	}

	/* 骨架静态结构。注意：终端数文案固定为「ARP 可达 N · 租约 M」，
	 * 页面任何地方都不出现"N 台设备在网"这类口径（旁挂模式看不到家庭终端数，
	 * 只有 ARP 邻居表与 DHCP 租约两份可核实的证据）。 */
	var HE13_HTML = ''
		+ '<div class="he13-kpi">'
		+ '  <div class="he13-card he13-k">'
		+ '    <div class="he13-k-lab">运行时间</div>'
		+ '    <div class="he13-k-val" id="he13-uptime">—</div>'
		+ '    <div class="he13-k-sub">设备已启动</div>'
		+ '  </div>'
		+ '  <div class="he13-card he13-k">'
		+ '    <div class="he13-k-lab">终端</div>'
		+ '    <div class="he13-k-val" id="he13-term">ARP 可达 — · 租约 —</div>'
		+ '    <div class="he13-k-sub">ARP 邻居表 + DHCP 租约</div>'
		+ '  </div>'
		+ '  <div class="he13-card he13-k">'
		+ '    <div class="he13-k-lab">连接数</div>'
		+ '    <div class="he13-k-val" id="he13-conn">—</div>'
		+ '    <div class="he13-k-sub" id="he13-conn-sub">TCP — · UDP — · ICMP —</div>'
		+ '  </div>'
		+ '  <div class="he13-card he13-k">'
		+ '    <div class="he13-k-lab">CPU · 温度 · 内存</div>'
		+ '    <div class="he13-k-val" id="he13-load">—</div>'
		+ '    <div class="he13-k-sub">实时采样</div>'
		+ '  </div>'
		+ '</div>'
		+ '<div class="he13-card">'
		+ '  <div class="he13-t"><span class="he13-bar"></span>WAN 出口</div>'
		+ '  <div class="he13-row"><span class="he13-lb">运营商</span><span class="he13-vl" id="he13-isp">—</span></div>'
		+ '  <div class="he13-row"><span class="he13-lb">出口 IP</span><span class="he13-vl" id="he13-ip">—</span></div>'
		+ '  <div class="he13-row"><span class="he13-lb">接入方式</span><span class="he13-vl">旁挂桥接</span></div>'
		+ '  <div class="he13-row"><span class="he13-lb">运行时间</span><span class="he13-vl" id="he13-ut2">—</span></div>'
		+ '  <div class="he13-row"><span class="he13-lb">本机下行</span><span class="he13-vl" id="he13-rx">—</span></div>'
		+ '  <div class="he13-row"><span class="he13-lb">本机上行</span><span class="he13-vl" id="he13-tx">—</span></div>'
		+ '</div>'
		+ '<div class="he13-card">'
		+ '  <div class="he13-t"><span class="he13-bar"></span>实时速率<span class="he13-tag">本机</span></div>'
		+ '  <div class="he13-ph">图表 S2 实现</div>'
		+ '  <div class="he13-row"><span class="he13-lb">上下行面积图 · 60 点历史</span>'
		+ '<span class="he13-vl he13-lb">S2</span></div>'
		+ '</div>'
		+ '<div class="he13-card he13-quick">'
		+ '  <div class="he13-t"><span class="he13-bar"></span>快捷入口</div>'
		+ '  <div class="he13-qgrid" id="he13-qgrid"></div>'
		+ '</div>'
		+ '<div class="he13-foot">'
		+ '  <span id="he13-model">—</span>'
		+ '  <span id="he13-fw">—</span>'
		+ '  <span id="he13-time">—</span>'
		+ '</div>';

	var he13PrevNet = null;   /* 上一轮 br-lan 累计字节，用于算本机速率 */
	var HE13_QUICK_LABELS = ['内网配置', '终端', '固件更新', 'DNS配置', '软件源配置'];

	function he13Txt(id, text) {
		var e = document.getElementById(id);
		if (e && e.textContent !== text) e.textContent = text;
	}

	/* 0.0 B/s ~ MB/s */
	function he13Rate(v) {
		if (!(v > 0)) return '0 B/s';
		if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB/s';
		if (v >= 1024) return (v / 1024).toFixed(1) + ' KB/s';
		return Math.round(v) + ' B/s';
	}

	function he13Uptime(sec) {
		var s = Math.floor(sec);
		if (!(s > 0)) return '—';
		var d = Math.floor(s / 86400);
		var h = Math.floor((s % 86400) / 3600);
		var m = Math.floor((s % 3600) / 60);
		if (d > 0) return d + '天 ' + h + '小时';
		if (h > 0) return h + '小时 ' + m + '分';
		return m + '分 ' + (s % 60) + '秒';
	}

	/* 挂载点：优先 .page-container（quickstart 页面根），逐级降级，全部取不到就静默返回 */
	function he13Host() {
		return document.querySelector('.page-container')
			|| document.querySelector('.main-right')
			|| document.getElementById('app');
	}

	function he13Build() {
		if (document.getElementById('he13-root')) return true;
		var host = he13Host();
		if (!host) return false;
		var root = el('div');
		root.id = 'he13-root';
		root.innerHTML = HE13_HTML;
		host.insertBefore(root, host.firstChild);
		return true;
	}

	/* 隐藏原生流量卡 + 原生 IP 卡：两者同处一个 .network-container 行。
	 * 用内联 !important（而不是删节点）——原生 Vue 仍在这两个节点上轮询，删了会抛错；
	 * 内联优先级也高于 Vue 的 :style 绑定，不会被它刷回去。 */
	function he13HideNative() {
		var rows = document.querySelectorAll('.network-container');
		for (var i = 0; i < rows.length; i++) {
			var n = rows[i];
			if (n.classList.contains('align-c')) continue;   /* 快捷行由 CSS 规则隐藏 */
			if (n.style.display !== 'none') n.style.setProperty('display', 'none', 'important');
		}
	}

	/* 快捷入口：从原生 Item.vue 渲染出的 .item 上"搬" 5 个入口。
	 * 不移动原节点（避免破坏 Vue 的 vdom 父链），而是克隆图标 + 转发点击：
	 * cell 被点时调用 src.click()，由原生 Vue 的 @click 处理器照常执行，
	 * 因此入口行为、路由、弹窗全部沿用现有实现，没有硬编码链接。 */
	function he13Quick() {
		var grid = document.getElementById('he13-qgrid');
		if (!grid) return;
		if (grid.children.length) return;
		var nodes = [];
		var all = document.querySelectorAll('.item_container .item');
		for (var i = 0; i < all.length; i++) nodes.push(all[i]);
		if (!nodes.length) return;
		var picked = [];
		function take(label) {
			for (var k = 0; k < nodes.length; k++) {
				if (picked.indexOf(nodes[k]) !== -1) continue;
				var t = (nodes[k].textContent || '').replace(/\s+/g, '');
				if (t.indexOf(label) === 0) { picked.push(nodes[k]); return; }
			}
		}
		HE13_QUICK_LABELS.forEach(take);
		for (var j = 0; j < nodes.length && picked.length < 5; j++) {
			if (picked.indexOf(nodes[j]) === -1) picked.push(nodes[j]);
		}
		picked.slice(0, 5).forEach(function (src) {
			var cell = el('div', 'he13-q');
			var ico = el('span', 'he13-q-ic');
			var svg = src.querySelector('svg');
			if (svg) ico.appendChild(svg.cloneNode(true));
			cell.appendChild(ico);
			var label = (src.textContent || '').replace(/\s+/g, ' ').trim();
			cell.appendChild(el('span', 'he13-q-tx', label));
			cell.addEventListener('click', function () {
				try { src.click(); } catch (e) { /* 原入口不存在可点目标则静默 */ }
			});
			grid.appendChild(cell);
		});
	}

	/* 本机速率：用两轮轮询之间 br-lan 累计字节的差值算，首轮没有基线就留 — */
	function he13Rates(net) {
		if (!net || typeof net.rx !== 'number' || typeof net.tx !== 'number') return;
		var now = Date.now();
		if (he13PrevNet && now > he13PrevNet.t) {
			var dt = (now - he13PrevNet.t) / 1000;
			var drx = net.rx - he13PrevNet.rx;   /* 收 = 本机下行 */
			var dtx = net.tx - he13PrevNet.tx;   /* 发 = 本机上行 */
			if (dt > 0 && drx >= 0 && dtx >= 0) {
				he13Txt('he13-rx', he13Rate(drx / dt));
				he13Txt('he13-tx', he13Rate(dtx / dt));
			}
		}
		he13PrevNet = { rx: net.rx, tx: net.tx, t: now };
	}

	/* 刷新骨架数字。数据全部来自 home_extra/status：
	 * cpu 首轮为 null（后端无基线），此处显示 — 而不是 0。 */
	function he13Update() {
		fetchStatus(function (d) {
			if (!d || typeof d !== 'object') return;

			var up = (typeof d.uptime === 'number' && d.uptime > 0) ? he13Uptime(d.uptime) : '—';
			he13Txt('he13-uptime', up);
			he13Txt('he13-ut2', up);

			var arp = (typeof d.clients === 'number') ? String(d.clients) : '—';
			var lea = (typeof d.leases === 'number') ? String(d.leases) : '—';
			he13Txt('he13-term', 'ARP 可达 ' + arp + ' · 租约 ' + lea);

			var c = d.conn;
			if (c && typeof c.total === 'number') {
				he13Txt('he13-conn', String(c.total));
				he13Txt('he13-conn-sub', 'TCP ' + c.tcp + ' · UDP ' + c.udp + ' · ICMP ' + c.icmp);
			}

			var cpu = (typeof d.cpu === 'number') ? 'CPU ' + d.cpu + '%' : 'CPU —';
			var temp = (typeof d.temp === 'number' && d.temp > 0) ? '温度 ' + d.temp + '℃' : '温度 —';
			var mem = '内存 —';
			if (d.mem && d.mem.total > 0) {
				mem = '内存 ' + Math.round((d.mem.total - d.mem.avail) / d.mem.total * 100) + '%';
			}
			he13Txt('he13-load', cpu + ' · ' + temp + ' · ' + mem);

			var w = d.wan;
			if (w && w.ip) {
				he13Txt('he13-isp', (w.isp || '未知') + (w.city ? '（' + w.city + '）' : ''));
				he13Txt('he13-ip', w.ip);
			} else {
				he13Txt('he13-isp', '未获取');
				he13Txt('he13-ip', '未获取');
			}

			he13Rates(d.net);

			if (d.model) he13Txt('he13-model', d.model);
			if (d.firmware) he13Txt('he13-fw', d.firmware);
			if (d.ltime) he13Txt('he13-time', d.ltime);
		});
	}

	/* 每次 mount（2s）跑一遍：建骨架 → 压原生 → 补快捷 → 刷数字。
	 * 全程判空后静默 return，不抛异常打断整页。 */
	function he13Mount() {
		if (!HE13) return;
		injectCss13();
		if (!he13Build()) return;
		he13HideNative();
		he13Quick();
		he13Update();
	}

	/* ---------- 主循环 ---------- */
	function mount() {
		injectCss();
		clampFlowChart();
		hidePanels();
		buildPiePanel();
		injectWanRows();
		if (HE13) he13Mount();   /* 不带 ?he13=1 时这一行什么都不做 */
	}
	function boot() {
		mount();
		setInterval(mount, 2000);
		setInterval(function () {
			if (HE13) return;    /* v13：新骨架不跑 v12 饼图轮询 */
			if (document.querySelector('.he-pie-panel')) refreshPie();
		}, 3000);
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
