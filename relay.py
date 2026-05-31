# relay.py — UR3e Relay Server
# Run with: python3 relay.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, struct, time, threading

ROBOT_PORT   = 30002   # URScript injection
STATE_PORT   = 30003   # Real-time client (robot telemetry)
GRIPPER_PORT = 63352   # Robotiq 2F-85 URCap Modbus TCP daemon

# ── 🌟 NEW: Global State (Digital Twin) ─────────────────────────────────
target_ip = None
robot_state = {
    "connected": False,
    "joints": None,
    "tcp": None
}

def state_monitor():
    """Background thread that persistently reads telemetry from the robot."""
    global target_ip, robot_state
    current_socket = None

    while True:
        # If the UI hasn't given us an IP yet, just wait.
        if not target_ip:
            time.sleep(0.5)
            continue

        try:
            # If we don't have a socket, create exactly ONE and keep it alive.
            if current_socket is None:
                print(f"📡 [Monitor] Connecting to robot telemetry at {target_ip}:{STATE_PORT}...")
                current_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                current_socket.settimeout(2.0)
                current_socket.connect((target_ip, STATE_PORT))
                current_socket.settimeout(5.0) # Longer timeout once established
                print(f"✅ [Monitor] Connected! Streaming state continuously...")

            # Read 4-byte size header
            size_data = recv_exact(current_socket, 4)
            size = struct.unpack('>i', size_data)[0]
            payload = recv_exact(current_socket, size - 4)

            # Extract e-Series Kinematics
            if size >= 1220:
                q_actual = list(struct.unpack('>6d', payload[248:248+48]))
                p_actual = list(struct.unpack('>6d', payload[440:440+48]))

                robot_state['joints'] = q_actual
                robot_state['tcp'] = p_actual
                robot_state['connected'] = True
            else:
                time.sleep(0.01) # Safety sleep if weird packets arrive

        except Exception as e:
            if robot_state['connected']:
                print(f"⚠️ [Monitor] Connection lost: {e}. Retrying in 1s...")
            robot_state['connected'] = False
            robot_state['joints'] = None
            robot_state['tcp'] = None
            if current_socket:
                try: current_socket.close()
                except: pass
                current_socket = None
            time.sleep(1.0) # Backoff before reconnecting

# ── Reliable socket reader ─────────────────────────────────────────────
def recv_exact(sock, n):
    """Read exactly n bytes, handling partial TCP reads."""
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError(f"Socket closed after {len(buf)}/{n} bytes")
        buf += chunk
    return buf

# ── Gripper Modbus TCP packet builders ────────────────────────────────
def gripper_write_packet(action_byte, position, speed, force):
    data = bytes([action_byte, 0x00, 0x00, position, speed, force])
    pdu  = struct.pack('>BHH', 0x10, 0x03E8, 3) + bytes([6]) + data
    mbap = struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9])
    return mbap + pdu

def gripper_read_packet():
    pdu  = struct.pack('>BHH', 0x04, 0x07D0, 3)
    mbap = struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9])
    return mbap + pdu

# Place this helper near your other network readers:
def read_modbus_response(sock):
    """Dynamically reads a Modbus packet to prevent hanging on short error packets."""
    mbap = recv_exact(sock, 6)
    length = struct.unpack('>HHH', mbap)[2]
    payload = recv_exact(sock, length)
    return mbap + payload

def parse_gripper_status(raw):
    # Check if the robot sent a short error packet
    if len(raw) < 15: 
        return {"ok": False, "error": f"Modbus exception: {raw.hex()}"}
        
    status_byte = raw[9]
    gact = (status_byte >> 0) & 0x01
    gsta = (status_byte >> 4) & 0x03  # NEW: Activation Status (3 = Done Activating)
    gobj = (status_byte >> 6) & 0x03  # Object Detection Status
    gpo  = raw[12]
    
    return {
        "ok": True, 
        "activated": gact == 1, 
        "gsta": gsta, 
        "gobj": gobj, 
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

        # ── Script sending ─────────────────────────────────────────────
        if action == 'send':
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, ROBOT_PORT))
                    s.sendall(data['code'].encode())
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Direct URScript execution (for Hold-to-Move) ───────────────
        elif action == 'urscript':
            try:
                script = data.get('script', '') + '\n'
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, ROBOT_PORT))
                    s.sendall(script.encode())
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── 🌟 NEW: Get Live Position & Dashboard State (INSTANT READ) ───
        elif action in ['state', 'get_position']:
            global target_ip
            req_ip = data.get('ip', '')
            
            # If this is the first time the UI gives us an IP, set it to wake up the thread
            if req_ip and target_ip != req_ip:
                target_ip = req_ip
                time.sleep(0.2) # Give the thread a split second to do the initial handshake

            # Read directly from RAM instantly! No socket exhaustion.
            if robot_state['connected'] and robot_state['joints'] and robot_state['tcp']:
                resp = json.dumps({
                    "ok": True,
                    "joints": robot_state['joints'],
                    "tcp": robot_state['tcp'],
                    "cartesian": robot_state['tcp'] # Redundant key so 'get_position' API matches perfectly
                }).encode()
            else:
                resp = json.dumps({"ok": False, "error": "Robot state monitor is connecting or unavailable"}).encode()

        # ── Gripper Controls ───────────────────────────────────────────
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

        # ── Gripper status (ASCII Text Protocol!) ──────────────────────────
        elif action == 'gripper_status':
            try:
                import re # Import Regex to safely extract numbers
                def extract_num(text):
                    nums = re.findall(r'\d+', text)
                    return int(nums[-1]) if nums else 0

                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, 63352))
                    
                    # Ask for Statuses
                    s.sendall(b"GET STA\n")
                    sta_raw = s.recv(1024).decode('utf-8').strip()
                    
                    s.sendall(b"GET OBJ\n")
                    obj_raw = s.recv(1024).decode('utf-8').strip()

                    s.sendall(b"GET POS\n")
                    pos_raw = s.recv(1024).decode('utf-8').strip()

                    # Print out EXACTLY what the robot sent us
                    print(f"🤖 RAW ROBOT TEXT -> STA: '{sta_raw}', OBJ: '{obj_raw}', POS: '{pos_raw}'")

                    # Extract just the numbers, ignore all letters/spaces
                    gsta = extract_num(sta_raw)
                    gobj = extract_num(obj_raw)
                    gpo  = extract_num(pos_raw)

                    resp = json.dumps({
                        "ok": True,
                        "gsta": gsta,
                        "gobj": gobj,
                        "position_raw": gpo
                    }).encode()

            except Exception as e:
                print(f"⚠️ GRIPPER ERROR: {e}")
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # Send response back to browser
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a):
        pass  # silence request logs

if __name__ == '__main__':
    print("╔══════════════════════════════════════╗")
    print("║     UR3e Relay  —  localhost:5678    ║")
    print("╚══════════════════════════════════════╝")
    
    # 🌟 Start the background thread before starting the server!
    threading.Thread(target=state_monitor, daemon=True).start()
    
    HTTPServer(('', 5678), Handler).serve_forever()