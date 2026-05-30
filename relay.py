# relay.py — UR3e Relay Server
# Run with: python3 relay.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, struct, time

ROBOT_PORT   = 30002   # URScript injection
STATE_PORT   = 30003   # Real-time client (robot telemetry)
GRIPPER_PORT = 63352   # Robotiq 2F-85 URCap Modbus TCP daemon

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
    """
    Modbus TCP Write Multiple Registers (FC 16) to Robotiq 2F-85.
    Registers 0x03E8–0x03EA (1000–1002):
      Reg 0: [action_byte, 0x00]
      Reg 1: [0x00, position]   (0=open, 255=closed)
      Reg 2: [speed, force]     (0–255 each)
    """
    data = bytes([action_byte, 0x00, 0x00, position, speed, force])
    pdu  = struct.pack('>BHH', 0x10, 0x03E8, 3) + bytes([6]) + data
    mbap = struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9])
    return mbap + pdu

def gripper_read_packet():
    """
    Modbus TCP Read Input Registers (FC 4).
    Reads 3 registers starting at 0x07D0 (2000) — gripper status.
    """
    pdu  = struct.pack('>BHH', 0x04, 0x07D0, 3)
    mbap = struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9])
    return mbap + pdu

def parse_gripper_status(raw):
    """
    Parse Modbus TCP FC4 response into a status dict.
    Response layout (15 bytes total):
      [0-6]  MBAP header
      [7]    FC echo (0x04)
      [8]    Byte count (6)
      [9]    Status byte: gACT(bit0), gSTA(bits4-5), gOBJ(bits6-7)
      [10]   Fault byte (gFLT)
      [11]   Position request echo (gPR)
      [12]   Actual position (gPO): 0=open, 255=closed
      [13]   Motor current hi
      [14]   Motor current lo

    gOBJ values:
      0 = Fingers moving
      1 = Object detected while opening
      2 = Object detected while closing  ← gripped something
      3 = At requested position, no object
    """
    if len(raw) < 15:
        return {"ok": False, "error": f"Response too short ({len(raw)} bytes)"}
    status_byte = raw[9]
    gact = (status_byte >> 0) & 0x01
    gsta = (status_byte >> 4) & 0x03
    gobj = (status_byte >> 6) & 0x03
    gpo  = raw[12]  # actual position 0–255
    pos_mm = round((1.0 - gpo / 255.0) * 85.0, 1)
    gobj_labels = ['Moving', 'Obj @ open', 'Obj @ close', 'At position']
    return {
        "ok":              True,
        "activated":       gact == 1,
        "gobj":            gobj,
        "gobj_label":      gobj_labels[gobj],
        "object_detected": gobj in [1, 2],
        "position_raw":    gpo,
        "position_mm":     pos_mm,
    }

# ── HTTP Handler ───────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        body   = self.rfile.read(int(self.headers['Content-Length']))
        data   = json.loads(body)
        ip     = data.get('ip', '')
        action = data.get('action', 'send')
        resp   = b'{"ok":false,"error":"Unknown action"}'

        # ── Send URScript ──────────────────────────────────────────────
        if action == 'send':
            code = data['code'].encode()
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(5.0)
                    s.connect((ip, ROBOT_PORT))
                    s.sendall(code)
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Read robot state ───────────────────────────────────────────
        elif action == 'state':
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, STATE_PORT))
                    header  = recv_exact(s, 4)
                    pkt_len = struct.unpack('>I', header)[0]
                    body_b  = recv_exact(s, pkt_len - 4)
                    packet  = header + body_b
                    if len(packet) >= 492:
                        joints = struct.unpack('>6d', packet[252:300])
                        tcp    = struct.unpack('>6d', packet[444:492])
                        resp   = json.dumps({
                            "ok":     True,
                            "joints": list(joints),
                            "tcp":    list(tcp)
                        }).encode()
                    else:
                        resp = json.dumps({"ok": False, "error": f"Packet too small: {len(packet)}"}).encode()
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Gripper command ────────────────────────────────────────────
        elif action == 'gripper_cmd':
            cmd      = data.get('cmd', 'move')   # activate | open | close | move
            position = max(0, min(255, int(data.get('position', 0))))
            speed    = max(0, min(255, int(data.get('speed', 150))))
            force    = max(0, min(255, int(data.get('force', 100))))
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(5.0)
                    s.connect((ip, GRIPPER_PORT))
                    if cmd == 'activate':
                        # Phase 1: activate (rACT=1, rGTO=0 — just power on)
                        s.sendall(gripper_write_packet(0x01, 0, 0, 0))
                        recv_exact(s, 12)   # read Modbus ACK
                        time.sleep(0.15)
                        # Phase 2: go to open position (rACT=1, rGTO=1)
                        s.sendall(gripper_write_packet(0x09, 0, 150, 0))
                        recv_exact(s, 12)
                    else:
                        # open / close / move all use rACT=1, rGTO=1
                        s.sendall(gripper_write_packet(0x09, position, speed, force))
                        recv_exact(s, 12)
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Gripper status ─────────────────────────────────────────────
        elif action == 'gripper_status':
            s = None
            try:
                # 1. THE TIMEOUT FIX: Force failure after 0.5s so it never hangs your UI
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(0.5) 
                s.connect((ip, 502)) # UR3e Modbus Port
                
                # (Your existing s.send(...) or s.sendall(...) code stays exactly the same here)
                # Example: s.sendall(b'\x00\x01\x00\x00\x00\x06\x00\x03\x03\xe8\x00\x03')
                
                raw = s.recv(1024)
                
                if not raw or len(raw) < 13:
                    return {"ok": False, "error": "Bad data length"}

                # (Your existing math stays exactly the same here)
                gpo  = raw[12]  # Modbus Register 1001 Low Byte (Position)
                pos_mm = round((1.0 - gpo / 255.0) * 85.0, 1)
                
                return {
                    "ok": True,
                    "position_raw": gpo,
                    "position_mm": pos_mm
                }

            except Exception as e:
                return {"ok": False, "error": str(e)}
                
            finally:
                # 2. THE ZOMBIE KILLER: This guarantees the socket is destroyed 
                # and the port is released back to the UR3e, even if the math crashes!
                if s:
                    try:
                        s.close()
                    except:
                        pass
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, GRIPPER_PORT))
                    s.sendall(gripper_read_packet())
                    raw  = recv_exact(s, 15)
                    resp = json.dumps(parse_gripper_status(raw)).encode()
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

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
    print("╠══════════════════════════════════════╣")
    print("║  URScript  →  robot:30002            ║")
    print("║  Telemetry →  robot:30003            ║")
    print("║  Gripper   →  robot:63352 (Modbus)   ║")
    print("╚══════════════════════════════════════╝")
    server = ThreadedHTTPServer(('0.0.0.0', 5678), MyHandler)
    server.serve_forever()