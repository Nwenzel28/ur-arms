# relay.py — UR3e Relay Server
# Run with: python3 relay.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, struct, time, threading

ROBOT_PORT   = 30002   # URScript injection
STATE_PORT   = 30003   # Real-time client (robot telemetry)
GRIPPER_PORT = 63352   # Robotiq 2F-85 URCap Modbus TCP daemon

# ── 🌟 Global State (Digital Twin) ──────────────────────────────────────
target_ip = None
robot_state = {
    "connected": False,
    "joints": None,
    "tcp": None,
    "gripper": {"ok": False, "gobj": 0, "gobj_label": "Connecting..."}
}

# ── Thread 1: Arm Telemetry (Port 30003) ────────────────────────────────
def state_monitor():
    """Background thread that persistently reads arm telemetry."""
    global target_ip, robot_state
    current_socket = None

    while True:
        if not target_ip:
            time.sleep(0.5)
            continue

        try:
            if current_socket is None:
                print(f"📡 [Arm Monitor] Connecting to {target_ip}:{STATE_PORT}...")
                current_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                current_socket.settimeout(2.0)
                current_socket.connect((target_ip, STATE_PORT))
                current_socket.settimeout(5.0)
                print(f"✅ [Arm Monitor] Connected! Streaming state...")

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
            robot_state['connected'] = False
            if current_socket:
                try: current_socket.close()
                except: pass
                current_socket = None
            time.sleep(1.0)

# ── Thread 2: Gripper Telemetry (Port 63352) ────────────────────────────
def gripper_monitor():
    """Background thread that persistently reads Gripper Modbus telemetry."""
    global target_ip, robot_state
    current_socket = None

    while True:
        if not target_ip:
            time.sleep(0.5)
            continue

        try:
            if current_socket is None:
                print(f"📡 [Gripper Monitor] Connecting to {target_ip}:{GRIPPER_PORT}...")
                current_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                current_socket.settimeout(2.0)
                current_socket.connect((target_ip, GRIPPER_PORT))
                current_socket.settimeout(5.0)
                print(f"✅ [Gripper Monitor] Connected! Polling state at 10Hz...")

            # Request 3 registers (15 bytes) from the Robotiq Modbus server
            current_socket.sendall(gripper_read_packet())
            raw = recv_exact(current_socket, 15)
            
            # Parse it instantly into the RAM dictionary
            robot_state['gripper'] = parse_gripper_status(raw)
            time.sleep(0.1) # Safe 10Hz Modbus polling rate

        except Exception as e:
            robot_state['gripper'] = {"ok": False, "error": "Disconnected"}
            if current_socket:
                try: current_socket.close()
                except: pass
                current_socket = None
            time.sleep(1.0)

# ── Helpers ────────────────────────────────────────────────────────────
def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk: raise ConnectionError("Socket closed")
        buf += chunk
    return buf

def gripper_write_packet(action_byte, position, speed, force):
    data = bytes([action_byte, 0x00, 0x00, position, speed, force])
    pdu  = struct.pack('>BHH', 0x10, 0x03E8, 3) + bytes([6]) + data
    return struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9]) + pdu

def gripper_read_packet():
    pdu  = struct.pack('>BHH', 0x04, 0x07D0, 3)
    return struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9]) + pdu

def parse_gripper_status(raw):
    if len(raw) < 15: return {"ok": False}
    status_byte = raw[9]
    gact = (status_byte >> 0) & 0x01
    gobj = (status_byte >> 6) & 0x03
    gpo  = raw[12]
    return {
        "ok": True, 
        "activated": gact == 1, 
        "gobj": gobj, # 0=Moving, 1=Object(open), 2=Object(close), 3=At target
        "position_raw": gpo
    }

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

        # Execute Actions (Requires temporary socket opening)
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

        elif action == 'gripper_move':
            pos = data.get('pos', 255)
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, GRIPPER_PORT))
                    s.sendall(gripper_write_packet(0x09, pos, 255, 150))
                    recv_exact(s, 12)
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # 🌟 INSTANT RAM READS (Zero Network Overhead)
        elif action in ['state', 'get_position', 'gripper_status']:
            global target_ip
            if ip and target_ip != ip:
                target_ip = ip
                time.sleep(0.2) # Give threads a moment to wake up

            if action == 'gripper_status':
                # Return only gripper data
                resp = json.dumps(robot_state.get('gripper', {"ok": False})).encode()
            else:
                # Return everything
                if robot_state['connected'] and robot_state['joints']:
                    resp = json.dumps({
                        "ok": True,
                        "joints": robot_state['joints'],
                        "tcp": robot_state['tcp'],
                        "cartesian": robot_state['tcp'],
                        "gripper": robot_state.get('gripper', {"ok": False})
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
    
    threading.Thread(target=state_monitor, daemon=True).start()
    threading.Thread(target=gripper_monitor, daemon=True).start()
    
    HTTPServer(('', 5678), Handler).serve_forever()