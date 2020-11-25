const tmi = require('tmi.js');

const opts = {
    identity: {
        username: process.env.TWITCH_USERNAME,
        password: process.env.TWITCH_OAUTH_TOKEN
    },
    // TODO: use a config file or something for list of channels?
    channels: [
        'iceman1415'
    ]
};

const client = new tmi.client(opts);

client.on('connected', onConnectedHandler);
client.on('message', onMessageHandler);
client.connect();

function onConnectedHandler(addr, port) {
    console.log(`* Connected to ${addr}:${port}`);
}

function onMessageHandler(target, context, msg, self) {
    if (self) { return; } // Ignore messages from the bot

    // Remove whitespace from chat message
    const commandName = msg.trim();

    // If the command is known, let's execute it
    if (commandName === '!dice') {
        const num = rollDice();
        client.say(target, `You rolled a ${num}`);
        console.log(`* Executed ${commandName} command`);
    } else {
        console.log(`* Unknown command ${commandName}`);
    }
}
