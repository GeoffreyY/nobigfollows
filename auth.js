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

const twitch_client_id = process.env.TWITCH_CLIENT_ID;
const twitch_client_secret = process.env.TWITCH_CLIENT_SECRET;
const domain = process.env.DOMAIN || "http://localhost:5000";

app.get("/", function (req, res) {
    res.send(`Hello World!`);
});

app.get("/register", function (req, res) {
    console.log('Redirecting to register...');
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${domain}/redirect&response_type=code&scope=chat:read+chat:edit+channel:moderate`);
});

app.get("/redirect", async function (req, res) {
    var code = req.query.code;
    console.log('received code:', code);
    var token_data = await axios.post("https://id.twitch.tv/oauth2/token", null,
        {
            params: {
                "client_id": twitch_client_id,
                "client_secret": twitch_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": `${domain}/redirect`
            }
        }).then(r => r.data).catch(err => console.error(err));
    console.log(token_data);
    var user_data = await axios.get("https://api.twitch.tv/helix/users?",
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

    const db_client = await db_pool.connect();
    var expiry = new Date();
    expiry.setSeconds(expiry.getSeconds() + token_data.expires_in);
    // console.log([user_data.id, user_data.login, token_data.access_token, token_data.refresh_token, expiry]);
    await db_client.query("INSERT INTO access_tokens VALUES ($1, $2, $3, $4, $5) ON CONFLICT ON CONSTRAINT access_tokens_pkey DO UPDATE SET access_token = $3, refresh_token = $4, expiry = $5", [user_data.id, user_data.login, token_data.access_token, token_data.refresh_token, expiry]);
    db_client.release();

    res.send(`${user_data.display_name}, you have been registered!`);
});

var port = process.env.PORT || 5000;
app.listen(port,
    () => console.log(`Auth server is running at port ${port}...`));