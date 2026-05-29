import socket, json, struct
from http.server import HTTPServer, BaseHTTPRequestHandler

ROBOT_PORT = 30002
STATE_PORT = 30003
GRIPPER_PORT = 63352

def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk: break
        buf += chunk
    return buf

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        content_len = int(self.headers['Content-Length'])
        data = json.loads(self.rfile.read(content_len))
        ip = data.get('ip')
        action = data.get('action', 'send')
        resp = b'{"ok":false}'

        try:
            if action == 'state':
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, STATE_PORT))
                    header = recv_exact(s, 4)
                    if len(header) == 4:
                        size = struct.unpack('>I', header)[0]
                        body = recv_exact(s, size - 4)
                        packet = header + body
                        if len(packet) >= 492:
                            joints = struct.unpack('>6d', packet[252:300]) 
                            tcp = struct.unpack('>6d', packet[444:492])    
                            resp = json.dumps({"ok": True, "tcp": tcp, "joints": joints}).encode()
                            
            elif action == 'gripper':
                # Bypass URScript: Command Robotiq Gripper via direct Modbus TCP
                pos = data.get('position', 0)     # 0=Open, 255=Closed
                speed = data.get('speed', 150)
                force = data.get('force', 100)
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, GRIPPER_PORT))
                    # Robotiq Activation + Position mapping
                    payload = struct.pack('>HHHBBBBBB', 0, 0, 6, 9, 16, 0, 3, 6, 0x09, 0x00, pos, speed, force, 0x00)
                    s.sendall(payload)
                resp = b'{"ok":true}'

            else:
                # Standard URScript sending
                timeline_code = data['code']
                
                # Check if this is the main timeline program
                if "def master_program():" in timeline_code:
                    preamble_code = ""
                    try:
                        with open("robotiq_preamble.script", "r") as f:
                            preamble_code = f.read()
                    except FileNotFoundError:
                        print("⚠️ robotiq_preamble.script missing!")

                    # 1. Ensure the hardware initialization function we created at the bottom is called
                    preamble_code += "\n    init_robotiq_hardware()\n"

                    # 2. Inject the ENTIRE preamble INSIDE the main function block!
                    # This completely solves all scope, index, and uninitialized variable errors.
                    timeline_code = timeline_code.replace(
                        "def master_program():", 
                        "def master_program():\n" + preamble_code
                    )

                    # 3. Use this perfectly nested code as our final payload
                    full_transpiled_program = timeline_code

                    # Ensure it executes at the end
                    if not full_transpiled_program.strip().endswith("master_program()"):
                        full_transpiled_program += "\nmaster_program()\n"
                
                else:
                    # It's a quick command (Free Drive, Stop, etc). Send it raw!
                    full_transpiled_program = timeline_code

                # Stream the payload to the controller
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, ROBOT_PORT))
                    s.sendall(full_transpiled_program.encode())
                
                resp = b'{"ok":true}'
        


        except Exception as e:
            print(f"Relay Error [{action}]: {e}")
            resp = json.dumps({"ok": False, "error": str(e)}).encode()

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a): pass

if __name__ == '__main__':
    print("Relay running with Robust Reader & Modbus Gripper...")
    HTTPServer(('localhost', 5678), Handler).serve_forever()