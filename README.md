# nobigfollows

This bot (app? thing? idk) timeouts the "Wanna be famous?" spam bot from your twitch chat. Go here to register:

https://nobigfollowstwitchbot.herokuapp.com/register/

To unregister the bot from your channel, visit [here](https://nobigfollowstwitchbot.herokuapp.com/register/).

To upgrade / change plans, just register again.

Whenever you register, a new access code is generated and stored against your twitch id, and overwrites any old access code that was stored against your twitch id. When a bot (app?) instance is launched, any old instances that was also assigned to the same twitch id is killed.

## How it works

Note: This is subject to change, look at the source code in bot.js for the actual behaviour, [see here](https://github.com/GeoffreyY/nobigfollows/blob/7813bc52ae9666595c32084a5ac2ca555c628dbb/bot.js#L48).

Currently, this bot looks for messages that has the phrase "bigfollows.com" and "Buy followers, primes, and viewers", and timeouts the user if the message contains both phrases.

The messages are normalized, and only alphabetic characters are considered when comparing.

The bot actually calculates the distance between messages and the targetted phrases, instead of looking for exact matches, so similar strings (has few typos) are also considered.

## Technical details

[auth.js](auth.js) is the express web server, for users to register and unregister mainly. I'll add more functionality later.

[bot.js](bot.js) contains the actual twitch chat client. Code for managing (launching and killing) client instances is also there, but I might put them in a separate file later.

[lib.js](lib.js) is where I put the message normalization code. It contains the function for calculating string [DL-distance](https://en.wikipedia.org/wiki/Damerau%E2%80%93Levenshtein_distance), that I've adapted to look for substring instead of the full string. There's like 3 test cases in the file.

I'm using postgres to store access codes. Using redis instead of the postgres db to store anti-csrf "state" ([see here](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth#oauth-authorization-code-flow)), and I also use the redis for and easy way of communicating between files (launch / kill chat instances).

### Deploying your own instance

I'm not entierly familiar with heroku, but here's what you might need to deploy your own instance:

Attach the Heroku Postgres add-on on heroku, which should automatically set the `DATABASE_URL` environemental variable (aka config var, or env var) on heroku.

Attach the Heroku Redis add-on on heroku, which should automatiically set the `REDIS_TLS_URL` and `REDIS_URL` env vars.

Setup the postgres database with the following:

`CREATE TABLE access_tokens ( twitch_id INTEGER PRIMARY KEY, twitch_name VARCHAR NOT NULL, access_token VARCHAR(30) NOT NULL, refresh_token VARCHAR(50) NOT NULL, expiry TIMESTAMP WITH TIME ZONE NOT NULL, plan_type VARCHAR(10) NOT NULL );`

`CREATE TABLE stats ( twitch_id INTEGER PRIMARY KEY, bots_detected INTEGER NOT NULL DEFAULT 0 );`

`INSERT INTO stats VALUES (0, 0);`

NOTE: I have not verified that the above queries do not have bugs / work at all, please open an issue / PR is it's wrong.

Set the `DOMAIN` env var, to the domain your heroku instance is being hosted at. In my case, it's `https://nobigfollowstwitchbot.herokuapp.com`. This should be changed when testing locally, as redirect urls (for twitch authorization) uses this. Currently there is a fallback [here](https://github.com/GeoffreyY/nobigfollows/blob/eb96638707c1699ad4f1cb6fc64a8449ec45e88c/auth.js#L21) if the `DOMAIN` env var is not set.

`PORT` env var should not be set on heroku, as it's automatically handled by heroku. Locally, it should be set, such that the server is hosted on port matching the local `DOMAIN` env var.

NOTE: for some reason on my machine, setting `PORT` to 5000 makes the express web server being hosted on port 5100 instead, but my local `DOMAIN` on is `http://localhost:5000`, so I actually set local `PORT` to 4900.

Create a twtich application at https://dev.twitch.tv/console/apps/create, then go to "Manage" for the app [here](https://dev.twitch.tv/console/apps), and

1. find your twtich app's client id, and set the `TWITCH_CLIENT_ID` env var to that

2. get a client secret for your twitch app, and set `TWITCH_CLIENT_SECRET` env var to that

3. Add the following redirect urls for your twitch app, replacing $DOMAIN with your heroku app domain:

- $DOMAIN/redirect/full

- $DOMAIN/redirect/lite

- $DOMAIN/redirect/unregister

- $DOMAIN/profile

For example, I have `https://nobigfollowstwitchbot.herokuapp.com/redirect/full`, `https://nobigfollowstwitchbot.herokuapp.com/redirect/lite` etc.

In order to test locally, I also have `http://localhost:5000/redirect/full`, `http://localhost:5000/redirect/lite` etc., a total of 8 redirect urls.

NOTE: This is subject to change, I'll find a better method that doesn't need so many redirect urls if I have time.

Finally, it's recommended to set `NODE_ENV` to `production` on heroku, and `development` locally.
