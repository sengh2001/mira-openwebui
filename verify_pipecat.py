import asyncio
import json
import ssl
import sys
import websockets

# URL from the user's logs
WS_URL = "wss://pipecat.taile994c5.ts.net:7860/ws"

async def test_connection():
    print(f"Connecting to {WS_URL}...")
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    try:
        async with websockets.connect(WS_URL, ssl=ssl_context) as websocket:
            print("Connected!")
            
            # Test 1: Just wait and see if it closes
            print("Waiting for 5 seconds to check stability...")
            try:
                msg = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                print(f"Received message: {msg}")
            except asyncio.TimeoutError:
                print("No message received in 5 seconds (Connection is stable idle)")
            except websockets.exceptions.ConnectionClosed as e:
                print(f"Connection closed during idle wait: {e.code} {e.reason}")
                return

            # Test 2: Send Minimal Config (like the working example)
            print("\nSending Minimal Config...")
            minimal_config = { "type": "config" }
            await websocket.send(json.dumps(minimal_config))
            print("Minimal Config sent.")

            # Wait to see response or close
            print("Waiting for response (should stay open)...")
            try:
                # Loop to read messages
                msg = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                print(f"Received from server: {msg}")
            except asyncio.TimeoutError:
                 print("No response from server (Stable Connection)")
            except websockets.exceptions.ConnectionClosed as e:
                print(f"Connection closed after config: {e.code} {e.reason}")

    except Exception as e:
        print(f"Failed to connect or error occurred: {e}")

if __name__ == "__main__":
    # Check if websockets is installed
    try:
        import websockets
        asyncio.run(test_connection())
    except ImportError:
        print("This script requires the 'websockets' library.")
        print("Please run: pip install websockets")
