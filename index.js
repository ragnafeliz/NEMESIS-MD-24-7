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
        console.log(chalk.green('Session cleaned successfully.'));
    }
}

// Limpar sessão na inicialização
clearSession();

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
    try {
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

        // Pairing Code Logic
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
                }
            }, 3000);
        }

        nemesis.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(chalk.cyan('Scan this QR Code with WhatsApp:'));
                console.log(qr);
            }

            if (connection === 'close') {
                let reason = new Boom(lastDisconnect?.error)?.output.statusCode;

                if (reason === DisconnectReason.badSession) {
                    console.log(chalk.red('Bad Session File, Please Delete Session and Scan Again'));
                    clearSession();
                    startingBot();
                } else if (reason === DisconnectReason.connectionClosed) {
                    console.log(chalk.yellow('Connection closed, reconnecting...'));
                    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++;
                        await delay(3000);
                        startingBot();
                    } else {
                        console.log(chalk.red('Max reconnection attempts reached. Exiting...'));
                        process.exit(0);
                    }
                } else if (reason === DisconnectReason.connectionLost) {
                    console.log(chalk.yellow('Connection Lost, reconnecting...'));
                    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++;
                        await delay(3000);
                        startingBot();
                    }
                } else if (reason === DisconnectReason.connectionReplaced) {
                    console.log(chalk.yellow('Connection Replaced, Another New Session Opened, Please Restart Bot'));
                    startingBot();
                } else if (reason === DisconnectReason.loggedOut) {
                    console.log(chalk.red('Logged out, clearing session...'));
                    clearSession();
                    startingBot();
                } else if (reason === DisconnectReason.restartRequired) {
                    console.log(chalk.yellow('Restart Required, Restarting...'));
                    await delay(3000);
                    startingBot();
                } else if (reason === DisconnectReason.timedOut) {
                    console.log(chalk.yellow('Connection TimedOut, Reconnecting...'));
                    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++;
                        startingBot();
                    }
                } else {
                    console.log(chalk.red('Unknown disconnect reason:'), reason);
                    startingBot();
                }
            }

            if (connection === 'open') {
                reconnectAttempts = 0;
                console.log(chalk.green('✓ Bot Connected Successfully'));
                console.log(chalk.cyan('Bot is running...'));
            }
        });

        nemesis.ev.on('messages.upsert', async (m) => {
            try {
                await MessagesUpsert(nemesis, m);
            } catch (err) {
                console.log(chalk.red('Error in message handler:'), err.message);
            }
        });

        nemesis.ev.on('creds.update', saveCreds);

    } catch (err) {
        console.log(chalk.red('Error starting bot:'), err.message);
        await delay(5000);
        startingBot();
    }
}

// Start the bot
startingBot();
