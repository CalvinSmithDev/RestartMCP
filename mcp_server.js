#!/usr/bin/env node

const express = require('express');
const find = require('find-process');
const { exec } = require('child_process');
const app = express();

app.use(express.json());

async function findProcessByName(processName) {
    try {
        const processes = await find('name', processName);
        return processes.map(proc => proc.pid);
    } catch (e) {
        console.error('Error finding process:', e);
        return [];
    }
}

async function killProcess(pid) {
    try {
        if (process.platform === 'win32') {
            await new Promise((resolve, reject) => {
                exec(`taskkill /PID ${pid} /T /F`, (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        } else {
            process.kill(pid);
        }
    } catch (e) {
        console.error(`Error killing process ${pid}:`, e);
    }
}

app.post('/restart', async(req, res) => {
    const { app_name, app_path } = req.body;

    if (!app_name || !app_path) {
        return res.status(400).json({ error: 'Missing app_name or app_path' });
    }

    try {
        // Find and kill existing processes
        const pids = await findProcessByName(app_name);
        for (const pid of pids) {
            await killProcess(pid);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s
        }

        // Start the application
        exec(app_path, (error) => {
            if (error) {
                console.error('Error starting application:', error);
                return res.status(500).json({
                    status: 'error',
                    message: `Failed to restart application: ${error.message}`
                });
            }
        });

        res.json({
            status: 'success',
            message: `Application ${app_name} restarted successfully`
        });
    } catch (e) {
        res.status(500).json({
            status: 'error',
            message: `Failed to restart application: ${e.message}`
        });
    }
});

const port = process.env.PORT || 5000;
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, () => {
    console.log(`MCP Server running at http://${host}:${port}`);
});