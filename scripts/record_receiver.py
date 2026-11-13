# Приёмник кадров для записи видео маршрута (см. scripts/record_video.md).
# Принимает кадры записи от страницы (POST /frame?i=N, тело — JPEG) и сохраняет в frames/.
import http.server, os, sys, urllib.parse
OUT = sys.argv[1] if len(sys.argv) > 1 else 'frames'
os.makedirs(OUT, exist_ok=True)
class H(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:8765')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_POST(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if u.path == '/frame':
            open(os.path.join(OUT, '%05d.jpg' % int(q['i'][0])), 'wb').write(body)
        elif u.path == '/done':
            open(os.path.join(OUT, 'DONE'), 'wb').write(body)
        self.send_response(204); self.cors(); self.end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8766), H).serve_forever()
