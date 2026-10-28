/* tests/_dom_sim.js — 无浏览器环境下的 home-extra.js 冒烟仿真（内部工具，不部署）
 *
 * 目的：本机没有浏览器/jsdom，用 ~200 行极简 DOM 桩把 home-extra.js 真跑一遍，
 *       验证：?he13=1 时骨架能建、5 个快捷入口能迁、数字能刷、速率能算、全程不抛异常；
 *             不带参数时不创建任何 #he13-root 节点。
 * 用法：node tests/_dom_sim.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'files', 'www', 'luci-static', 'quickstart', 'home-extra.js');

/* ----------------------------- 极简 DOM ----------------------------- */
let ALL = [];

class El {
	constructor(tag) {
		this.tagName = (tag || 'div').toUpperCase();
		this.className = '';
		this.id = '';
		this._text = '';
		this.children = [];
		this.parentNode = null;
		this.dataset = {};
		this.attributes = [];
		this.listeners = {};
		this.width = 0;
		this.height = 0;
		this.style = {
			_own: {},
			setProperty(k, v) { this._own[k] = v; },
			getPropertyValue(k) { return this._own[k] || ''; },
		};
		ALL.push(this);
	}
	get classList() {
		const self = this;
		return {
			add(c) { const s = new Set(self._cls()); s.add(c); self.className = [...s].join(' '); },
			remove(c) { self.className = self._cls().filter(x => x !== c).join(' '); },
			contains(c) { return self._cls().indexOf(c) !== -1; },
		};
	}
	_cls() { return String(this.className || '').split(/\s+/).filter(Boolean); }
	get textContent() {
		return this.children.map(c => c.textContent).join('') + this._text;
	}
	set textContent(v) { this.children = []; this._text = String(v); }
	get innerHTML() { return ''; }
	set innerHTML(html) { this.children = []; this._text = ''; parseInto(this, String(html)); }
	get firstChild() { return this.children[0] || null; }
	get isConnected() { return true; }
	appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
	insertBefore(c, ref) {
		c.parentNode = this;
		const i = ref ? this.children.indexOf(ref) : -1;
		if (i === -1) this.children.push(c); else this.children.splice(i, 0, c);
		return c;
	}
	addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
	click() { (this.listeners.click || []).forEach(fn => fn({})); }
	querySelector(s) { return this.querySelectorAll(s)[0] || null; }
	querySelectorAll(s) { return selectAll(this, s); }
	closest(s) {
		let n = this;
		while (n) { if (matches(n, s)) return n; n = n.parentNode; }
		return null;
	}
	getContext() { return { clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, closePath() {}, fill() {} }; }
	cloneNode(deep) {
		const c = new El(this.tagName);
		c.className = this.className;
		c.id = this.id;
		c._text = this._text;
		c.attributes = this.attributes.slice();
		if (deep) this.children.forEach(ch => c.appendChild(ch.cloneNode(true)));
		return c;
	}
	getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; }
	setAttribute(k, v) { this.attributes.push({ name: k, value: v }); }
}

/* 把 html 片段解析成子树（只支持本文件模板用到的 <div>/<span> 嵌套 + 文本） */
function parseInto(root, html) {
	const stack = [root];
	const re = /<\/?([a-zA-Z]+)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
	let m;
	while ((m = re.exec(html))) {
		if (m[4] != null) {
			const t = m[4];
			if (t.trim()) stack[stack.length - 1]._text += t;
			continue;
		}
		const closing = m[0][1] === '/';
		const tag = m[1];
		if (closing) { if (stack.length > 1) stack.pop(); continue; }
		const el = new El(tag);
		const attrs = m[2] || '';
		const are = /([\w-]+)="([^"]*)"/g;
		let a;
		while ((a = are.exec(attrs))) {
			if (a[1] === 'class') el.className = a[2];
			else if (a[1] === 'id') el.id = a[2];
			el.setAttribute(a[1], a[2]);
		}
		stack[stack.length - 1].appendChild(el);
		if (!m[3]) stack.push(el);
	}
}

