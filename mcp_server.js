#!/usr/bin/env node

const express = require('express');
const find = require('find-process');
const { exec } = require('child_process');
const app = express();

// MCP Protocol handling
const stdin = process.stdin;
const stdout = process.stdout;
stdin.setEncoding('utf8');

let messageBuffer = '';

// Handle incoming MCP messages
stdin.on('data', (chunk) => {
    messageBuffer += chunk;

    try {
        // Try to parse complete JSON messages
        const messages = messageBuffer.split('\n');
        messageBuffer = messages.pop(); // Keep the last incomplete chunk

        for (const msg of messages) {
            if (msg.trim()) {
                handleMessage(JSON.parse(msg));
            }
        }
    } catch (e) {
        console.error('Error processing message:', e);
    }
});

function sendMessage(message) {
    stdout.write(JSON.stringify(message) + '\n');
}

function handleMessage(message) {
    console.error('Received message:', message); // Log to stderr for debugging

    if (message.method === 'initialize') {
        // Respond to initialization
        sendMessage({
            jsonrpc: '2.0',
            id: message.id,
            result: {
                capabilities: {
                    restart: true
                },
                serverInfo: {
                    name: 'RestartMCP',
                    version: '1.0.0'
                }
            }
        });
    } else if (message.method === 'shutdown') {
        // Handle shutdown request
        sendMessage({
            jsonrpc: '2.0',
            id: message.id,
            result: null
        });
        process.exit(0);
    }
}

app.use(express.json());
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Log all errors
app.use((err, req, res, next) => {
    console.error(`${new Date().toISOString()} - Error:`, err);
    next(err);
});

async function findProcessByName(processName) {
    console.log(`Searching for process: ${processName}`);
    try {
        const processes = await find('name', processName);
        console.log(`Found ${processes.length} matching processes`);
        return processes.map(proc => proc.pid);
    } catch (e) {
        console.error('Error finding process:', e);
        return [];
    }
}

async function killProcess(pid) {
    console.log(`Attempting to kill process ${pid}`);
    try {
        if (process.platform === 'win32') {
            await new Promise((resolve, reject) => {
                exec(`taskkill /PID ${pid} /T /F`, (error) => {
                    if (error) {
                        console.error(`Failed to kill process ${pid}:`, error);
                        reject(error);
                    } else {
                        console.log(`Successfully killed process ${pid}`);
                        resolve();
                    }
                });
            });
        } else {
            process.kill(pid);
            console.log(`Successfully killed process ${pid}`);
        }
    } catch (e) {
        console.error(`Error killing process ${pid}:`, e);
    }
}

app.post('/restart', async(req, res) => {
    console.log('Received restart request:', req.body);
    const { app_name, app_path } = req.body;

    if (!app_name || !app_path) {
        console.error('Missing required parameters:', { app_name, app_path });
        return res.status(400).json({ error: 'Missing app_name or app_path' });
    }

    try {
        // Find and kill existing processes
        const pids = await findProcessByName(app_name);
        console.log(`Found ${pids.length} processes to kill for ${app_name}`);

        for (const pid of pids) {
            await killProcess(pid);
            console.log(`Waiting after killing pid ${pid}`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
        }

        // Start the application
        console.log(`Starting application: ${app_path}`);
        exec(app_path, (error) => {
            if (error) {
                console.error('Error starting application:', error);
                return res.status(500).json({
                    status: 'error',
                    message: `Failed to restart application: ${error.message}`
                });
            }
            console.log(`Successfully started ${app_path}`);
        });

        console.log(`Restart operation completed for ${app_name}`);
        res.json({
            status: 'success',
            message: `Application ${app_name} restarted successfully`
        });
    } catch (e) {
        console.error('Error during restart operation:', e);
        res.status(500).json({
            status: 'error',
            message: `Failed to restart application: ${e.message}`
        });
    }
});

const port = process.env.PORT || 5000;
const host = process.env.HOST || '127.0.0.1';

const server = app.listen(port, host, () => {
    console.error(`${new Date().toISOString()} - MCP Server running at http://${host}:${port}`);
});

server.on('error', (error) => {
    console.error(`${new Date().toISOString()} - Server Error:`, error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Please try a different port.`);
    } else {
        console.error('Failed to start server:', error);
    }
    process.exit(1);
});

server.on('connection', (socket) => {
    console.log(`${new Date().toISOString()} - New connection from ${socket.remoteAddress}`);
    socket.on('close', () => {
        console.log(`${new Date().toISOString()} - Connection closed from ${socket.remoteAddress}`);
    });
    socket.on('error', (err) => {
        console.error(`${new Date().toISOString()} - Socket Error from ${socket.remoteAddress}:`, err);
    });
});

// Add process error handlers to prevent unexpected exits
process.on('uncaughtException', (error) => {
    console.error(`${new Date().toISOString()} - Uncaught Exception:`, error);
});

process.on('unhandledRejection', (error) => {
    console.error(`${new Date().toISOString()} - Unhandled Rejection:`, error);
});

process.on('SIGTERM', () => {
    console.log(`${new Date().toISOString()} - Received SIGTERM, shutting down gracefully`);
    server.close(() => {
        console.log(`${new Date().toISOString()} - Server closed`);
        process.exit(0);
    });
});

// Send ready message to stderr for Claude to see
console.error('MCP Server ready for initialization');