-- /tmp/he_test.lua — 本地对比测试（不参与部署）
-- 目的：并排跑 v12(备份改名) 与 v13(改名) 两个 controller，比对公共字段是否逐字节相同，
--       并验证 v13 新增字段的类型与"首次 cpu=null"。
package.path = "/tmp/?.lua;/usr/lib/lua/?.lua;/usr/lib/lua/?/init.lua;" .. package.path
require "luci.sys"
local jsonc = require "luci.jsonc"

local buf = {}
local http = require "luci.http"
http.prepare_content = function() end
http.write = function(s) buf[#buf + 1] = tostring(s) end

local function run(name)
	buf = {}
	local ok, m = pcall(require, name)
	if not ok then return "REQUIRE_ERR " .. tostring(m) end
	local ok2, err = pcall(function()
		if m.api_status then
			m.api_status()
		else
			buf[#buf + 1] = jsonc.stringify(m.collect())
		end
	end)
	if not ok2 then return "CALL_ERR " .. tostring(err) end
	return table.concat(buf)
end

print("OLD  " .. run("luci.controller.home_extra_old"))
print("NEW1 " .. run("luci.controller.home_extra_new"))
print("NEW2 " .. run("luci.controller.home_extra_new"))
