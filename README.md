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