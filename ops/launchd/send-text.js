#!/usr/bin/env node
const { connect } = require('net');
const { homedir } = require('os');
const { join } = require('path');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: fluxa-send.js <message>');
  process.exit(1);
}
const text = args.join(' ').trim();
if (!text) {
  console.error('Usage: fluxa-send.js <message>');
  process.exit(1);
}

const socketPath = process.env.FLUXA_IPC_SOCK || join(homedir(), 'Library', 'Application Support', 'Fluxa', 'anima.sock');
const payload = JSON.stringify({ type: 'user_message', text }) + '\n';

const sock = connect(socketPath, () => {
  sock.write(payload);
  sock.end();
});

sock.on('error', (err) => {
  console.error(`Fluxa socket error: ${err.message}`);
  process.exit(1);
});
