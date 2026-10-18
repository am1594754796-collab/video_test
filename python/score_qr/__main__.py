"""python -m score_qr  — listen on the LAN and open the six QR codes."""

import webbrowser
from pathlib import Path

from score_qr.app import create_app, get_lan_ip

PORT = 8000
DB_PATH = Path(__file__).resolve().parent / "data" / "scores.db"


def main() -> None:
    lan_ip = get_lan_ip()
    public_base = f"http://{lan_ip}:{PORT}"
    app = create_app(DB_PATH, public_base=public_base)
    print(f"本机管理页: http://127.0.0.1:{PORT}")
    print(f"二维码地址: {public_base}/s/<编号>")
    print("手机需与这台电脑在同一 Wi-Fi。若扫码打不开，允许 Python 通过防火墙。")
    webbrowser.open(f"http://127.0.0.1:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)


if __name__ == "__main__":
    main()
