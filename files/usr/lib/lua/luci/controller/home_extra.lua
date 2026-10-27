-- home_extra.lua — quickstart 首页增强后端（2026-10-26）
-- status: NPU 状态 + 内存/负载/在线设备数（供首页 NPU 卡）
module("luci.controller.home_extra", package.seeall)

function index()
	entry({"admin", "home_extra", "status"}, call("api_status")).leaf = true
end

local jsonc = require "luci.jsonc"

local function json_out(tbl)
	luci.http.prepare_content("application/json")
	luci.http.write(jsonc.stringify(tbl))
end

function api_status()
	local out = { ok = false }

	-- NPU：复用 rpcd 后端
	local raw = luci.sys.exec(
		"echo '{\"getStatus\":{}}' | /usr/libexec/rpcd/luci.airoha_npu call getStatus 2>/dev/null")
	local npu = jsonc.parse(raw)
	if type(npu) == "table" and npu.npu_version then
		out.npu = {
			version   = npu.npu_version or "",
			loaded    = npu.npu_loaded or false,
			cores     = npu.npu_cores or 0,
			clock     = npu.npu_clock or 0,
			offload   = npu.offload_total or 0
		}
		out.ok = true
	end

	-- 内存（MB）：luci.sys.meminfo 在本版不存在，直读 /proc/meminfo
	local mi = luci.sys.exec("awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print t, a}' /proc/meminfo 2>/dev/null")
	local t, a = mi:match("(%d+)%s+(%d+)")
	if t then
		out.mem = { total = math.floor(tonumber(t) / 1024), avail = math.floor(tonumber(a) / 1024) }
	end

	-- 负载
	local ld = luci.sys.exec("cut -d' ' -f1-3 /proc/loadavg 2>/dev/null"):gsub("%s+$", "")
	out.load = ld

	-- 在线设备数（br-lan 上 flags=0x2 的 arp 条目）
	local arp = luci.sys.exec(
		"awk '$3==\"0x2\" && $6==\"br-lan\" {n++} END{print n+0}' /proc/net/arp 2>/dev/null")
	out.clients = tonumber(arp:match("%d+")) or 0

	-- DNS（手动配置值）
	out.dns = luci.sys.exec("uci -q get network.lan.dns 2>/dev/null"):gsub("%s+$", "")

	-- WAN 出口信息：出口 IP / 运营商 / 城市（api.ip.sb/geoip，10 分钟缓存）
	local fs = require "nixio.fs"
	local fresh = false
	local st = fs.stat("/tmp/wan_geo.json")
	if st and (os.time() - st.mtime) < 600 then fresh = true end
	local raw = ""
	if fresh then
		raw = luci.sys.exec("cat /tmp/wan_geo.json 2>/dev/null")
	else
		raw = luci.sys.exec("wget -q -O /tmp/wan_geo.json -T 6 'https://api.ip.sb/geoip' 2>/dev/null; cat /tmp/wan_geo.json 2>/dev/null")
	end
	local g = jsonc.parse(raw)
	if type(g) == "table" and g.ip then
		out.wan = { ip = g.ip, isp = g.isp or g.organization or "", city = g.city or "", region = g.region or "" }
	else
		out.wan = { reachable = false }
	end

	json_out(out)
end
