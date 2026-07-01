# relay.py — UR3e Relay Server
# Run with: python3 relay.py
from http.server import HTTPServer, BaseHTTPRequestHandler
import socket, json, struct, time, threading, os, urllib.request, urllib.error

ROBOT_PORT   = 30002   # URScript injection
STATE_PORT   = 30003   # Real-time client (robot telemetry)
GRIPPER_PORT = 63352   # Robotiq 2F-85 URCap Modbus TCP daemon

# ── 🤖 Gemini AI Assistant Config ───────────────────────────────────────
# Never hardcode the key here. Set it as an environment variable before
# launching the relay, e.g.:
#   macOS/Linux:  export GEMINI_API_KEY="your-key-here"
#   Windows CMD:  set GEMINI_API_KEY=your-key-here
# Get a free key at https://aistudio.google.com/apikey
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL   = "gemini-2.0-flash"
GEMINI_URL     = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

AI_SYSTEM_PROMPT = """You are the built-in assistant for a custom UR3e robot arm web pendant
(a UR3e with a Robotiq 2F-85 gripper). You answer questions about the operator's saved
positions, program steps, and settings, and explain how the program builder works.

The program builder's step types are: movej, movel, movec, guarded_move, activate_gripper,
open_gripper, close_gripper, read_gripper, loop_start, if_start, else_if, else, wait_cond,
thread_start, end, assign, timer, sleep, textmsg, popup, halt, set_digital_out, set_payload,
set_tcp, comment, folder.

You will be given the current state of the user's project (positions, steps, settings, and
whether Simulation Mode is on) as JSON context. Use it to answer questions concretely
(e.g. "what does PICK's Z look like", "why would my loop never run", "what will step 4 do").

Rules:
- Be concise. Prefer short, direct answers over long essays.
- If asked to write or modify a program, describe what to do in plain language and which
  step types to use, but do NOT output raw JSON or full programs unless explicitly asked.
- If something in their program looks like a mistake (e.g. an if_start with no matching end,
  or a movec missing a via/to position), point it out proactively but briefly.
- If you don't have enough context to answer, say so plainly instead of guessing.
- Never claim you can directly modify the program yourself — you can only answer questions
  and offer guidance right now.
"""

# ── 💬 Popup State ──────────────────────────────────────────────────────
popup_msg = None
popup_resolved = False
ignore_popups_until = 0

# ── 🌟 Global State (Digital Twin Caching) ──────────────────────────────
target_ip = None
ui_logs = []

robot_state = {
    "connected": False,
    "joints": None,
    "tcp": None
}

robot_dashboard_state = {
    "prog": "",
    "mode": ""
}

# ── 🧵 Background Thread 1: Kinematics (Port 30003) ───────────────────
def state_monitor():
    """Background thread that persistently reads telemetry from the robot."""
    global target_ip, robot_state
    current_socket = None

    while True:
        if not target_ip:
            time.sleep(0.5)
            continue

        try:
            if current_socket is None:
                print(f"📡 [Kinematics] Connecting to {target_ip}:{STATE_PORT}...")
                current_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                current_socket.settimeout(2.0)
                current_socket.connect((target_ip, STATE_PORT))
                current_socket.settimeout(5.0) 
                print(f"✅ [Kinematics] Connected!")

            size_data = recv_exact(current_socket, 4)
            size = struct.unpack('>i', size_data)[0]
            payload = recv_exact(current_socket, size - 4)

            if size >= 1220:
                q_actual = list(struct.unpack('>6d', payload[248:248+48]))
                p_actual = list(struct.unpack('>6d', payload[440:440+48]))
                robot_state['joints'] = q_actual
                robot_state['tcp'] = p_actual
                robot_state['connected'] = True
            else:
                time.sleep(0.01)

        except Exception as e:
            if robot_state['connected']:
                print(f"⚠️ [Kinematics] Connection lost: {e}. Retrying in 1s...")
            robot_state['connected'] = False
            robot_state['joints'] = None
            robot_state['tcp'] = None
            if current_socket:
                try: current_socket.close()
                except: pass
                current_socket = None
            time.sleep(1.0)

