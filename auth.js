const express = require("express");
const app = express();

const twitch_client_id = process.env.TWITCH_CLIENT_ID;
const twitch_client_secret = process.env.TWITCH_CLIENT_SECRET;
const my_domain = "https://nobigfollowstwitchbot.herokuapp.com";

app.use(express.json());

app.get("/register", function (req, res) {
    res.redirect(`https://id.twitch.tv/oauth2/authorize?client_id=${twitch_client_id}&redirect_uri=${my_domain}/redirect&response_type=code&scope=chat:read+chat:edit+channel:moderate`)
});

app.get("/redirect", async function (req, res) {
    console.log(req, res);
    var code = req.query.code;
    var post_res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${twitch_client_id}&client_secret=${twitch_client_secret}&code=${code}&grant_type=authorization_code&redirect_uri=${my_domain}/redirect2`,
        { method: 'POST' })
});

app.get("/redirect2", function (req, res) {
    var payload = req.body;
    console.log(payload);
})

app.listen(process.env.PORT || 3000,
    () => console.log("Auth server is running..."));