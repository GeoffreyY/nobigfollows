const { RefreshableAuthProvider, StaticAuthProvider } = require('twitch-auth');
const { ChatClient } = require('twitch-chat-client');
const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;

const { Pool } = require('pg');
const database_url = process.env.DATABASE_URL;
const db_pool = new Pool({
    connectionString: database_url,
    ssl: {
        rejectUnauthorized: false
    }
});

const redis = require("redis");
const redis_url = process.env.REDIS_URL;
const redis_client = redis.createClient(redis_url);

const { substring_distance } = require('./lib.js');

// Here's the actual main function!
async function create_worker(twitch_id) {
    var response = await db_pool.query('SELECT twitch_name, access_token, refresh_token, expiry, plan_type FROM access_tokens WHERE twitch_id = $1', [twitch_id]);
    if (response.rows.length === 0) {
        return;
    }
    const { twitch_name, access_token: accessToken, refresh_token: refreshToken, expiry, plan_type } = response.rows[0];

    const auth = new RefreshableAuthProvider(
        new StaticAuthProvider(clientId, accessToken),
        {
            clientSecret: clientSecret,
            refreshToken: refreshToken,
            expiry: expiry,
            onRefresh: async ({ accessToken, refreshToken, expiryDate }) => {
                await db_pool.query("UPDATE access_tokens SET access_token = $1, refresh_token = $2, expiry = $3 WHERE twitch_id = $4", [accessToken, refreshToken, expiryDate, twitch_id])
            }
        }
    );

    const chatClient = new ChatClient(auth, { channels: [twitch_name] });
    await chatClient.connect();

    chatClient.onMessage(async (channel, user, message) => {
        if (message === '>>> ping?') {
            chatClient.say(channel, '<<< Pong!');
        }
        // Here's the actual code for message comparison
        const noramlized = message.normalize("NFD").split('').filter(c => c.match(/[a-zA-Z]/)).join('').toLowerCase();
        var similarity = substring_distance('bigfollowscom', noramlized);
        similarity += substring_distance('buyfollowersprimesandviewers', noramlized);
        if (similarity <= 3) {
            console.log('detected bot:', channel, user, message);
            if (plan_type == 'full') {
                chatClient.purge(channel, user, 'big follows bot').catch(err => console.error(err));
                // chatClient.ban(channel, user, 'big follows bot');
            } else if (plan_type == 'lite') {
                chatClient.say(channel, "^ that's a scam bot < I'm a bot too").catch(err => console.error(err));
            }
            // I use twitch id = 0 for "total", because there's probably nobody with twitch id 0, and I'm too lazy to make a new table or something for total
            await db_pool.query("UPDATE stats SET bots_detected = bots_detected + 1 WHERE twitch_id = 0 OR twitch_id = $1", [twitch_id]);
        }
    });
    return chatClient;
}

var workers = {};

async function main() {
    // when starting from crash / down, we have to launch all the old clients
    const redis_client_pub = redis.createClient(redis_url);
    const twitch_ids = await db_pool.query('SELECT twitch_id FROM access_tokens');
    for (row_dict of twitch_ids.rows) {
        const id = row_dict.twitch_id;
        redis_client_pub.publish("launch", id);
    }
    redis_client_pub.quit();
}

redis_client.on("message", async (channel, message) => {
    console.log(channel, message);
    if (channel == "launch") {
        // remove old worker if it existed
        if (message in workers) {
            console.log('removing previous:', message, typeof workers[message])
            await workers[message].quit();
            delete workers[message];
        }
        workers[message] = await create_worker(message);
    } else if (channel == "kill") {
        if (message in workers) {
            await workers[message].quit();
            delete workers[message];
        }
    }
});

redis_client.subscribe("launch");
redis_client.subscribe("kill");

main();