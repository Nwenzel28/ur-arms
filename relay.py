# relay.py — UR3e Relay Server
# Run with: python3 relay.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, struct, time, threading

ROBOT_PORT     = 30002   # URScript injection
STATE_PORT     = 30003   # Real-time client (robot telemetry)
DASHBOARD_PORT = 29999   # Dashboard server (program state)

# ── 🌟 Global State ─────────────────────────────────────────────────────
target_ip = None
robot_state = {
    "connected": False,
    "joints": None,
    "tcp": None
}

# ── Safe Network Readers ───────────────────────────────────────────────
def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk: raise ConnectionError("Socket unexpectedly closed by robot")
        buf += chunk
    return buf

# ── Thread 1: Arm Telemetry ─────────────────────────────────────────────
def state_monitor():
    global target_ip, robot_state
    current_socket = None
    was_connected = False

    while True:
        if not target_ip:
            time.sleep(0.5)
            continue

        try:
            if current_socket is None:
                if not was_connected:
                    print(f"📡 [Arm] Connecting to telemetry at {target_ip}:{STATE_PORT}...")
                current_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                current_socket.settimeout(2.0)
                current_socket.connect((target_ip, STATE_PORT))
                current_socket.settimeout(5.0)
                print(f"✅ [Arm] Connected! Telemetry streaming.")
                was_connected = True

            size_data = recv_exact(current_socket, 4)
            size = struct.unpack('>i', size_data)[0]
            payload = recv_exact(current_socket, size - 4)

            if size >= 1220:
                robot_state['joints'] = list(struct.unpack('>6d', payload[248:248+48]))
                robot_state['tcp'] = list(struct.unpack('>6d', payload[440:440+48]))
                robot_state['connected'] = True
            else:
                time.sleep(0.01)

        except Exception as e:
            if was_connected:
                print(f"⚠️ [Arm] Connection lost: {type(e).__name__}: {e}")
                was_connected = False
            
            robot_state['connected'] = False
            if current_socket:
                try: current_socket.close()
                except: pass
                current_socket = None
            time.sleep(1.0)

# ── HTTP Handler ───────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)
        data = json.loads(body) if body else {}

        ip = data.get('ip', '')
        action = data.get('action', 'send')
        resp = b'{"ok":false}'

        # ── Send URScript directly to Port 30002 ───────────────────────
        if action == 'send' or action == 'urscript':
            try:
                script = data.get('code', data.get('script', '')) + '\n'
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, ROBOT_PORT))
                    s.sendall(script.encode())
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Check Dashboard Server for Program State ───────────────────
        elif action == 'program_state':
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, DASHBOARD_PORT))
                    # Clear the "Connected: Universal Robots Dashboard Server" welcome message
                    s.recv(1024) 
                    s.sendall(b"programState\n")
                    state_str = s.recv(1024).decode().strip()
                    resp = json.dumps({"ok": True, "state": state_str}).encode()
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Fetch Telemetry State ──────────────────────────────────────
        elif action in ['state', 'get_position']:
            global target_ip
            if ip and target_ip != ip:
                target_ip = ip
                time.sleep(0.2) 

            if robot_state['connected'] and robot_state['joints']:
                resp = json.dumps({
                    "ok": True,
                    "joints": robot_state['joints'],
                    "tcp": robot_state['tcp'],
                    "cartesian": robot_state['tcp']
                }).encode()
            else:
                resp = json.dumps({"ok": False, "error": "Arm telemetry unavailable"}).encode()

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a):
        pass

if __name__ == '__main__':
    print("╔══════════════════════════════════════╗")
    print("║     UR3e Relay  —  localhost:5678    ║")
    print("╚══════════════════════════════════════╝")
    
    # Start arm telemetry thread
    threading.Thread(target=state_monitor, daemon=True).start()
    
    HTTPServer(('', 5678), Handler).serve_forever()