# ── 🧵 Background Thread 2: Dashboard (Port 29999) ────────────────────
def dashboard_monitor():
    """Background thread preventing socket exhaustion on the Dashboard Server while polling state & safety."""
    global target_ip, robot_dashboard_state, popup_msg, popup_resolved, ignore_popups_until
    current_socket = None

    while True:
        if not target_ip:
            time.sleep(0.5)
            continue

        try:
            if current_socket is None:
                print(f"📡 [Dashboard] Connecting to {target_ip}:29999...")
                current_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                current_socket.settimeout(2.0)
                current_socket.connect((target_ip, 29999))
                current_socket.settimeout(5.0)
                current_socket.recv(1024) 
                print(f"✅ [Dashboard] Connected!")

            

            # 1. Poll Program State
            current_socket.sendall(b"programState\n")
            raw_prog = current_socket.recv(1024).decode('utf-8', errors='ignore').strip()
            robot_dashboard_state["prog"] = raw_prog

            # --- Native Popup Interception Check ---
            # Only intercept if we are NOT in the 2-second UI dismiss cooldown period
            if time.time() > ignore_popups_until:
                if "Popup:" in raw_prog or "Warning:" in raw_prog or "Error:" in raw_prog:
                    clean_msg = raw_prog.replace("Popup:", "").replace("Warning:", "").strip()
                    print(f"🚨 [Native Pendant Alert] Intercepted: {clean_msg}")
                    popup_msg = f"[Pendant System Alert] {clean_msg}"
                    popup_resolved = False

            # 2. Poll Robot Mode
            current_socket.sendall(b"robotmode\n")
            robot_dashboard_state["mode"] = current_socket.recv(1024).decode('utf-8', errors='ignore').strip()

            # 3. Poll Safety Status (Protective & E-Stops)
            current_socket.sendall(b"safetystatus\n")
            raw_safety = current_socket.recv(1024).decode('utf-8', errors='ignore').strip()
            
            # Trigger custom popups based on the native safety states, respecting cooldown
            if time.time() > ignore_popups_until:
                if "PROTECTIVE_STOP" in raw_safety and (not popup_msg or "Protective Stop" not in popup_msg):
                    print(f"🚨 [Safety Alert] Intercepted: {raw_safety}")
                    popup_msg = "⚠️ Protective Stop Triggered! The robot detected a collision or excessive force."
                    popup_resolved = False
                    
                elif "EMERGENCY_STOP" in raw_safety and (not popup_msg or "EMERGENCY STOP" not in popup_msg):
                    print(f"🚨 [Safety Alert] Intercepted: {raw_safety}")
                    popup_msg = "🚨 EMERGENCY STOP ENGAGED! Release the physical E-Stop button to continue."
                    popup_resolved = False

            time.sleep(0.25) 

        except Exception as e:
            robot_dashboard_state["prog"] = ""
            robot_dashboard_state["mode"] = ""
            if current_socket:
                try: current_socket.close()
                except: pass
                current_socket = None
            time.sleep(2.0)

# ── Reliable socket reader ─────────────────────────────────────────────
def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError(f"Socket closed after {len(buf)}/{n} bytes")
        buf += chunk
    return buf

# ── Gripper Helpers ────────────────────────────────────────────────────
def gripper_write_packet(action_byte, position, speed, force):
    data = bytes([action_byte, 0x00, 0x00, position, speed, force])
    pdu  = struct.pack('>BHH', 0x10, 0x03E8, 3) + bytes([6]) + data
    mbap = struct.pack('>HHH', 1, 0, 1 + len(pdu)) + bytes([9])
    return mbap + pdu

