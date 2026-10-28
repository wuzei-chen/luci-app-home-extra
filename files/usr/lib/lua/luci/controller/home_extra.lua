-- home_extra.lua — quickstart 首页增强后端（v19, 2026-10-28）
-- status: NPU / 内存 / 负载 / ARP / DNS / WAN 出口 + conn/temp/cpu/uptime/net/model/firmware/ltime
--         + v19 pon（PON 光链路：模式/光功率/模块温度电压/ONU 状态，来自 ponctl）
--
-- 设计约束（v13）：
--   1) 新增字段全部合并进**一次** awk 调用（read_sysblock），不给 2 秒轮询加 fork；
--      合并后总 exec 次数由 6 降为 4（npu / dns / wan-geo / sysblock）。
--   2) CPU 需要两次采样，纯 io.open 读写 /proc/stat + /tmp，不产生 exec；
--      首次无基线时 cpu 返回 JSON null（不是 0，0 会被误读成"CPU 空闲"）。
--   3) 任何子项失败都不允许整个接口 500：逐项 pcall + 判空，缺哪个就省略/给 null，
--      前端一律有兜底（显示 —）。
module("luci.controller.home_extra", package.seeall)

function index()
	entry({"admin", "home_extra", "status"}, call("api_status")).leaf = true
end

local jsonc = require "luci.jsonc"

-- 本版 luci.jsonc 是 C 模块，**没有** jsonc.null 哨兵：table 里的 nil 会被直接省略，
-- 无法输出裸 null。cpu 首次无基线时规格要求必须是 null（不能是 0，0 会被误读成
-- "CPU 空闲"），所以这里用一个不可能出现在真实数据里的占位串，在序列化后替换成
-- 裸 null。占位串只出现在 api_status 的出口，collect() 内部仍保持 nil 语义。
local NULL_TOKEN = "__he_json_null__"

local function json_out(tbl)
	local body = jsonc.stringify(tbl)
	body = body:gsub('"' .. NULL_TOKEN .. '"', "null")
	luci.http.prepare_content("application/json")
	luci.http.write(body)
end

----------------------------------------------------------------------
-- v13 新增：单次 exec 采集块
----------------------------------------------------------------------

-- 参与合并采集的文件清单（缺文件由 shell 侧 [ -e ] 过滤，awk 不会报错）
local SYS_FILES = table.concat({
	"/proc/net/nf_conntrack",
	"/proc/uptime",
	"/proc/meminfo",
	"/proc/loadavg",
	"/proc/net/arp",
	"/tmp/dhcp.leases",
	"/sys/class/net/br-lan/statistics/rx_bytes",
	"/sys/class/net/br-lan/statistics/tx_bytes",
	"/sys/class/thermal/thermal_zone0/temp",
	"/sys/class/thermal/thermal_zone1/temp",
	"/proc/net/if_inet6",
	"/proc/net/ipv6_route",
	"/tmp/sysinfo/model",
	"/etc/openwrt_release"
}, " ")

-- v20：物理前面板端口。实测 br-lan 的 brif 成员是 dheth0/lan1..lan4，
-- 其中 lan1..lan4 挂在 1fb58000.switch 上（真前面板 4 口）；eth0 是 1fb50000.ethernet
-- 的 CPU 口（10G 内部链路，承载全部交换流量），列出来只会重复计数，故不纳入。
local PORT_NAMES = { "lan1", "lan2", "lan3", "lan4" }

