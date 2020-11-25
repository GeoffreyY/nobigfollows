const { RefreshableAuthProvider, StaticAuthProvider } = require('twitch-auth');
const { ChatClient } = require('twitch-chat-client');
const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;

const { Pool } = require('pg');
//const { workers } = require('cluster');
const database_url = process.env.DATABASE_URL;
const db_pool = new Pool({
    connectionString: database_url,
    ssl: {
        rejectUnauthorized: false
    }
});

async function create_worker(id) {
    const db_client = await db_pool.connect();
    var response = await db_client.query('SELECT (twitch_name, access_token, refresh_token, expiry) FROM access_tokens WHERE twitch_id = $1', [id]);
    if (response.rows.length === 0) {
        return;
    }
    const [twitch_name, accessToken, refreshToken, expiry] = response.rows[0];
    db_client.release();

    const auth = new RefreshableAuthProvider(
        new StaticAuthProvider(clientId, accessToken),
        {
            clientSecret: clientSecret,
            refreshToken: refreshToken,
            expiry: expiry,
            onRefresh: async ({ accessToken, refreshToken, expiryDate }) => {
                const db_client = await db_pool.connect();
                await db_client.query("UPDATE access_tokens SET access_token = $1, refresh_token = $2, expiry = $3", [accessToken, refreshToken, expiryDate])
                db_client.release();
            }
        }
    );

    const chatClient = new ChatClient(auth, { channels: [twitch_name] });
    await chatClient.connect();

    chatClient.onMessage((channel, user, message) => {
        if (message === '!ping') {
            chatClient.say(channel, 'Pong!');
        }
        var noramlized = message.normalize("NFD").split('').filter(c => c.match(/[a-zA-Z]/)).join('').toLowerCase();
        if (noramlized.includes('bigfollowscom') && noramlized.includes('buyfollowersprimesandviewers')) {
            chatClient.ban(channel, user, 'big follows bot');
        }
    });
    return chatClient;
}

async function main() {
    const db_client = await db_pool.connect();
    var twitch_ids = await db_client.query('SELECT twitch_id FROM access_tokens');
    db_client.release();

    var workers = {};
    for (row_dict of twitch_ids.rows) {
        var id = row_dict.twitch_id;
        workers[id] = create_worker(id);
    }
}

main();