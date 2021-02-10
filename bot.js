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

function normalize_message(message) {
    const char_replace = {
        '1': 'l', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'b', '7': 't', '9': 'g', '0': 'o',
        '@': 'a', "$": 's', "!": 'i'
    };
    return message
        // we decompose the message, so 'w̸̢͛' becomes [ "w", "̸", "̢", "͛" ]
        .normalize("NFKD").split('')
        // this is in case the bot uses substitution, e.g. 13375p34k => leetspeak
        .map(c => { if (c in char_replace) { return char_replace[c]; } else { return c; } })
        // we only care about the alphabetic characters, remove everything else
        .filter(c => c.match(/[a-zA-Z]/))
        // turn the message back into a string
        .join('').toLowerCase();
}

function check_bigfollow_bot(message) {
    const normalized_message = normalize_message(message);
    // we check if the message has both these substrings:
    const target_1 = normalize_message('big follows com');
    const target_2 = normalize_message('Buy followers, primes and viewers');
    // we calculate a substring_distance, and check the distance against a threshold
    // so we can detect the bot even if it makes some "typos"
    // e.g. we'll also detect "bg follow com", or "bgi folows com"
    var similarity = substring_distance(target_1, normalized_message);
    similarity += substring_distance(target_2, normalized_message);
    const similarity_threshold = 3;
    return (similarity <= similarity_threshold);
}

function check_banner_bot(message) {
    const normalized_message = normalize_message(message);
    const target = normalize_message('I am going to create custom emotes and sub badges for your channel');
    const similarity = substring_distance(target, normalized_message);
    const similarity_threshold = 3;
    return (similarity <= similarity_threshold);
}

function check_ezfollow_bot(message) {
    return message.includes('tinyurl.com/ezfollow');
}

function check_twitchclips_bot(message) {
    const normalized_message = normalize_message(message);
    const target = normalize_message('i found you on this website');
    const similarity = substring_distance(target, normalized_message);
    const similarity_threshold = 2;
    return (similarity <= similarity_threshold);
}

// Here's the actual code for checking if the message comes from a bot
function check_is_bot(message) {
    return (check_bigfollow_bot(message) ||
        check_banner_bot(message) ||
        check_ezfollow_bot(message) ||
        check_twitchclips_bot(message));
}

// Here's the actual main function!
async function create_worker(twitch_id) {
    // get access token and info for database
    var response = await db_pool.query('SELECT twitch_name, access_token, refresh_token, expiry, plan_type FROM access_tokens WHERE twitch_id = $1', [twitch_id]);
    if (response.rows.length === 0) {
        throw new Error(`Attempting to create worker for twitch id ${twitch_id}, but we don't have an access code.`);
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

    // create client
    const chatClient = new ChatClient(auth, { channels: [twitch_name] });
    await chatClient.connect();
    chatClient.onMessage(async (channel, user, message) => {
        // this is a "hidden" ping command thing that you can use to check whether my bot is in your chat :p
        if (message === '>>> ping?') {
            chatClient.say(channel, '<<< Pong!');
        }
        if (check_is_bot(message)) {
            console.log('detected bot:', channel, user, message);
            // artificial 1 sec delay for reasons
            await new Promise((resolve, reject) => setTimeout(resolve, 1000));
            if (plan_type === 'full') {
                // someone wanted to purge instead of ban the bots
                // so in case our anti-bot failed and detect real people as bot,
                // we only purge them and the broadcaster doesn't need to unban them
                await chatClient.purge(channel, user, 'bot behaviour').catch(err => console.error(err));
            } else if (plan_type === 'strict') {
                await chatClient.ban(channel, user, 'bot behaviour').catch(err => console.error(err));
            } else if (plan_type === 'lite') {
                chatClient.say(channel, "^ that's a bot < I'm a bot too");
            }
            // I use twitch id = 0 for "total", because there's probably nobody with twitch id 0
            // and I'm too lazy to make a new table or something for the total
            // TODO: maybe use a new db table for total
            await db_pool.query("UPDATE stats SET bots_detected = bots_detected + 1 WHERE twitch_id = 0 OR twitch_id = $1", [twitch_id]);
        }
    });
    return chatClient;
}

var workers = {};

async function relaunch_clients() {
    // when restarting the app from a previous crash, we have to relaunch all the old clients
    const redis_client_pub = redis.createClient(redis_url);
    const twitch_ids = await db_pool.query('SELECT twitch_id FROM access_tokens');
    for (row_dict of twitch_ids.rows) {
        const id = row_dict.twitch_id;
        // NOTE: we relaunch by sending "launch" commands to redis
        // so if you're using the same redis server on both prod and dev,
        // you'll also relaunch the prod clients when testing in dev
        redis_client_pub.publish("launch", id);
    }
    redis_client_pub.quit();
}

// we listen for commands, to either launch a new chat client, or kill an old chat client
// commands and exchanged (sent and received) via redis
redis_client.on("message", async (channel, message) => {
    console.log('redis command:', channel, message);
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

module.exports = { redis_client, relaunch_clients }