local function port_files()
	local t = {}
	for _, n in ipairs(PORT_NAMES) do
		t[#t + 1] = "/sys/class/net/" .. n .. "/statistics/rx_bytes"
		t[#t + 1] = "/sys/class/net/" .. n .. "/statistics/tx_bytes"
		t[#t + 1] = "/sys/class/net/" .. n .. "/speed"
		t[#t + 1] = "/sys/class/net/" .. n .. "/operstate"
	end
	return table.concat(t, " ")
end

-- 单行 awk 程序：按 FILENAME 分派，一次扫描输出多行结果。
-- 注意：整段被包在 sh 的单引号里，**程序内不得出现单引号**（DISTRIB_DESCRIPTION
-- 的引号由 Lua 侧剥离）。
local SYS_AWK = table.concat({
	'FILENAME=="/proc/net/nf_conntrack"{p=$3;',
	'if(p=="tcp")t++;else if(p=="udp")u++;else if(p=="icmp")i++;else o++;next}',
	'FILENAME=="/proc/uptime"{up=int($1);next}',
	'FILENAME=="/proc/meminfo"{if($1=="MemTotal:")mt=$2+0;',
	'else if($1=="MemAvailable:")ma=$2+0;next}',
	'FILENAME=="/proc/loadavg"{l1=$1;l2=$2;l3=$3;next}',
	'FILENAME=="/proc/net/arp"{if($3=="0x2"&&$6=="br-lan")ar++;next}',
	'FILENAME=="/tmp/dhcp.leases"{if(NF>0)le++;next}',
	'FILENAME ~ /thermal_zone/{v=int($1/1000);if(v>tp)tp=v;next}',
	-- 斜杠的转义要写 **两层**：awk 正则里的 / 必须写成 \/，而这串 awk 源码又是 Lua
	-- 单引号字符串，所以 Lua 源码里得写 \\/（Lua 交出一个 \ 给 awk）。
	-- 踩过的两个坑：写 \/ → Lua 吃掉反斜杠，awk 收到 //br-lan/（空正则，报 Unexpected token）；
	-- 写 [/] → awk 的词法器遇到 / 就收尾，报 bad regex '[': Missing ']'。
	'FILENAME ~ /\\/br-lan\\/statistics\\/rx_bytes$/{rx=$1+0;next}',
	'FILENAME ~ /\\/br-lan\\/statistics\\/tx_bytes$/{tx=$1+0;next}',
	-- v20：前面板四口的 rx/tx/speed/operstate，端口名从路径里剥出来
	'FILENAME ~ /\\/net\\/lan[0-9]+\\/statistics\\/rx_bytes$/{',
	'n=FILENAME;sub(/^.*\\/net\\//,"",n);sub(/\\/.*/,"",n);PRX[n]=$1+0;next}',
	'FILENAME ~ /\\/net\\/lan[0-9]+\\/statistics\\/tx_bytes$/{',
	'n=FILENAME;sub(/^.*\\/net\\//,"",n);sub(/\\/.*/,"",n);PTX[n]=$1+0;next}',
	'FILENAME ~ /\\/net\\/lan[0-9]+\\/speed$/{',
	'n=FILENAME;sub(/^.*\\/net\\//,"",n);sub(/\\/.*/,"",n);PSP[n]=$1+0;next}',
	'FILENAME ~ /\\/net\\/lan[0-9]+\\/operstate$/{',
	'n=FILENAME;sub(/^.*\\/net\\//,"",n);sub(/\\/.*/,"",n);POS[n]=$1;next}',
	'FILENAME=="/tmp/sysinfo/model"{md="";for(q=1;q<=NF;q++)md=md (q>1?" ":"") $q;next}',
	-- v21：IPv6。if_inet6 每行：<32位hex地址> <ifindex> <前缀长度hex> <scope hex> <flags> <dev>
	--       ipv6_route 里默认路由 = dest 全 0 且 destPlen 00，第 5 字段是下一跳、第 10 是出口
	'FILENAME=="/proc/net/if_inet6"{printf "I6 %s %s %s %s\\n",$1,$3,$4,$6;next}',
	'FILENAME=="/proc/net/ipv6_route"{',
	'if($1=="00000000000000000000000000000000"&&$2=="00")printf "R6 %s %s\\n",$5,$10;next}',
	'FILENAME=="/etc/openwrt_release"{if($1 ~ /^DISTRIB_DESCRIPTION=/){',
	'fw=$0;sub(/^DISTRIB_DESCRIPTION=/,"",fw)};next}',
	'END{printf "STAT %d %d %d %d %d %d %d %d %d %d %d %d\\n",',
	't+0,u+0,i+0,o+0,up+0,tp+0,le+0,rx+0,tx+0,mt+0,ma+0,ar+0;',
	'printf "LOAD %s %s %s\\nMODEL %s\\nFW %s\\n",l1,l2,l3,md,fw;',
	'for(k=1;k<=4;k++){p="lan" k;',
	'printf "P %s %d %d %d %s\\n",p,PRX[p]+0,PTX[p]+0,PSP[p]+0,(POS[p]==""?"down":POS[p])}}'
}, "")

-- 组装 shell 命令：先用 shell 内建 for + test 过滤不存在的文件，再交给 awk。
-- 只启动 1 个 awk 进程（for/test 是 ash 内建，不 fork）。
local function sys_cmd()
	return "F=''; for f in " .. SYS_FILES .. " " .. port_files()
		.. '; do [ -e "$f" ] && F="$F $f"; done; '
		.. "awk '" .. SYS_AWK .. "' $F 2>/dev/null"
end

-- v21：/proc/net/if_inet6 给的是 32 位无冒号 hex，这里转成标准写法（含 :: 压缩）。
-- 只做格式转换，不做任何"可用性"推断。
local function hex2v6(h)
	if type(h) ~= "string" or #h ~= 32 or h:match("^%x+$") == nil then return nil end
	local g = {}
	for i = 1, 8 do
		local v = h:sub((i - 1) * 4 + 1, i * 4):gsub("^0+", "")
		if v == "" then v = "0" end
		g[i] = v:lower()
	end
	-- 最长连续全零段（>=2）压成 ::，与 ip -6 addr 的展示一致
	local bestS, bestL, curS, curL = 0, 0, 0, 0
	for i = 1, 8 do
		if g[i] == "0" then
			if curL == 0 then curS = i end
			curL = curL + 1
			if curL > bestL then bestS, bestL = curS, curL end
		else
			curL = 0
		end
	end
	if bestL >= 2 then
		local left = bestS > 1 and table.concat(g, ":", 1, bestS - 1) or ""
		local right = (bestS + bestL) <= 8 and table.concat(g, ":", bestS + bestL, 8) or ""
		if left == "" and right == "" then return "::" end
		if left == "" then return "::" .. right end
		if right == "" then return left .. "::" end
		return left .. "::" .. right
	end
	return table.concat(g, ":")
end

-- 解析 awk 输出。任何一步取不到就返回 nil（调用方逐项降级）。
-- 返回 { tcp, udp, icmp, other, uptime, temp, leases, rx, tx, mem_total, mem_avail,
--        load, model, firmware }
local function read_sysblock()
	local ok, res = pcall(function()
		local line = luci.sys.exec(sys_cmd()) or ""
		local nums = line:match("STAT ([^\n]+)")
		if not nums then return nil end
		local v = {}
		for s in nums:gmatch("%S+") do v[#v + 1] = tonumber(s) or 0 end
		if #v < 12 then return nil end
		local load = line:match("LOAD ([^\n]*)") or ""
		local model = line:match("MODEL ([^\n]*)") or ""
		local firmware = line:match("FW ([^\n]*)") or ""
		-- v20：逐行取 "P lanN rx tx speed operstate"
		local ports = {}
		for nm, prx, ptx, psp, pos in line:gmatch("P (%S+) (%d+) (%d+) (%-?%d+) (%S+)") do
			ports[#ports + 1] = {
				name = nm,
				rx = tonumber(prx) or 0,
				tx = tonumber(ptx) or 0,
				speed = tonumber(psp) or -1,
				up = (pos == "up")
			}
		end
		-- v21：IPv6 三件套。scope 00 = global（ULA fd/fc 也算 global scope，必须排除，
		-- 否则会把内网 ULA 当成"WAN IPv6"报出去）；scope 20 = link。
		local v6 = {}
		for addr, plen, scope, dev in line:gmatch("I6 (%x+) (%x+) (%x+) (%S+)") do
			local s = hex2v6(addr)
			local head = addr:sub(1, 2):lower()
			if s and scope == "00" and head ~= "fd" and head ~= "fc" then
				if not v6.addr then v6.addr, v6.plen, v6.dev = s, tonumber(plen, 16), dev end
			elseif s and scope == "20" and dev == "eth0" and not v6.ll then
				v6.ll = s
			end
		end
		local gw, gwdev = line:match("R6 (%x+) (%S+)")
		if gw and gw:match("^0+$") == nil then
			v6.gw = hex2v6(gw) or nil
			v6.gwdev = gwdev
		end
		return {
			tcp = v[1], udp = v[2], icmp = v[3], other = v[4],
			uptime = v[5], temp = v[6], leases = v[7],
			rx = v[8], tx = v[9],
			mem_total = v[10], mem_avail = v[11], arp = v[12],
			ports = ports,
			v6 = v6,
			load = load:gsub("^%s+", ""):gsub("%s+$", ""),
			model = model:gsub("%s+$", ""),
			-- /etc/openwrt_release 里是 DISTRIB_DESCRIPTION='PonWrt SNAPSHOT r0-xxx'
			-- awk 侧不便处理单引号，这里剥掉首尾引号与空白
			firmware = firmware:gsub("^%s+", ""):gsub("%s+$", ""):gsub("^'", ""):gsub("'$", ""),
		}
	end)
	if ok then return res end
	return nil
end

----------------------------------------------------------------------
-- v13 新增：CPU 两次采样（零 exec）
----------------------------------------------------------------------

local CPU_STAT = "/tmp/home_extra_cpu.stat"

-- 读 /proc/stat 的 "cpu " 汇总行，返回 total, idle（idle 含 iowait，惯例口径）
local function read_cpu_stat()
	local f = io.open("/proc/stat", "r")
	if not f then return nil end
	local line = f:read("*l")
	f:close()
	if not line or line:sub(1, 4) ~= "cpu " then return nil end
	local n = {}
	for s in line:gmatch("%d+") do n[#n + 1] = tonumber(s) end
	if #n < 5 then return nil end
	local idle = n[4] + n[5]                    -- idle + iowait
	local total = idle
	for k = 1, math.min(#n, 8) do
		if k ~= 4 and k ~= 5 then total = total + n[k] end
	end
	return total, idle
end

-- 返回整数百分比；首次无基线返回 nil（序列化成 null）
local function read_cpu()
	local ok, pct = pcall(function()
		local total, idle = read_cpu_stat()
		if not total or not idle then return nil end
		local prev_t, prev_i
		local pf = io.open(CPU_STAT, "r")
		if pf then
			local s = pf:read("*l")
			pf:close()
			if s then
				local a, b = s:match("(%d+)%s+(%d+)")
				if a and b then prev_t, prev_i = tonumber(a), tonumber(b) end
			end
		end
		-- 无论本次能否算出结果，都立刻刷新基线（下次调用才是"上一次样本"）
		local wf = io.open(CPU_STAT, "w")
		if wf then
			wf:write(string.format("%.0f %.0f\n", total, idle))
			wf:close()
		end
		if not prev_t or not prev_i then return nil end   -- 首次调用：null
		local dt = total - prev_t
		local di = idle - prev_i
		if dt <= 0 or di < 0 then return nil end
		local p = (dt - di) * 100 / dt
		if p < 0 then p = 0 elseif p > 100 then p = 100 end
		return math.floor(p + 0.5)
	end)
	if ok then return pct end
	return nil
end

----------------------------------------------------------------------
-- 主采集：返回可序列化 table（不做 http 输出，便于 lua -e 直测）
----------------------------------------------------------------------

function collect()
	local out = { ok = false }

	-- NPU：复用 rpcd 后端
	pcall(function()
		local raw = luci.sys.exec(
			"echo '{\"getStatus\":{}}' | /usr/libexec/rpcd/luci.airoha_npu call getStatus 2>/dev/null")
		local npu = jsonc.parse(raw)
		if type(npu) == "table" and npu.npu_version then
			out.npu = {
				version = npu.npu_version or "",
				loaded  = npu.npu_loaded or false,
				cores   = npu.npu_cores or 0,
				clock   = npu.npu_clock or 0,
				offload = npu.offload_total or 0
			}
			out.ok = true
		end
	end)

	-- 合并采集块（1 次 exec）
	local sb = read_sysblock()

	-- 内存（MB）：luci.sys.meminfo 在本版不存在，直读 /proc/meminfo
	if sb and sb.mem_total and sb.mem_avail and sb.mem_total > 0 and sb.mem_avail > 0 then
		out.mem = {
			total = math.floor(sb.mem_total / 1024),
			avail = math.floor(sb.mem_avail / 1024)
		}
	end

	-- 负载（"0.35 0.30 0.25"）
	if sb then out.load = sb.load or "" end

	-- ARP 可达数（br-lan 上 flags=0x2 的 arp 条目）
	if sb then out.clients = sb.arp or 0 end

	-- DNS（手动配置值）
	local dns = ""
	pcall(function()
		dns = luci.sys.exec("uci -q get network.lan.dns 2>/dev/null"):gsub("%s+$", "")
	end)
	out.dns = dns

	-- WAN 出口信息（v21）：出口 IP / 运营商 / 城市。
	-- 三级兜底：myip.ipip.net（纯文本，中文省市+运营商）→ ipinfo.io/json（英文）
	--         → api.ip.sb/geoip。
	-- 起因：2026-10-28 实测 api.ip.sb 连续返回 0 字节，卡片变成「未获取」——单一数据源
	-- 一挂整块就空，所以改成链式兜底。
	-- 缓存 /tmp/wan_geo.json：成功 600s；失败只等 60s 再试（写空文件刷新 mtime 即退避），
	-- 避免断网时每 2 秒打一次外网。
	pcall(function()
		local fs = require "nixio.fs"
		local st = fs.stat("/tmp/wan_geo.json")
		local age = st and (os.time() - st.mtime) or 99999
		local cached = nil
		if st then
			local g = jsonc.parse(fs.readfile("/tmp/wan_geo.json") or "")
			if type(g) == "table" and g.ip then cached = g end
		end
		if cached and age < 600 then
			out.wan = { ip = cached.ip, isp = cached.isp or "", city = cached.city or "",
				region = cached.region or "" }
			return
		end
		if not cached and age < 60 then
			out.wan = { reachable = false }
			return
		end

		local got = nil
		-- 1) ipip.net：中文，形如「当前 IP：1.2.3.4  来自于：中国 浙江 杭州  移动」
		-- 坑：Lua 的字符类按**字节**工作，把全角冒号写进 [：] 只会匹配其中一个字节，
		-- 整个模式必然失配。所以这里一律"先抓 IPv4，再按空白切词，最后用明文 search 去标签"。
		local txt = luci.sys.exec("wget -q -O- -T 6 'http://myip.ipip.net' 2>/dev/null")
		local ip = txt:match("(%d+%.%d+%.%d+%.%d+)")
		if ip then
			local rest = txt:sub(select(2, txt:find(ip, 1, true)) + 1)
			local toks = {}
			for s in rest:gmatch("%S+") do toks[#toks + 1] = s end
			-- 首词是「来自于：中国」，把标签连同冒号（半角/全角）切掉
			if toks[1] then
				local a, b = toks[1]:find("：", 1, true), toks[1]:find(":", 1, true)
				if a and (not b or a < b) then toks[1] = toks[1]:sub(a + 3)
				elseif b then toks[1] = toks[1]:sub(b + 1) end
			end
			local n = #toks
			if n >= 2 then
				got = { ip = ip, isp = toks[n], city = toks[n - 1],
					region = n >= 3 and toks[n - 2] or "" }
			end
		end
		-- 2) ipinfo.io（JSON，字段：ip / org / city / region）
		if not got then
			local g = jsonc.parse(luci.sys.exec("wget -q -O- -T 6 'https://ipinfo.io/json' 2>/dev/null"))
			if type(g) == "table" and g.ip then
				got = { ip = g.ip, isp = g.org or "", city = g.city or "", region = g.region or "" }
			end
		end
		-- 3) api.ip.sb（原主源，保留作最后兜底）
		if not got then
			local g = jsonc.parse(luci.sys.exec("wget -q -O- -T 6 'https://api.ip.sb/geoip' 2>/dev/null"))
			if type(g) == "table" and g.ip then
				got = { ip = g.ip, isp = g.isp or g.organization or "", city = g.city or "",
					region = g.region or "" }
			end
		end

		local w = io.open("/tmp/wan_geo.json", "w")
		if w then
			if got then w:write(jsonc.stringify(got)) end   -- 失败写空文件，只为刷新 mtime
			w:close()
		end
		out.wan = got or { reachable = false }
	end)
	if not out.wan then out.wan = { reachable = false } end

	------------------------------------------------------------------
	-- v13 新增字段
	------------------------------------------------------------------
	if sb then
		-- 连接数：total 定义为 tcp+udp+icmp 之和（保证"拆分之和 == 总数"恒等式）；
		-- other 单列给出（GRE 等其它协议），不并入 total，避免恒等式失真。
		out.conn = {
			total = sb.tcp + sb.udp + sb.icmp,
			tcp   = sb.tcp,
			udp   = sb.udp,
			icmp  = sb.icmp,
			other = sb.other
		}
		if sb.temp and sb.temp > 0 then out.temp = sb.temp end       -- ℃，thermal/1000
		if sb.uptime and sb.uptime > 0 then out.uptime = sb.uptime end -- 秒
		out.leases = sb.leases or 0                                   -- /tmp/dhcp.leases 行数
		out.net = { rx = sb.rx or 0, tx = sb.tx or 0 }                -- br-lan 累计字节
		-- v20：前面板 lan1..lan4 的累计字节/协商速率/链路状态（速率由前端按差值算）
		if sb.ports and #sb.ports > 0 then out.ports = sb.ports end
		-- v21：IPv6（全局地址 / 默认网关 / eth0 链路本地），三个都缺就整块省略
		if sb.v6 and (sb.v6.addr or sb.v6.gw or sb.v6.ll) then out.ipv6 = sb.v6 end
		if sb.model and sb.model ~= "" then out.model = sb.model end
		if sb.firmware and sb.firmware ~= "" then out.firmware = sb.firmware end
	end

	-- CPU：首次无基线 -> nil（对外由 api_status 输出裸 null，不是 0）
	out.cpu = read_cpu()

	------------------------------------------------------------------
	-- v19 新增：PON 光链路（ponctl 走 generic netlink，实测单次 < 10ms）
	------------------------------------------------------------------
	-- 字段口径全部来自 ponctl status --json 的原始输出，不做任何推算：
	--   frontend.rx_power_dbm / tx_power_dbm / temperature_celsius / voltage_volts / tx_bias_ma
	--   line.optical_signal (bool) / lifecycle / active_mode / xgtc_sync / phy_ready
	--   registration.onu_state（G.984 的 O1..O7）
	-- 注意：无光时模组给出的是 -40.0 dBm 的**哨兵值**，不是真实测量值；
	-- 前端必须结合 optical_signal 判读，不能把 -40 当"信号很弱"显示。
	pcall(function()
		local raw = luci.sys.exec("ponctl --device pon0 status --json 2>/dev/null")
		local p = jsonc.parse(raw)
		if type(p) ~= "table" then return end
		local fe = type(p.frontend) == "table" and p.frontend or {}
		local ln = type(p.line) == "table" and p.line or {}
		local rg = type(p.registration) == "table" and p.registration or {}
		if not (ln.active_mode or ln.lifecycle or fe.temperature_celsius) then return end
		out.pon = {
			mode   = ln.active_mode or ln.configured_mode or "",
			life   = ln.lifecycle or "",
			signal = ln.optical_signal and true or false,
			syncs  = ln.xgtc_sync or "",
			phy    = ln.phy_ready and true or false,
			onu    = rg.onu_state or "",
			rx     = tonumber(fe.rx_power_dbm),
			tx     = tonumber(fe.tx_power_dbm),
			temp   = tonumber(fe.temperature_celsius),
			volt   = tonumber(fe.voltage_volts),
			bias   = tonumber(fe.tx_bias_ma),
			cal    = fe.calibration or ""
		}
	end)

	-- 系统时间（路由器本地时间，零成本）
	out.ltime = os.date("%Y-%m-%d %H:%M:%S")

	return out
end

function api_status()
	local out = collect()
	if out.cpu == nil then out.cpu = NULL_TOKEN end   -- 唯一需要显式 null 的字段
	json_out(out)
end