function matches(el, sel) {
	return String(sel).split(',').some(one => {
		one = one.trim();
		if (!one) return false;
		const last = one.split(/\s+/).pop();
		if (last === '*') return true;
		if (last[0] === '#') return el.id === last.slice(1);
		if (last[0] === '.') return el.classList.contains(last.slice(1));
		return el.tagName === last.toUpperCase();
	});
}

/* 支持 "a b" 后代选择器与逗号分组，够本文件用 */
function selectAll(root, sel) {
	const groups = String(sel).split(',');
	const out = [];
	const walk = (n) => {
		n.children.forEach(c => { out.push(c); walk(c); });
	};
	walk(root);
	const res = [];
	groups.forEach(g => {
		const parts = g.trim().split(/\s+/).filter(Boolean);
		if (!parts.length) return;
		if (parts.length === 1) {
			if (parts[0] === '*') { out.forEach(e => res.indexOf(e) === -1 && res.push(e)); return; }
			out.forEach(e => { if (matches(e, parts[0]) && res.indexOf(e) === -1) res.push(e); });
			return;
		}
		const anc = parts.slice(0, -1);
		const leaf = parts[parts.length - 1];
		out.forEach(e => {
			if (!matches(e, leaf)) return;
			let n = e.parentNode, ok = true;
			for (let i = anc.length - 1; i >= 0; i--) {
				let found = false;
				while (n) { if (matches(n, anc[i])) { found = true; n = n.parentNode; break; } n = n.parentNode; }
				if (!found) { ok = false; break; }
			}
			if (ok && res.indexOf(e) === -1) res.push(e);
		});
	});
	return res;
}

/* ------------------------- 构造一个假首页 ------------------------- */
function buildPage() {
	ALL = [];
	const html = new El('html');
	const head = new El('head');
	const body = new El('body');
	const page = new El('div'); page.className = 'page-container';

	const header = new El('div'); header._text = 'iStoreOS官网 模块设置';
	page.appendChild(header);

	// 原生流量卡 + IP 卡（同一行）
	const row = new El('div'); row.className = 'network-container';
	const lb = new El('div'); lb.className = 'left-box';
	const flow = new El('div'); flow.className = 'network_container'; flow._text = '网络流量';
	const rc = new El('div'); rc.className = 'right-box';
	const conn = new El('div'); conn.className = 'network_container'; conn._text = '网络连接和IP地址 IPv4 192.168.1.2';
	lb.appendChild(flow); rc.appendChild(conn);
	row.appendChild(lb); row.appendChild(rc);
	page.appendChild(row);

	// 快捷入口行
	const qrow = new El('div'); qrow.className = 'network-container align-c';
	const qlb = new El('div'); qlb.className = 'left-box';
	const cont = new El('div'); cont.className = 'item_container';
	['内网配置', '终端', '固件更新', 'DNS配置', '软件源配置', '日志查看', '系统维护', '沙箱已开启'].forEach(function (t) {
		const it = new El('div'); it.className = 'item';
		it.appendChild(new El('svg'));
		const sp = new El('span'); sp._text = t;
		it.appendChild(sp);
		cont.appendChild(it);
	});
	qlb.appendChild(cont); qrow.appendChild(qlb);
	page.appendChild(qrow);

	// 系统信息卡
	const sys = new El('div'); sys.className = 'system';
	sys.appendChild(new El('div'));
	page.appendChild(sys);

	body.appendChild(page);
	html.appendChild(head); html.appendChild(body);

	const document = {
		documentElement: html,
		head: head,
		body: body,
		readyState: 'complete',
		createElement: t => new El(t),
		getElementById: id => ALL.find(e => e.id === id) || null,
		querySelector: s => selectAll(document.documentElement, s)[0] || null,
		querySelectorAll: s => selectAll(document.documentElement, s),
		addEventListener() {},
	};
	return document;
}

