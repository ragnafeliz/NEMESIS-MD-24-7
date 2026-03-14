require('./settings');
const fs = require('fs');
const chalk = require('chalk');
const QRCode = require('qrcode');

const sessionPath = './session';
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

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

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    delay
} = require('@whiskeysockets/baileys');

const DataBase = require('./lib/kayiza');
const database = new DataBase();
const { MessagesUpsert, Solving } = require('./lib/message');

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

async function startingBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const nemesis = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: require('pino')({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '120'],
            syncFullHistory: false,
            shouldSyncHistoryMessage: () => false,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            fireInitQueries: true,
            defaultQueryTimeoutMs: undefined,
        });

        // Gerar e exibir QR Code em ASCII
        nemesis.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(chalk.cyan('\n╔════════════════════════════════════════╗'));
                console.log(chalk.cyan('║  SCAN THIS QR CODE WITH WHATSAPP      ║'));
                console.log(chalk.cyan('╚════════════════════════════════════════╝\n'));
                
                // Gerar QR Code em terminal
                try {
                    const qrAscii = await QRCode.toString(qr, { type: 'terminal', width: 10 });
                    console.log(qrAscii);
                } catch (err) {
                    console.log(chalk.yellow('QR Code String: ' + qr));
                }
                
                console.log(chalk.cyan('\n╚════════════════════════════════════════╝\n'));
            }

            if (connection === 'connecting') {
                console.log(chalk.yellow('Connecting to WhatsApp...'));
            }

            if (connection === 'open') {
                reconnectAttempts = 0;
                console.log(chalk.green('✅ Bot Connected Successfully!'));
                console.log(chalk.cyan('Bot is running...'));
            }

            if (connection === 'close') {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                
                if (reason === DisconnectReason.badSessionFile) {
                    console.log(chalk.red('Bad Session File, clearing session...'));
                    clearSession();
                    startingBot();
                } else if (reason === DisconnectReason.connectionClosed) {
                    console.log(chalk.yellow('Connection Closed, reconnecting...'));
                    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++;
                        await delay(5000);
                        startingBot();
                    }
                } else if (reason === DisconnectReason.connectionLost) {
                    console.log(chalk.yellow('Connection Lost, reconnecting...'));
                    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++;
                        await delay(5000);
                        startingBot();
                    }
                } else if (reason === DisconnectReason.restartRequired) {
                    console.log(chalk.yellow('Restart Required, restarting...'));
                    await delay(3000);
                    startingBot();
                } else if (reason === DisconnectReason.timedOut) {
                    console.log(chalk.yellow('Connection TimedOut, reconnecting...'));
                    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        reconnectAttempts++;
                        startingBot();
                    }
                } else {
                    console.log(chalk.red('Unknown disconnect reason:'), reason);
                    startingBot();
                }
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

startingBot();
