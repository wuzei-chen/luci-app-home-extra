#!/usr/bin/env python3
# run_all.py — 一键回归入口：依次跑 v16→v22 七套 UI 验收
# 用法：python tests/regress/run_all.py   （退出码 0 = 全绿）
import os
import subprocess
import sys
import time
import json

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
SUITES = ["ui_v16", "ui_v17", "ui_v18", "ui_v19", "ui_v20", "ui_v21", "ui_v22"]

def main():
    rows = []
    all_ok = True
    for name in SUITES:
        script = os.path.join(HERE, name + ".py")
        t0 = time.time()
        proc = subprocess.run([PY, script], capture_output=True, text=True,
                              encoding="utf-8", errors="replace")
        dt = time.time() - t0
        # 摘要 = stdout 最后一行非空文本
        last = ""
        for line in reversed((proc.stdout or "").splitlines()):
            if line.strip():
                last = line.strip()
                break
        ok = proc.returncode == 0
        all_ok = all_ok and ok
        rows.append({"suite": name, "rc": proc.returncode, "ok": ok,
                     "summary": last[:120], "seconds": round(dt, 1)})
        mark = "PASS" if ok else "FAIL"
        print(f"{name:<10} {mark:<5} {dt:>6.1f}s  {last[:100]}")
        if not ok and proc.stderr:
            tail = proc.stderr.strip().splitlines()[-3:]
            for l in tail:
                print("    stderr| " + l[:150])
    print("-" * 60)
    verdict = "ALL GREEN" if all_ok else "HAS FAILURES"
    print(f"verdict: {verdict}")
    try:
        with open(os.path.join(HERE, "_last_run.json"), "w", encoding="utf-8") as f:
            json.dump({"verdict": verdict, "rows": rows}, f, ensure_ascii=False, indent=1)
    except OSError:
        pass
    sys.exit(0 if all_ok else 1)

if __name__ == "__main__":
    main()