/* ------------------------------ 跑 ------------------------------ */
const PAYLOAD = {
	ok: true,
	npu: { version: 'x', loaded: true, cores: 8, clock: 800000000, offload: 1 },
	mem: { total: 422, avail: 151 },
	load: '0.16 0.26 0.30',
	clients: 5,
	leases: 0,
	dns: '223.5.5.5',
	wan: { ip: '183.247.21.195', isp: 'China Mobile', city: 'Hangzhou' },
	conn: { total: 166, tcp: 93, udp: 73, icmp: 0, other: 2 },
	temp: 71,
	uptime: 161350,
	net: { rx: 520785628, tx: 546193556 },
	model: 'Nokia XG-040G-MD (UBI)',
	firmware: 'PonWrt SNAPSHOT r0-03c1345',
	ltime: '2026-10-28 11:46:58',
	cpu: null,
};

async function runCase(search, label) {
	const document = buildPage();
	const errors = [];
	const timers = [];
	let fetchCount = 0;
	let fakeNow = 1000000;          /* 每次 mount 推进 2000ms，用来验速率换算 */
	const payload = Object.assign({}, PAYLOAD);

	const sandbox = {
		document,
		location: { search: search },
		window: {},
		console,
		Date: { now: () => fakeNow, parse: Date.parse, UTC: Date.UTC },
		Math,
		Number,
		String,
		Object,
		Array,
		JSON,
		Set,
		fetch: function () {
			fetchCount++;
			// 第 n 轮把 br-lan 累计字节推进 20480 / 8192，配合 2s 间隔 => 10.0 KB/s / 4.0 KB/s
			const n = fetchCount - 1;
			const body = JSON.stringify(Object.assign({}, payload, {
				cpu: n === 0 ? null : 4,
				uptime: 161350 + n * 2,
				net: { rx: 520785628 + n * 20480, tx: 546193556 + n * 8192 },
				ltime: '2026-10-28 11:47:0' + n,
			}));
			return Promise.resolve({ json: () => Promise.resolve(JSON.parse(body)) });
		},
		setInterval: function (fn) { timers.push(fn); return timers.length; },
		getComputedStyle: () => ({ display: 'block' }),
	};
	sandbox.window = sandbox;
	sandbox.globalThis = sandbox;

	const flush = () => new Promise(r => setTimeout(r, 10));
	vm.createContext(sandbox);
	const pick = (id) => {
		const e = document.getElementById(id);
		return e ? e.textContent.trim() : null;
	};
	let out = { case: label, root: !!document.getElementById('he13-root') };
	let loadFirst = null;
	try {
		vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'home-extra.js' });
		await flush();                       // 第一轮 mount + fetch 结算
		loadFirst = pick('he13-load');       // 首轮：cpu 为 null，应显示 CPU —
		for (let i = 0; i < 2; i++) {        // 模拟两个 2s 周期
			fakeNow += 2000;
			if (timers[0]) timers[0]();
			await flush();
		}
		out = {
			case: label,
			root: !!document.getElementById('he13-root'),
			uptime: pick('he13-uptime'),
			uptimeWan: pick('he13-ut2'),
			term: pick('he13-term'),
			conn: pick('he13-conn'),
			connSub: pick('he13-conn-sub'),
			load: pick('he13-load'),
			loadFirst: loadFirst,
			isp: pick('he13-isp'),
			ip: pick('he13-ip'),
			rx: pick('he13-rx'),
			tx: pick('he13-tx'),
			model: pick('he13-model'),
			fw: pick('he13-fw'),
			time: pick('he13-time'),
			quickCells: document.querySelectorAll('#he13-qgrid .he13-q').length,
			quickLabels: document.querySelectorAll('#he13-qgrid .he13-q-tx').map(e => e.textContent),
			connRowInlineDisplay: (function () {
				const r = document.querySelector('.network-container');
				return r && r.style ? r.style._own.display : undefined;
			})(),
			htmlHe13Class: document.documentElement.classList.contains('he13'),
			fetchCount: fetchCount,
			// 口径红线：骨架内不得出现 "在线"
			hasOnlineWord: /在线/.test(document.getElementById('he13-root')
				? document.getElementById('he13-root').textContent : ''),
		};
	} catch (e) {
		errors.push(String((e && e.stack) || e));
	}
	return { out, errors };
}

(async () => {
	const off = await runCase('', '默认（无 ?he13=1）');
	console.log(JSON.stringify(off, null, 1));
	console.log('---');
	const on = await runCase('?he13=1', '?he13=1');
	console.log(JSON.stringify(on, null, 1));
})();
