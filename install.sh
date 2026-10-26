#!/bin/sh
# luci-app-home-extra install — 首页增强（NPU 卡/流量饼图/剔除/厂商列）
BASE=$(dirname "$0")
VERSION=$(cat "$BASE/VERSION" 2>/dev/null || echo 1)
echo "== luci-app-home-extra install (v$VERSION) =="

cp "$BASE/files/www/luci-static/quickstart/home-extra.js" /www/luci-static/quickstart/home-extra.js
cp "$BASE/files/usr/lib/lua/luci/controller/home_extra.lua" /usr/lib/lua/luci/controller/home_extra.lua
chmod 644 /www/luci-static/quickstart/home-extra.js /usr/lib/lua/luci/controller/home_extra.lua

# uci-defaults：官方模块开关剔除 NAS 类模块（可逆：uci del quickstart.modules 即恢复）
cat > /etc/uci-defaults/40-home-extra << 'UCI'
uci -q del quickstart.modules
uci -q add quickstart modules
uci -q add_list quickstart.@modules[0].module='docker'
uci -q add_list quickstart.@modules[0].module='downloadService'
uci -q add_list quickstart.@modules[0].module='remoteDomain'
uci -q add_list quickstart.@modules[0].module='diskInfo'
UCI
/etc/init.d/quickstart enabled && sh /etc/uci-defaults/40-home-extra && rm -f /etc/uci-defaults/40-home-extra

# main.htm 补丁（沿用 pon-card.js 模式：footer 前插脚本 + ?v= 防缓存）
MAIN=/usr/lib/lua/luci/view/quickstart/main.htm
[ -f "$MAIN.orig" ] || cp "$MAIN" "$MAIN.orig"
if ! grep -q 'home-extra.js' "$MAIN"; then
	sed -i 's|<%+footer%>|<script src="/luci-static/quickstart/home-extra.js?v='"$VERSION"'"></script>\n<%+footer%>|' "$MAIN"
	echo "main.htm 补丁已写入"
else
	sed -i 's|home-extra.js?v=[0-9]*|home-extra.js?v='"$VERSION"'|' "$MAIN"
	echo "main.htm 补丁已存在，版本参数更新为 v$VERSION"
fi

rm -f /tmp/luci-indexcache*
/etc/init.d/rpcd restart >/dev/null 2>&1
echo "== done =="
