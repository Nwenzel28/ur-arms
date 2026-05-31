# relay.py — UR3e Relay Server
# Run with: python3 relay.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, struct, time, threading

ROBOT_PORT   = 30002   # URScript injection
STATE_PORT   = 30003   # Real-time client (robot telemetry)
GRIPPER_PORT = 63352   # Robotiq 2F-85 URCap Modbus TCP daemon

# ── 🌟 Global State ─────────────────────────────────────────────────────
target_ip = None
gripper_cmd_queue = [] 
robot_state = {
    "connected": False,
    "joints": None,
    "tcp": None,
    "gripper": {"ok": False, "gobj": 0, "gobj_label": "Connecting..."}
}

# ── Safe Network Readers ───────────────────────────────────────────────
def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk: raise ConnectionError("Socket unexpectedly closed by robot")
        buf += chunk
    return buf

def read_modbus_response(sock):
    """Dynamically reads a Modbus packet so we NEVER timeout on error packets"""
    # 1. Read the 6-byte MBAP header
    mbap = recv_exact(sock, 6)
    # 2. Extract the length field (tells us how many bytes follow)
    length = struct.unpack('>HHH', mbap)[2]
    # 3. Read exactly that many remaining bytes
    payload = recv_exact(sock, length)
    return mbap + payload

# ── Modbus Packet Builders ─────────────────────────────────────────────
def gripper_write_packet(tid, action_byte, position, speed, force):
    data = bytes([action_byte, 0x00, 0x00, position, speed, force])
    pdu  = struct.pack('>BHH', 0x10, 0x03E8, 3) + bytes([6]) + data
    return struct.pack('>HHH', tid, 0, 1 + len(pdu)) + bytes([9]) + pdu

def gripper_read_packet(tid):
    pdu  = struct.pack('>BHH', 0x04, 0x07D0, 3)
    return struct.pack('>HHH', tid, 0, 1 + len(pdu)) + bytes([9]) + pdu

def parse_gripper_status(raw):
    # If the packet is an error packet (shorter than expected), flag it safely
    if len(raw) < 15: return {"ok": False, "error": f"Modbus exception: {raw.hex()}"}
    
    status_byte = raw[9]
    gact = (status_byte >> 0) & 0x01
    gobj = (status_byte >> 6) & 0x03
    gpo  = raw[12]
    return {
        "ok": True, 
        "activated": gact == 1, 
        "gobj": gobj, 
        "position_raw": gpo
    }

# ── Thread 1: Arm Telemetry ─────────────────────────────────────────────
def state_monitor():
    global target_ip, robot_state
    current_socket = None
    was_connected = False
    printed_error = False

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
                printed_error = False # Reset error flag on success

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
            elif not printed_error:
                print(f"❌ [Arm Error] Failed to connect: {type(e).__name__}: {e}")
                printed_error = True
            
            robot_state['connected'] = False
            if current_socket:
                try: current_socket.close()
                except: pass
                current_socket = None
            time.sleep(1.0)

# ── Thread 2: Gripper Telemetry ─────────────────────────────────────────
def gripper_monitor():
    global target_ip, robot_state, gripper_cmd_queue
    was_connected = False
    printed_error = False
    tid = 1 

    while True:
        if not target_ip:
            time.sleep(0.5)
            continue

        try:
            # 1. PROCESS QUEUE (Write Commands)
            while gripper_cmd_queue:
                pos = gripper_cmd_queue.pop(0)
                tid = (tid % 65535) + 1
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((target_ip, GRIPPER_PORT))
                    s.sendall(gripper_write_packet(tid, 0x09, pos, 255, 150))
                    
                    # Safely read response regardless of length
                    res = read_modbus_response(s)
                    if res[7] == 0x90: # 0x90 is the standard Modbus error flag for FC16
                        print(f"⚠️ [Gripper] Robot rejected write command! Error packet: {res.hex()}")

                time.sleep(0.05) 

            # 2. POLLING (Read Status)
            tid = (tid % 65535) + 1
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(2.0)
                s.connect((target_ip, GRIPPER_PORT))
                s.sendall(gripper_read_packet(tid))
                
                raw = read_modbus_response(s)
                
                # Check for FC04 Modbus Error flag
                if raw[7] == 0x84:
                    if not printed_error:
                        print(f"⚠️ [Gripper] Robot rejected read command! Error packet: {raw.hex()}")
                        printed_error = True
                else:
                    robot_state['gripper'] = parse_gripper_status(raw)
                
                if not was_connected:
                    print(f"✅ [Gripper] Connected! Modbus polling active.")
                    was_connected = True
                    printed_error = False

            time.sleep(0.25) 

        except Exception as e:
            if was_connected:
                print(f"⚠️ [Gripper] Connection lost: {type(e).__name__}: {e}")
                was_connected = False
            elif not printed_error:
                # 🌟 THIS IS THE CRITICAL LINE THAT WILL EXPOSE OUR BUG
                print(f"❌ [Gripper Error] {type(e).__name__}: {e}")
                printed_error = True

            robot_state['gripper'] = {"ok": False, "error": str(e)}
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
            gripper_cmd_queue.append(pos) 
            resp = b'{"ok":true}'

        elif action in ['state', 'get_position', 'gripper_status']:
            global target_ip
            if ip and target_ip != ip:
                target_ip = ip
                time.sleep(0.2) 

            if action == 'gripper_status':
                resp = json.dumps(robot_state.get('gripper', {"ok": False})).encode()
            else:
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