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

// ========== helper functions here ==========
async function validate_csrf_state(state) {
    if (!state) {
        throw new Error('Invalid request.')
    }
    // check whether state exists in redis
    const redis_get = promisify(redis_client.get).bind(redis_client);
    const state_storage = await redis_get(state)
        .catch(err => { console.error(err); throw new Error('Invalid state, probably expired. Try registering again.') });
    console.log('state', state, state_storage);
    // state should not be reused
    redis_client.del(state);
}

async function get_access_code(code, redirect_uri) {
    return axios.post("https://id.twitch.tv/oauth2/token", null,
        {
            params: {
                "client_id": twitch_client_id,
                "client_secret": twitch_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri
            }
        })
        .catch(err => { console.error(err); throw new Error('501: couldn\'t get access code') })
        .then(r => { if ('data' in r) { return r.data } else { throw new Error(r.error) } })
}

async function get_user_data(access_token) {
    // I think we should defer awaiting and catching to the caller of this function (?)
    return axios.get("https://api.twitch.tv/helix/users?",
        {
            headers: {
                "Authorization": `Bearer ${access_token}`,
                "Client-Id": twitch_client_id
            }
        })
        .catch(err => { console.error(err); throw new Error('501: could not fetch user data') })
        .then(r => { if ('data' in r) { return r.data } else { throw new Error(r.error) } })
        .then(d => d.data[0])
        .then(user_data => { user_data.id = parseInt(user_data.id, 10); return user_data })
}

const STATE_TIMEOUT = 5 * 60; // 5 minutes
function generate_state() {
    // generate a random anti-csrf "state", that's passed to twitch when authorizing w/ oauth
    // ths state is echoed back, and we should check that the returned state is valid
    const state = uuidv4();
    redis_client.set(state, 1, 'EX', STATE_TIMEOUT);
    return state;
}

// ========== main code here ==========
app.set('view engine', 'pug')
app.use(express.static('static'));

app.get("/", function (req, res) {
    res.render(`index`);
});

app.get("/register", function (req, res) {
    res.render("register");
});

app.get("/register/full", function (req, res) {
    console.log('Redirecting to register full...');
    const state = generate_state();
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/redirect/full&response_type=code&scope=chat:read+chat:edit+channel:moderate&state=${state}`);
});

app.get("/register/lite", function (req, res) {
    console.log('Redirecting to register lite...');
    const state = generate_state();
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/redirect/lite&response_type=code&scope=chat:read+chat:edit&state=${state}`);
});

function get_redirect_func(plan_type) {
    // generates a redirect function for each registration plan
    // depending on the plan type, database access, redirect link, and rendered page are different.
    // otherwise all other code are the same
    return async function (req, res) {
        try {
            const state = req.query.state;
            await validate_csrf_state(state);

            // request user authentication
            const code = req.query.code;
            console.log(`registering ${plan_type} - received code: ${code}`);
            const token_data = await get_access_code(code, `${domain}/redirect/${plan_type}`);
            console.log(token_data);

            const user_data = await get_user_data(token_data.access_token);
            console.log(user_data);

            var expiry = new Date();
            expiry.setSeconds(expiry.getSeconds() + token_data.expires_in);
            await db_pool
                .query("INSERT INTO access_tokens VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT access_tokens_pkey DO UPDATE SET access_token = $3, refresh_token = $4, expiry = $5, plan_type = $6",
                    [user_data.id, user_data.login, token_data.access_token, token_data.refresh_token, expiry, plan_type])
                .catch(err => { console.error(err); throw new Error("couldn't insert access token into db") })
            await db_pool
                .query("INSERT INTO stats VALUES ($1) ON CONFLICT (twitch_id) DO NOTHING", [user_data.id])
                .catch(err => { console.error(err); throw new Error("couldn't update stats in db") });

            // launch a new twitch chat client for the user
            redis_client.publish("launch", user_data.id);

            res.render('register_finished', { username: user_data.display_name, plan_type: plan_type });
        } catch (err) {
            res.render("error", { error: err })
        }
    };
};

app.get("/redirect/full", get_redirect_func('full'));
app.get("/redirect/lite", get_redirect_func('lite'));

app.get("/unregister", async function (req, res) {
    res.render("unregister")
});

app.get("/unregister/authorize", async function (req, res) {
    console.log('Redirecting to unregister...');
    const state = generate_state();
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/redirect/unregister&response_type=code&scope=&force_verify=true&state=${state}`);
})

app.get("/redirect/unregister", async function (req, res) {
    try {
        const state = req.query.state;
        await validate_csrf_state(state);

        // request user authentication
        const code = req.query.code;
        console.log('unregistering - received code:', code);
        const token_data = await get_access_code(code, `${domain}/redirect/unregister`);
        console.log(token_data);

        // get user data (username, twitch id) using access_token
        const user_data = await get_user_data(token_data.access_token);
        console.log(user_data);

        const db_res = await db_pool
            .query("DELETE FROM access_tokens WHERE twitch_id = $1", [user_data.id])
            .catch(err => { console.error(err); throw new Error("Couldn't delete your access code from the db, probably because we don't have one.") });

        redis_client.publish("kill", user_data.id);
        res.render('unregister_finished', { username: user_data.display_name })
    } catch (err) {
        res.render('error', { error: err })
    }
});

app.get("/profile/redirect", async function (req, res) {
    console.log('Redirecting to profile...');
    const state = generate_state();
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/profile&response_type=code&scope=&force_verify=true&state=${state}`);
});

app.get("/profile", async function (req, res) {
    try {
        const state = req.query.state;
        await validate_csrf_state(state);

        // request user authentication
        const code = req.query.code;
        console.log('unregistering - received code:', code);
        const token_data = await get_access_code(code, `${domain}/profile`);
        console.log(token_data);

        // get user data (username, twitch id) using access_token
        const user_data = await get_user_data(token_data.access_token);
        console.log(user_data);

        const db_res = await db_pool
            .query("SELECT bots_detected FROM stats WHERE twitch_id = $1", [user_data.id])
            .catch(err => { console.error(err); throw new Error("Couldn't fetch from stats page.") });
        if (db_res.rows.length === 0) {
            var bots_detected = 0;
        } else {
            var { bots_detected } = db_res.rows[0];
        }
        const access_token_res = await db_pool
            .query("SELECT access_token FROM access_tokens WHERE twitch_id = $1", [user_data.id])
            .catch(err => { console.error(err); throw new Error("Couldn't fetch access code.") });
        if (access_token_res.rows.length === 0) {
            // it's probably already null if I don't write this, but it's javascript so better safe than sorry
            var access_token = null;
        } else {
            var { access_token } = access_token_res.rows[0];
        }

        res.render("profile", { title: user_data.display_name, bots_detected, access_token });
    } catch (err) {
        res.render('error', { error: err })
    }
});

var port = process.env.PORT || 5000;
app.listen(port,
    () => console.log(`Auth server is running at port ${port}...`));