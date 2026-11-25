#!/usr/bin/env python3
"""ニューキングハナハナV-30 設定判別 — ローカル管理サーバー

127.0.0.1:8935 で静的ファイルを配信しつつ、管理者ローカルモード用の
軽量API（/api/*）を提供する。外部公開は GitHub Pages が担うため、
このサーバーはローカル専用（127.0.0.1 バインド）で動作する。
"""
import json
import os
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = 8935
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_URL = "https://mopfyyi99201-ui.github.io/newking-hanahana-v30/"
LOG = "/tmp/hanahana_admin.log"


def _log(msg: str) -> None:
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except OSError:
        pass


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE_DIR, **kw)

    # ---------- helpers ----------
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def log_message(self, fmt, *args):  # 静かにログファイルへ
        _log("%s - %s" % (self.address_string(), fmt % args))

    # ---------- routing ----------
    def do_GET(self):
        if self.path == "/api/status":
            self._json({"ok": True, "running": True, "port": PORT,
                        "public": PUBLIC_URL})
            return
        if self.path == "/api/public-url":
            self._json({"url": PUBLIC_URL})
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        if path == "/api/restart":
            self._json({"ok": True, "restarting": True})
            threading.Thread(target=self._restart, daemon=True).start()
            return
        if path == "/api/stop":
            self._json({"ok": True, "stopping": True})
            threading.Thread(target=self._shutdown, daemon=True).start()
            return
        if path == "/api/push":
            self._handle_push()
            return
        self._json({"ok": False, "error": "not found"}, 404)

    # ---------- actions ----------
    def _restart(self):
        # 新プロセスを先に起こしてから自分は終了（ポート引き継ぎ）
        try:
            subprocess.Popen(
                [sys.executable, os.path.abspath(__file__)],
                cwd=BASE_DIR,
                stdout=open(LOG, "ab"), stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except Exception as e:
            _log("restart spawn failed: %r" % e)
        import time
        time.sleep(0.4)
        os._exit(0)

    def _shutdown(self):
        import time
        time.sleep(0.3)
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def _handle_push(self):
        self._read_body()
        try:
            st = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=BASE_DIR, capture_output=True, text=True, timeout=15)
            dirty = bool(st.stdout.strip())
            steps = []
            if dirty:
                subprocess.run(
                    ["git", "add", "-A", "--", ".", ":!*.zacbak"],
                    cwd=BASE_DIR, capture_output=True, text=True, timeout=15)
                msg = "Local admin update %s" % \
                    __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M")
                cm = subprocess.run(
                    ["git", "-c", "user.name=HanahanaAdmin",
                     "-c", "user.email=admin@localhost",
                     "commit", "-m", msg],
                    cwd=BASE_DIR, capture_output=True, text=True, timeout=20)
                steps.append(("commit", cm.returncode, (cm.stdout + cm.stderr)[-400:]))
            else:
                steps.append(("commit", 0, "no changes"))
            ps = subprocess.run(
                ["git", "push", "origin", "main"],
                cwd=BASE_DIR, capture_output=True, text=True, timeout=60)
            steps.append(("push", ps.returncode, (ps.stdout + ps.stderr)[-400:]))
            ok = all(rc == 0 for _, rc, _ in steps)
            self._json({"ok": ok, "steps": [
                {"name": n, "code": rc, "out": o} for n, rc, o in steps]})
        except Exception as e:
            self._json({"ok": False, "error": repr(e)}, 500)


def main():
    os.chdir(BASE_DIR)
    # 再起動時は旧プロセスのポート解放を待つためリトライする
    import time
    httpd = None
    for _ in range(50):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
            break
        except OSError:
            time.sleep(0.2)
    if httpd is None:
        _log("failed to bind port %d" % PORT)
        sys.exit(1)
    _log("admin_server start port=%d" % PORT)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
