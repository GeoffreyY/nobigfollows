const { StaticAuthProvider } = require('twitch-auth');
const { ChatClient } = require('twitch-chat-client');

async function main() {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const accessToken = process.env.TWITCH_OAUTH_TOKEN;
    const auth = new StaticAuthProvider(clientId, accessToken);

    const chatClient = new ChatClient(auth, { channels: ['iceman1415'] });
    await chatClient.connect();

    chatClient.onMessage((channel, user, message) => {
        if (message === '!ping') {
            chatClient.say(channel, 'Pong!');
        }
        var noramlized = message.normalize("NFD").split('').filter(c => c.match(/[a-zA-Z]/)).join('').toLowerCase();
        if (noramlized.includes('bigfollowscom') && noramlized.includes('buyfollowersprimesandviewers')) {
            chatClient.ban(channel, user, 'big follows bot');
        }
    });
}

main();