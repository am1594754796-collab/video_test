"""python -m score_qr — listen on the LAN and open the scoring page."""

import webbrowser
import os
from pathlib import Path

from score_qr.app import create_app, get_lan_ip

PORT = 8000
DB_PATH = Path(__file__).resolve().parent / "data" / "scores.db"


def main() -> None:
    lan_ip = get_lan_ip()
    public_base = os.environ.get("SCORE_QR_PUBLIC_BASE") or f"http://{lan_ip}:{PORT}"
    public_only = os.environ.get("SCORE_QR_PUBLIC_ONLY") == "1"
    port = int(os.environ.get("SCORE_QR_PORT", PORT))
    host = "127.0.0.1" if public_only or os.environ.get("SCORE_QR_PUBLIC_BASE") else "0.0.0.0"
    app = create_app(DB_PATH, public_base=public_base, public_only=public_only)
    print(f"本机管理页: http://127.0.0.1:{port}/")
    print(f"局域网管理页: {public_base}/")
    print(f"局域网单人展示: {public_base}/person?slot=1")
    print(f"局域网六人平均分: {public_base}/live")
    print(f"六个评分二维码: {public_base}/qr/1 至 {public_base}/qr/6")
    if os.environ.get("SCORE_QR_NO_BROWSER") != "1":
        webbrowser.open(f"http://127.0.0.1:{port}/")
    app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    main()
