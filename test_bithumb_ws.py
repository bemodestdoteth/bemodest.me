import asyncio
import websockets
import json

async def test():
    uri = "wss://ws-api.bithumb.com/websocket/v1"
    async with websockets.connect(uri) as ws:
        sub = [{"ticket": "test"}, {"type": "ticker", "codes": ["KRW-BTC"]}, {"format": "SIMPLE"}]
        await ws.send(json.dumps(sub))
        print("Sent:", json.dumps(sub))
        res = await ws.recv()
        print("Recv:", res)
        # Try ping
        await ws.send("PING")
        print("Sent PING")
        res = await ws.recv()
        print("Recv after PING:", res)

asyncio.run(test())
