const express = require("express");
const axios = require('axios');
const app = express();

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

const twitch_client_id = process.env.TWITCH_CLIENT_ID;
const twitch_client_secret = process.env.TWITCH_CLIENT_SECRET;
const domain = process.env.DOMAIN || "http://localhost:5000";

const { v4: uuidv4 } = require('uuid');

app.get("/", function (req, res) {
    res.send(`Hello World!`);
});

app.get("/register", function (req, res) {
    res.send(`<div>Select plan type:</div>
    <form action="/register/full" method="get">
        Purges the bot when detected, but required channel moderator permission.
        <button type="submit">Full</button>
    </form>
    <form action="/register/lite" method="get">
        Doesn't require channel moderator permissions, but doesn't take action against the bot, only comments that it's a bot. Used to test the functionality of this anti-bot bot.
        <button type="submit">Lite</button>
    </form>`);
});

app.get("/register/full", function (req, res) {
    console.log('Redirecting to register full...');
    const state = uuidv4();
    redis_client.set(state, 1, 'EX', 5 * 60);
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/redirect/full&response_type=code&scope=chat:read+chat:edit+channel:moderate&state=${state}`);
});

app.get("/register/lite", function (req, res) {
    console.log('Redirecting to register lite...');
    const state = uuidv4();
    redis_client.set(state, 1, 'EX', 5 * 60);
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/redirect/lite&response_type=code&scope=chat:read+chat:edit&state=${state}`);
});

function get_redirect_func(plan_type) {
    return async function (req, res) {
        const state = req.query.state;
        if (!state) {
            res.send("Invalid request.");
            return;
        }
        redis_client.get(state, async (err, reply) => {
            if (err) {
                console.error(err);
                return;
            }
            console.log(state, reply);
            if (reply === null) {
                res.send('Invalid state. Probably the code expired. Try unregistering again.')
                return;
            }

            redis_client.del(state);
            const code = req.query.code;
            console.log('registering - received code:', code);
            const token_data = await axios.post("https://id.twitch.tv/oauth2/token", null,
                {
                    params: {
                        "client_id": twitch_client_id,
                        "client_secret": twitch_client_secret,
                        "code": code,
                        "grant_type": "authorization_code",
                        "redirect_uri": `${domain}/redirect/full`
                    }
                }).then(r => r.data).catch(err => console.error(err));
            console.log(token_data);
            const user_data = await axios.get("https://api.twitch.tv/helix/users?",
                {
                    headers: {
                        "Authorization": `Bearer ${token_data['access_token']}`,
                        "Client-Id": twitch_client_id
                    }
                })
                .then(r => r.data)
                .then(r => r.data[0])
                .catch(err => console.error(err));
            console.log(user_data);
            user_data.id = parseInt(user_data.id, 10);

            const db_client = await db_pool.connect();
            var expiry = new Date();
            expiry.setSeconds(expiry.getSeconds() + token_data.expires_in);
            // console.log([user_data.id, user_data.login, token_data.access_token, token_data.refresh_token, expiry]);
            await db_client.query("INSERT INTO access_tokens VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT access_tokens_pkey DO UPDATE SET access_token = $3, refresh_token = $4, expiry = $5, plan_type = $6", [user_data.id, user_data.login, token_data.access_token, token_data.refresh_token, expiry, plan_type]);
            db_client.release();

            redis_client.publish("launch", user_data.id);

            res.send(`${user_data.display_name}, you have been registered!\nPlan type: ${plan_type}`);
        })

    };
}

app.get("/redirect/full", get_redirect_func('full'));
app.get("/redirect/lite", get_redirect_func('lite'));

app.get("/unregister", async function (req, res) {
    console.log('Redirecting to unregister...');
    const state = uuidv4();
    redis_client.set(state, 1, 'EX', 5 * 60);
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/unregister/confirm&response_type=code&scope=&force_verify=true&state=${state}`);
})

app.get("/unregister/confirm", async function (req, res) {
    const state = req.query.state;
    if (!state) {
        res.send("Invalid request.");
        return;
    }
    redis_client.get(state, async (err, reply) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(state, reply);
        if (reply === null) {
            res.send('Invalid state. Probably the code expired. Try unregistering again.')
            return;
        }

        redis_client.del(state);
        const code = req.query.code;
        console.log('unregistering - received code:', code);
        const token_data = await axios.post("https://id.twitch.tv/oauth2/token", null,
            {
                params: {
                    "client_id": twitch_client_id,
                    "client_secret": twitch_client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": `${domain}/unregister/confirm`
                }
            }).then(r => r.data).catch(err => console.error(err));
        console.log(token_data);
        const user_data = await axios.get("https://api.twitch.tv/helix/users?",
            {
                headers: {
                    "Authorization": `Bearer ${token_data['access_token']}`,
                    "Client-Id": twitch_client_id
                }
            })
            .then(r => r.data)
            .then(r => r.data[0])
            .catch(err => console.error(err));
        console.log(user_data);
        const user_id = parseInt(user_data.id, 10);
        const db_client = await db_pool.connect();
        const db_res = await db_client.query("DELETE FROM access_tokens WHERE twitch_id = $1", [user_id]);
        db_client.release();
        redis_client.publish("kill", user_id);
        res.send(`${user_data.display_name} (id ${user_id}), you have been unregistered.`);
    });

})

var port = process.env.PORT || 5000;
app.listen(port,
    () => console.log(`Auth server is running at port ${port}...`));