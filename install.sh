#!/bin/sh
# luci-app-home-extra install — 首页爱快骨架基线恢复脚本（v13-v22）
# 前置自检 -> 部署 -> uci-defaults（带断言） -> main.htm 补丁 -> 末置 sha256 自检
BASE=$(dirname "$0")
VERSION=$(cat "$BASE/VERSION" 2>/dev/null || echo 1)
JS_SRC="$BASE/files/www/luci-static/quickstart/home-extra.js"
LUA_SRC="$BASE/files/usr/lib/lua/luci/controller/home_extra.lua"
JS_DST=/www/luci-static/quickstart/home-extra.js
LUA_DST=/usr/lib/lua/luci/controller/home_extra.lua

echo "==> 1/6 前置自检"
[ -s "$JS_SRC" ] || { echo "FATAL: 缺少 $JS_SRC"; exit 1; }
[ -s "$LUA_SRC" ] || { echo "FATAL: 缺少 $LUA_SRC"; exit 1; }
echo "==> 2/6 部署 js + lua"
cp "$JS_SRC" "$JS_DST" || exit 1
cp "$LUA_SRC" "$LUA_DST" || exit 1
chmod 644 "$JS_DST" "$LUA_DST"

echo "==> 3/6 uci-defaults（模块剔除，带断言）"
# uci-defaults：官方模块开关剔除 NAS 类模块（可逆：uci del quickstart.modules 即恢复）
cat > /etc/uci-defaults/40-home-extra << 'UCI'
uci -q del quickstart.modules
uci -q add quickstart modules
uci -q add_list quickstart.@modules[0].module='docker'
uci -q add_list quickstart.@modules[0].module='downloadService'
uci -q add_list quickstart.@modules[0].module='remoteDomain'
uci -q add_list quickstart.@modules[0].module='diskInfo'
UCI
if /etc/init.d/quickstart enabled 2>/dev/null; then
	sh /etc/uci-defaults/40-home-extra || exit 1
fi
rm -f /etc/uci-defaults/40-home-extra
if [ -f /etc/uci-defaults/40-home-extra ]; then
	echo "FATAL: /etc/uci-defaults/40-home-extra 删除失败（异常，需人工排查）"
	exit 1
fi

echo "==> 4/6 main.htm 补丁（?v=$VERSION 防缓存）"
# main.htm 补丁（沿用 pon-card.js 模式：footer 前插脚本 + ?v= 防缓存）
MAIN=/usr/lib/lua/luci/view/quickstart/main.htm
[ -f "$MAIN.orig" ] || cp "$MAIN" "$MAIN.orig"
if ! grep -q 'home-extra.js' "$MAIN"; then
	sed -i 's|<%+footer%>|<script src="/luci-static/quickstart/home-extra.js?v='"$VERSION"'"></script>\n<%+footer%>|' "$MAIN"
	echo "main.htm 补丁已写入"
else
	sed -i 's|home-extra.js?v=[0-9][0-9.]*|home-extra.js?v='"$VERSION"'|' "$MAIN"
	echo "main.htm 补丁已存在，版本参数更新为 v$VERSION"
fi

echo "==> 5/6 清索引缓存 + rpcd 重启"
rm -f /tmp/luci-indexcache*
/etc/init.d/rpcd restart >/dev/null 2>&1

echo "==> 6/6 末置 sha256 自检"
ACT_JS=$(sha256sum "$JS_DST" | awk '{print $1}')
ACT_LUA=$(sha256sum "$LUA_DST" | awk '{print $1}')
EXP_JS=$(sha256sum "$JS_SRC" | awk '{print $1}')
EXP_LUA=$(sha256sum "$LUA_SRC" | awk '{print $1}')
if [ -f "$BASE/SHA256SUMS" ]; then
	SUM_JS=$(grep 'home-extra.js' "$BASE/SHA256SUMS" | awk '{print $1}')
	SUM_LUA=$(grep 'home_extra.lua' "$BASE/SHA256SUMS" | awk '{print $1}')
	[ -n "$SUM_JS" ] && EXP_JS="$SUM_JS"
	[ -n "$SUM_LUA" ] && EXP_LUA="$SUM_LUA"
fi
OK=1
[ "$ACT_JS" != "$EXP_JS" ] && { echo "FATAL: js sha256 不匹配"; echo "  expected: $EXP_JS"; echo "  actual:   $ACT_JS"; OK=0; }
[ "$ACT_LUA" != "$EXP_LUA" ] && { echo "FATAL: lua sha256 不匹配"; echo "  expected: $EXP_LUA"; echo "  actual:   $ACT_LUA"; OK=0; }
[ "$OK" = "1" ] && echo "sha256 自检通过：$ACT_JS / $ACT_LUA" || exit 1
echo "== done (v$VERSION) =="