# ── HTTP Handler ───────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        # --- All globals declared ONCE at the very top of the function ---
        global target_ip, popup_msg, popup_resolved, ignore_popups_until, ui_logs
        
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

        # ── Get Live Position (INSTANT CACHE READ) ─────────────────────
        elif action in ['state', 'get_position']:
            req_ip = data.get('ip', '')
            
            if req_ip and target_ip != req_ip:
                target_ip = req_ip
                time.sleep(0.2) 

            if robot_state['connected'] and robot_state['joints']:
                resp = json.dumps({
                    "ok": True,
                    "joints": robot_state['joints'],
                    "tcp": robot_state['tcp'],
                    "cartesian": robot_state['tcp'] 
                }).encode()
            else:
                resp = json.dumps({"ok": False, "error": "Connecting..."}).encode()

        # ── Get Dashboard Status (INSTANT CACHE READ) ──────────────────
        elif action == 'dashboard_status':
            req_ip = data.get('ip', '')
            
            if req_ip and target_ip != req_ip:
                target_ip = req_ip
                time.sleep(0.2)
                
            resp = json.dumps({
                "ok": True, 
                "prog": robot_dashboard_state["prog"],
                "mode": robot_dashboard_state["mode"]
            }).encode()

        # ── Dashboard Server Execution Controls ────────────────────────
        elif action in ['dashboard_pause', 'dashboard_stop', 'dashboard_play']:
            try:
                # This neatly extracts "pause\n", "stop\n", or "play\n"
                cmd = action.split('_')[1] + "\n" 
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, 29999))
                    s.recv(1024) # Consume the robot's welcome message
                    s.sendall(cmd.encode())
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Hardware Speed Override (Port 30003) ───────────────────────
        elif action == 'dashboard_speed':
            try:
                # 1. Grab 'fraction' instead of 'speed' to match network.js
                frac_speed = float(data.get('fraction', 1.0))
                
                # 2. Hard safety bounds (1% to 100%)
                frac_speed = max(0.01, min(frac_speed, 1.0))
                
                # 3. Connect to Port 30003 (Real-Time Port) and use 'set speed'
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, 30003))
                    # Port 30003 does not have a welcome message, so no recv() needed
                    s.sendall(f"set speed {frac_speed}\n".encode())
                resp = b'{"ok":true}'
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Gripper Move ───────────────────────────────────────────────
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

        # ── Gripper status (ASCII Protocol) ────────────────────────────
        elif action == 'gripper_status':
            try:
                import re
                def extract_num(text):
                    nums = re.findall(r'\d+', text)
                    return int(nums[-1]) if nums else 0

                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(2.0)
                    s.connect((ip, 63352))
                    
                    s.sendall(b"GET STA\n")
                    sta_raw = s.recv(1024).decode('utf-8').strip()
                    
                    s.sendall(b"GET OBJ\n")
                    obj_raw = s.recv(1024).decode('utf-8').strip()

                    s.sendall(b"GET POS\n")
                    pos_raw = s.recv(1024).decode('utf-8').strip()

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
                resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Popups ─────────────────────────────────────────────────────
        elif action == 'check_popup':
                # The UI polls this endpoint to see if a message is waiting
                resp = json.dumps({"ok": True, "msg": popup_msg}).encode()
                
        elif action == 'resolve_popup':
                popup_resolved = True
                popup_msg = None  # Clear the message so the UI drops it
                
                # Blindfold the monitor for 2 seconds so the robot has time to close the window
                ignore_popups_until = time.time() + 2.0
                
                # Auto-dismiss pendant popups AND clear protective stops
                if target_ip:
                    try:
                        dash_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        dash_sock.connect((target_ip, 29999))
                        
                        # Command sequence to clear standard popups and safety faults
                        dash_sock.sendall(b"close popup\n")
                        dash_sock.sendall(b"close safety popup\n")
                        dash_sock.sendall(b"unlock protective stop\n")
                        
                        dash_sock.close()
                    except Exception as e:
                        print(f"Failed to auto-dismiss pendant popup: {e}")
                
                resp = json.dumps({"ok": True}).encode()
        # ── AI Assistant (Gemini) ───────────────────────────────────────
        elif action == 'ai_ask':
            if not GEMINI_API_KEY:
                resp = json.dumps({
                    "ok": False,
                    "error": "GEMINI_API_KEY is not set on the relay server. "
                             "Set it as an environment variable and restart relay.py."
                }).encode()
            else:
                try:
                    question = data.get('question', '').strip()
                    context  = data.get('context', {})
                    history  = data.get('history', [])  # [{role:'user'|'model', text:'...'}]

                    if not question:
                        resp = json.dumps({"ok": False, "error": "Empty question"}).encode()
                    else:
                        contents = []
                        # Prior turns, so follow-up questions have memory
                        for turn in history[-10:]:
                            role = 'model' if turn.get('role') == 'model' else 'user'
                            contents.append({"role": role, "parts": [{"text": turn.get('text', '')}]})

                        user_text = (
                            f"Current project context (JSON):\n{json.dumps(context)}\n\n"
                            f"Question: {question}"
                        )
                        contents.append({"role": "user", "parts": [{"text": user_text}]})

                        payload = {
                            "contents": contents,
                            "systemInstruction": {"parts": [{"text": AI_SYSTEM_PROMPT}]},
                            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 800}
                        }

                        req = urllib.request.Request(
                            f"{GEMINI_URL}?key={GEMINI_API_KEY}",
                            data=json.dumps(payload).encode(),
                            headers={"Content-Type": "application/json"},
                            method="POST"
                        )
                        with urllib.request.urlopen(req, timeout=20) as r:
                            result = json.loads(r.read().decode())

                        candidates = result.get('candidates', [])
                        if candidates and candidates[0].get('content', {}).get('parts'):
                            answer = candidates[0]['content']['parts'][0].get('text', '').strip()
                            resp = json.dumps({"ok": True, "answer": answer}).encode()
                        else:
                            reason = candidates[0].get('finishReason') if candidates else 'no candidates'
                            resp = json.dumps({"ok": False, "error": f"No answer returned ({reason})"}).encode()

                except urllib.error.HTTPError as e:
                    try:
                        err_body = json.loads(e.read().decode())
                        err_msg = err_body.get('error', {}).get('message', str(e))
                    except Exception:
                        err_msg = str(e)
                    resp = json.dumps({"ok": False, "error": f"Gemini API error: {err_msg}"}).encode()
                except Exception as e:
                    resp = json.dumps({"ok": False, "error": str(e)}).encode()

        # ── Fetch Live UI Logs ─────────────────────────────────────────
        elif action == 'fetch_logs':
            # Send the current logs
            resp = json.dumps({"ok": True, "logs": ui_logs}).encode()
            ui_logs.clear()

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a):
        pass
     
