require('./settings');
const fs = require('fs');
const pino = require('pino');
const path = require('path');
const chalk = require('chalk');
const readline = require('readline');
const { exec } = require('child_process');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const timezones = global.timezones || "Africa/Kampala";
const moment = require('moment-timezone');
const {
    default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        browser,
        fetchLatestBaileysVersion,
        delay
} = require('@whiskeysockets/baileys');
const msgRetryCounterCache = new NodeCache();

// Import makeInMemoryStore separately
const { makeInMemoryStore } = require('./lib/store');
const db = require('./lib/databaseManager');

const pairingCode = true;
const sessionPath = './session';

// Função para limpar a sessão
function clearSession() {
        if (fs.existsSync(sessionPath)) {
                    console.log(chalk.yellow('Cleaning up old session...'));
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                    console.log(chalk.green('Session cleaned.'));
        }
}

const DataBase = require('./lib/kayiza');
const database = new DataBase();

(async () => {
        try {
                    const loadData = await database.read();
                    global.db = {
                                    users: {},
                                    groups: {},
                                    database: {},
                                    settings: {},
                                    ...(loadData || {}),
                    };
                    if (Object.keys(loadData || {}).length === 0) {
                                    await database.write(global.db);
                                    console.log(chalk.green('NEMESIS MD DATABASE INITIALIZED'));
                    } else {
                                    console.log(chalk.green('NEMESIS MD DATABASE LOADED'));
                    }

            setInterval(async () => {
                            try {
                                                await database.write(global.db);
                            } catch (e) {
                                                console.error(chalk.red('DB Save Error:'), e.message);
                            }
            }, 30000);
        } catch (e) {
                    console.error(chalk.red('Database init failed:'), e.message);
                    process.exit(1);
        }
})();

const { MessagesUpsert, Solving } = require('./lib/message');

let reconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

async function startingBot() {
        const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version, isLatest } = await fetchLatestBaileysVersion();

    const nemesis = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: !pairingCode,
                browser: ["Ubuntu", "Chrome", "20.0.04"],
                auth: state,
                msgRetryCounterCache
    });

    store.bind(nemesis.ev);

    if (pairingCode && !nemesis.authState.creds.registered) {
                const phoneNumber = global.ownerNumber || process.env.OWNER_NUMBER;
                if (!phoneNumber) {
                                console.log(chalk.red('Owner number is not set in settings.js or environment variables.'));
                                process.exit(1);
                }
                setTimeout(async () => {
                                try {
                                                    let code = await nemesis.requestPairingCode(phoneNumber);
                                                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                                                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code: `)), chalk.black(chalk.bgWhite(code)));
                                } catch (err) {
                                                    console.log(chalk.red('Error requesting pairing code:'), err.message);
                                         
