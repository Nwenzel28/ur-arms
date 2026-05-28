# relay.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json

ROBOT_PORT = 30002

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        ip   = data['ip']
        code = data['code'].encode()
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(5)
                s.connect((ip, ROBOT_PORT))
                s.sendall(code)
            resp = b'{"ok":true}'
        except Exception as e:
            resp = json.dumps({"ok":False,"error":str(e)}).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Access-Control-Allow-Origin','*')
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a): pass  # silence logs

HTTPServer(('localhost', 5678), Handler).serve_forever()