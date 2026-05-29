# relay.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, struct

ROBOT_PORT = 30002
STATE_PORT = 30003

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        ip = data.get('ip')
        action = data.get('action', 'send')
        
        # --- NEW ROUTE: Fetch live TCP & Joint data ---
        if action == 'state':
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(1.0)
                    s.connect((ip, STATE_PORT))
                    packet = s.recv(1140) # Read the real-time packet
                    
                    if len(packet) >= 492:
                        # Decode 6 Doubles (48 bytes) at exact binary offsets for UR e-Series
                        joints = struct.unpack('>6d', packet[252:300]) 
                        tcp = struct.unpack('>6d', packet[444:492])    
                        resp = json.dumps({"ok": True, "tcp": tcp, "joints": joints}).encode()
                    else:
                        resp = json.dumps({"ok": False, "error": "Packet too small"}).encode()
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # --- ORIGINAL ROUTE: Send code ---
        else:
            code = data['code'].encode()
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, ROBOT_PORT))
                    s.sendall(code)
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Access-Control-Allow-Origin','*')
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a): pass  # silence logs

if __name__ == '__main__':
    print("Relay running with Real-Time State monitoring on port 5678...")
    HTTPServer(('localhost', 5678), Handler).serve_forever()