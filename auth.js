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
const { v4: uuidv4 } = require('uuid');

const twitch_client_id = process.env.TWITCH_CLIENT_ID;
const twitch_client_secret = process.env.TWITCH_CLIENT_SECRET;
const domain = process.env.DOMAIN || "http://localhost:5000";

const { promisify } = require('util');

//const pug = require('pug');

app.set('view engine', 'pug')
app.use(express.static('static'));

app.get("/", function (req, res) {
    res.render(`index`, { title: 'No Big Follows' });
});

app.get("/register", function (req, res) {
    res.render("register", { title: 'Register' });
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
    // generates a redirect function for each registration plan
    // depending on the plan type, database access, redirect link, and rendered page are different.
    // otherwise all other code are the same
    return async function (req, res) {
        // check state exists in redis, for anti-csrf
        const state = req.query.state;
        if (!state) {
            res.render('error', { error: "Invalid request." });
            return;
        }
        const redis_get = promisify(redis_client.get).bind(redis_client);
        const state_storage = await redis_get(state).catch(err => { console.error(err); });
        if (state_storage === null) {
            res.render('error', { error: 'Invalid state. Probably the code expired. Try registering again.' });
            return;
        }
        console.log('state', state, state_storage);
        redis_client.del(state);

        // request user authentication
        const code = req.query.code;
        console.log('registering - received code:', code);
        const token_data = await axios.post("https://id.twitch.tv/oauth2/token", null,
            {
                params: {
                    "client_id": twitch_client_id,
                    "client_secret": twitch_client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": `${domain}/redirect/${plan_type}`
                }
            }).then(r => r.data).catch(err => console.error(err));
        if (token_data === undefined) {
            res.render('error', { error: "Authentication cancelled?" });
            return;
        }
        console.log(token_data);

        // get user data (username, twitch id) using access_token
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

        var expiry = new Date();
        expiry.setSeconds(expiry.getSeconds() + token_data.expires_in);
        // TODO: this line is way too long
        await db_pool.query("INSERT INTO access_tokens VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT access_tokens_pkey DO UPDATE SET access_token = $3, refresh_token = $4, expiry = $5, plan_type = $6", [user_data.id, user_data.login, token_data.access_token, token_data.refresh_token, expiry, plan_type]).catch(err => console.error(err));
        await db_pool.query("INSERT INTO stats VALUES ($1) ON CONFLICT (twitch_id) DO NOTHING", [user_data.id]);

        // launch a new twitch chat client for the user
        redis_client.publish("launch", user_data.id);

        res.render('register_finished', { username: user_data.display_name, plan_type: plan_type });
    };
};

app.get("/redirect/full", get_redirect_func('full'));
app.get("/redirect/lite", get_redirect_func('lite'));

app.get("/unregister", async function (req, res) {
    res.render("unregister", { title: "Unregister" })
});

app.get("/unregister/authorize", async function (req, res) {
    console.log('Redirecting to unregister...');
    const state = uuidv4();
    redis_client.set(state, 1, 'EX', 5 * 60);
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/redirect/unregister&response_type=code&scope=&force_verify=true&state=${state}`);
})

app.get("/redirect/unregister", async function (req, res) {
    // check state exists in redis, for anti-csrf
    const state = req.query.state;
    if (!state) {
        res.render('error', { error: "Invalid request." });
        return;
    }
    const redis_get = promisify(redis_client.get).bind(redis_client);
    const state_storage = await redis_get(state).catch(err => { console.error(err); });
    if (state_storage === null) {
        res.render('error', { error: 'Invalid state. Probably the code expired. Try unregistering again.' });
        return;
    }
    console.log('state', state, state_storage);
    redis_client.del(state);

    // request user authentication
    const code = req.query.code;
    console.log('unregistering - received code:', code);
    const token_data = await axios.post("https://id.twitch.tv/oauth2/token", null,
        {
            params: {
                "client_id": twitch_client_id,
                "client_secret": twitch_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": `${domain}/redirect/unregister`
            }
        }).then(r => r.data).catch(err => console.error(err));
    if (token_data === undefined) {
        res.render('error', { error: "Authentication cancelled?" });
        return;
    }
    console.log(token_data);

    // get user data (username, twitch id) using access_token
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
    const db_res = await db_pool.query("DELETE FROM access_tokens WHERE twitch_id = $1", [user_id]).catch(err => console.error(err));

    redis_client.publish("kill", user_id);
    res.render('unregister_finished', { username: user_data.display_name })
});

app.get("/profile/redirect", async function (req, res) {
    console.log('Redirecting to profile...');
    const state = uuidv4();
    redis_client.set(state, 1, 'EX', 5 * 60);
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/profile&response_type=code&scope=&force_verify=true&state=${state}`);
});

app.get("/profile", async function (req, res) {
    // TODO: this is a lot of code diplication, but I need to res.render() and return on error path though...
    const state = req.query.state;
    if (!state) {
        res.render('error', { error: "Invalid request." });
        return;
    }
    const redis_get = promisify(redis_client.get).bind(redis_client);
    const state_storage = await redis_get(state).catch(err => { console.error(err); });
    if (state_storage === null) {
        res.render('error', { error: 'Invalid state. Probably the code expired. Try unregistering again.' });
        return;
    }
    console.log('state', state, state_storage);
    redis_client.del(state);

    // request user authentication
    const code = req.query.code;
    console.log('unregistering - received code:', code);
    const token_data = await axios.post("https://id.twitch.tv/oauth2/token", null,
        {
            params: {
                "client_id": twitch_client_id,
                "client_secret": twitch_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": `${domain}/profile`
            }
        }).then(r => r.data).catch(err => console.error(err));
    if (token_data === undefined) {
        res.render('error', { error: "Authentication cancelled?" });
        return;
    }
    console.log(token_data);

    // get user data (username, twitch id) using access_token
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
    const db_res = await db_pool.query("SELECT bots_detected FROM stats WHERE twitch_id = $1", [user_id]).catch(err => console.error(err));
    if (db_res.rows.length === 0) {
        var bots_detected = 0;
    } else {
        var { bots_detected } = db_res.rows[0];
    }
    const access_token_res = await db_pool.query("SELECT access_token FROM access_tokens WHERE twitch_id = $1", [user_id]).catch(err => console.error(err));
    if (access_token_res.rows.length === 0) {
        // it's probably already null if I don't write this, but it's javascript so better safe than sorry
        var access_token = null;
    } else {
        var { access_token } = access_token_res.rows[0];
    }

    res.render("profile", { title: user_data.display_name, bots_detected, access_token });
});

var port = process.env.PORT || 5000;
app.listen(port,
    () => console.log(`Auth server is running at port ${port}...`));