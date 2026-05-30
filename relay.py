# relay.py — UR3e Relay Server
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, struct, time

ROBOT_PORT   = 30002   # URScript injection
STATE_PORT   = 30003   # Real-time client (robot telemetry)
GRIPPER_PORT = 63352   # Robotiq 2F-85 URCap Modbus TCP daemon

# Global telemetry state (updated by background thread)
robot_state = {
    "connected": False,
    "q_actual": [0.0] * 6,
    "TCP_pose": [0.0] * 6
}
telemetry_thread_running = False

# ── Reliable socket reader ─────────────────────────────────────────────
def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError(f"Socket closed after {len(buf)}/{n} bytes")
        buf += chunk
    return buf

# ── Background Telemetry Thread (Fixes Socket Exhaustion) ──────────────
def telemetry_thread(ip):
    global robot_state, telemetry_thread_running
    while telemetry_thread_running:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(3.0)
                s.connect((ip, STATE_PORT))
                robot_state["connected"] = True
                while telemetry_thread_running:
                    # Read UR packet size (4 bytes)
                    size_data = recv_exact(s, 4)
                    size = struct.unpack('>i', size_data)[0]
                    payload = recv_exact(s, size - 4)
                    
                    # e-Series packets are usually 1220 bytes. 
                    # q_actual is at byte 252 (248 in payload)
                    # TCP_pose is at byte 444 (440 in payload)
                    if size >= 1220:
                        robot_state["q_actual"] = list(struct.unpack('>6d', payload[248:248+48]))
                        robot_state["TCP_pose"] = list(struct.unpack('>6d', payload[440:440+48]))
        except Exception as e:
            robot_state["connected"] = False
            time.sleep(1) # Wait before reconnecting

# ── Gripper Modbus TCP ────────────────────────────────────────────────
def gripper_write_packet(action_byte, position, speed, force):
    data = bytes([action_byte, 0x00, 0x00, position, speed, force])
    pdu  = struct.pack('>BHH', 0x10, 0x03E8, 3) + bytes([6]) + data
    mbap = struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9])
    return mbap + pdu

def gripper_read_packet():
    pdu  = struct.pack('>BHH', 0x04, 0x07D0, 3)
    mbap = struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9])
    return mbap + pdu

def parse_gripper_status(raw):
    if len(raw) < 15: return {"ok": False}
    status_byte = raw[9]
    gact = (status_byte >> 0) & 0x01
    gobj = (status_byte >> 6) & 0x03
    gpo  = raw[12]
    pos_mm = round((1.0 - gpo / 255.0) * 85.0, 1)
    gobj_labels = ['Moving', 'Obj @ open', 'Obj @ close', 'At position']
    return {
        "ok": True, "activated": gact == 1, "gobj": gobj, 
        "gobj_label": gobj_labels[gobj], "object_detected": gobj in [1, 2], 
        "position_raw": gpo, "position_mm": pos_mm
    }

# ── HTTP Handler ───────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        global telemetry_thread_running
        body = self.rfile.read(int(self.headers['Content-Length']))
        data = json.loads(body)
        ip = data.get('ip', '')
        action = data.get('action', 'send')
        resp = b'{"ok":false}'

        # Start telemetry thread if it isn't running yet
        if ip and not telemetry_thread_running:
            telemetry_thread_running = True
            threading.Thread(target=telemetry_thread, args=(ip,), daemon=True).start()

        if action == 'send':
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, ROBOT_PORT))
                    s.sendall(data['code'].encode())
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        elif action == 'state':
            # Instantly return the background thread's latest data!
            resp = json.dumps({"ok": True, "joints": robot_state["q_actual"], "tcp": robot_state["TCP_pose"]}).encode()

        elif action == 'gripper_move':
            # Send Modbus binary directly to port 502
            pos = data.get('pos', 255)
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, GRIPPER_PORT))
                    s.sendall(gripper_write_packet(0x09, pos, 255, 150)) # 0x09 = Activate & Go
                    recv_exact(s, 12)
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        elif action == 'gripper_status':
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, GRIPPER_PORT))
                    s.sendall(gripper_read_packet())
                    raw = recv_exact(s, 15)
                resp = json.dumps(parse_gripper_status(raw)).encode()
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()
        
        elif action == 'set_freedrive_register':
            # Write a boolean (True/False) to Modbus Coil 0 (Digital Out 0)
            is_on = data.get('state', False)
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, 502))
                    val = 0xFF00 if is_on else 0x0000
                    pdu = struct.pack('>BHH', 0x05, 0x0000, val) # FC 5, Address 0
                    mbap = struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9])
                    s.sendall(mbap + pdu)
                    recv_exact(s, 12)
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a): pass  # Silence standard logs

if __name__ == '__main__':
    print("╔══════════════════════════════════════╗")
    print("║   UR3e Threaded Relay — port 5678    ║")
    print("╚══════════════════════════════════════╝")
    HTTPServer(('', 5678), Handler).serve_forever()