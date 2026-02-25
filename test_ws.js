const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:7860/ws');
ws.on('open', () => {
  console.log('connected');
  ws.send(JSON.stringify({ type: 'config' }));
});
ws.on('message', (data) => {
  console.log('got message of type:', typeof data, 'instance:', data.constructor.name);
  if (Buffer.isBuffer(data)) {
    console.log('Buffer hex:', data.toString('hex').substring(0, 100));
    console.log('Buffer len:', data.length);
  } else {
    console.log('Text:', data.toString().substring(0, 100));
  }
  process.exit(0);
});
setTimeout(()=> { console.log('timeout'); process.exit(1); }, 3000);