def popup_server():
    """Listens for popup messages from the URScript socket."""
    global popup_msg, popup_resolved
    
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # Bind to all interfaces on port 50000
    server.bind(('0.0.0.0', 50000))
    server.listen(1)
    print("💬 [Popup] Listening for robot messages on port 50000...")
    
    while True:
        try:
            conn, addr = server.accept()
            data = conn.recv(1024).decode('utf-8')
            if data:
                print(f"📩 [Popup] Received: {data}")
                popup_msg = data
                popup_resolved = False
                
                # Halt this thread until the web UI says "Continue"
                while not popup_resolved:
                    time.sleep(0.1)
                
                # Send the confirmation back to the robot so it can resume
                conn.sendall(b"continue")
                popup_msg = None # Clear the message
                
            conn.close()
        except Exception as e:
            print(f"⚠️ [Popup] Error: {e}")

def log_server():
    """Listens for fire-and-forget log messages from the URScript socket."""
    global ui_logs
    
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(('0.0.0.0', 50001))
    server.listen(5)
    print("📝 [Logger] Listening for robot logs on port 50001...")
    
    while True:
        try:
            conn, addr = server.accept()
            data = conn.recv(1024).decode('utf-8')
            if data:
                print(f"📝 [Log] {data}")
                ui_logs.append(data)
            conn.close()
        except Exception as e:
            pass

if __name__ == '__main__':
    print("╔══════════════════════════════════════╗")
    print("║     UR3e Relay  —  localhost:5678    ║")
    print("╚══════════════════════════════════════╝")
    
    # Start all background threads safely
    threading.Thread(target=state_monitor, daemon=True).start()
    threading.Thread(target=dashboard_monitor, daemon=True).start()
    threading.Thread(target=popup_server, daemon=True).start()
    threading.Thread(target=log_server, daemon=True).start()
    HTTPServer(('', 5678), Handler).serve_forever()