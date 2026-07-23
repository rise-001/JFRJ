import base64
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ddddocr


PORT = int(os.environ.get("PORT", "8000"))
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(12 * 1024 * 1024)))
IMAGE_PATTERN = re.compile(r"^data:image/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$", re.IGNORECASE)
OCR = ddddocr.DdddOcr(beta=True, show_ad=False)


class OcrHandler(BaseHTTPRequestHandler):
    server_version = "ddddocr-service/1.0"

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/recognize":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_BODY_BYTES:
                self.send_json(413, {"error": "请求体过大或为空"})
                return
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            match = IMAGE_PATTERN.match(payload.get("image", ""))
            if not match:
                self.send_json(400, {"error": "仅支持 PNG、JPEG 或 WebP 图片"})
                return
            encoded_image = re.sub(r"\s+", "", match.group(1))
            image = base64.b64decode(encoded_image, validate=True)
            if not image:
                self.send_json(400, {"error": "图片内容为空"})
                return
            text = OCR.classification(image)
            self.send_json(200, {"text": str(text or "")})
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "请求数据无效"})
        except Exception as error:
            self.send_json(422, {"error": f"OCR 识别失败：{error}"})

    def log_message(self, message, *args):
        print(f"{self.address_string()} - {message % args}", flush=True)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), OcrHandler)
    print(f"ddddocr 服务已启动：http://0.0.0.0:{PORT}", flush=True)
    server.serve_forever()
