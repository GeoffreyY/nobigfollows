const { app } = require('./auth.js');
const { redis_client, relaunch_clients } = require('./bot.js');

const port = process.env.PORT || 5000;
app.listen(port,
    () => console.log(`Auth server is running at port ${port}...`));

relaunch_clients();